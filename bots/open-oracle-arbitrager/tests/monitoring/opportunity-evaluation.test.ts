import { describe, expect, spyOn, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { quoterAbi, v4QuoterAbi } from '#contracts/abi'
import { networkConfiguration } from '#config/network'
import type { RiskLimits } from '#core/safety-controls'
import { evaluate, type EvaluationConfiguration } from '#monitoring/opportunity-evaluation'
import { inspectReport, type ReportInspectionConfiguration } from '#monitoring/report-inspection'
import type { Pool } from '#core/operator-types'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const network = networkConfiguration('sepolia', {})
const rep = network.rep
const v4Quoter = getAddress('0x0000000000000000000000000000000000000044')
const v4PoolManager = getAddress('0x0000000000000000000000000000000000000045')
const poolAddress = getAddress('0x0000000000000000000000000000000000000500')
const reporter = getAddress('0x0000000000000000000000000000000000000004')
const riskLimits: RiskLimits = {
	lifecycleGasReserveAttoWeth: 10n ** 16n,
	maxConcurrentPositions: 1,
	maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
	maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
	maxTotalLockedAttoWeth: 10n * 10n ** 18n,
}
const config: EvaluationConfiguration = {
	maxHedgeSlippageBps: 50n,
	network,
	riskLimits,
	submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
	v4PoolManager,
	v4Quoter,
}
const report: OpenOracleStatePreimage = {
	game: {
		callbackContract: reporter,
		callbackGasLimit: 100_000n,
		currentAmount1: 10n ** 18n,
		currentAmount2: 100n * 10n ** 18n,
		currentReporter: reporter,
		disputeDelay: 10n,
		escalationHalt: 10_000n * 10n ** 18n,
		feePercentage: 10_000n,
		flags: 7n,
		lastReportOppoTime: 89n,
		multiplier: 115n,
		numReports: 1n,
		protocolFee: 100_000n,
		protocolFeeRecipient: reporter,
		reportTimestamp: 90n,
		settlementTime: 300n,
		settlementTimestamp: 0n,
		settlerRewardAttoEth: 1n,
		token1: network.weth,
		token2: rep,
	},
	helper: { blockNumber: 79n, blockTimestamp: 80n, creator: reporter, reportId: 7n },
}
const pool: Pool = { address: poolAddress, fee: 3000, liquidity: 10n ** 24n, spotTick: 0n, token: rep, twapTick: 0n }
const marketBlock = { hash: `0x${'ab'.repeat(32)}` as Hex, number: 100n, observedAt: 1_000 }

function quoterClient(options: { v3SellOut: bigint; v3BuyIn: bigint; replacementOut: bigint; v4: (fee: number) => { sellOut: bigint; buyIn: bigint } | undefined }) {
	const requests: { blockTag: unknown; functionName: string; target: string }[] = []
	let batched = 0
	const provider = multicallProvider(network.multicall3, ({ blockTag, data, to }) => {
		if (to.toLowerCase() === network.quoter.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: quoterAbi, data })
			requests.push({ blockTag, functionName: decoded.functionName, target: 'v3' })
			if (decoded.functionName === 'quoteExactInputSingle') {
				const amountOut = decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase() ? options.v3SellOut : options.replacementOut
				return encodeAbiParameters(quoterAbi[0].outputs, [amountOut, 0n, 0n, 0n])
			}
			return encodeAbiParameters(quoterAbi[1].outputs, [options.v3BuyIn, 0n, 0n, 0n])
		}
		if (to.toLowerCase() === v4Quoter.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: v4QuoterAbi, data })
			requests.push({ blockTag, functionName: decoded.functionName, target: 'v4' })
			const quotes = options.v4(Number(decoded.args[0].poolKey.fee))
			if (quotes === undefined) throw new Error('V4 pool is not initialized')
			return encodeAbiParameters(v4QuoterAbi[0].outputs, [decoded.functionName === 'quoteExactInputSingle' ? quotes.sellOut : quotes.buyIn, 0n])
		}
		throw new Error(`Unexpected contract read ${to}`)
	})
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: parameters => {
				if (parameters.method === 'eth_call') batched += 1
				return provider.request(parameters)
			},
		}),
	})
	return { batched: () => batched, client, requests }
}

describe('batched hedge evaluation', () => {
	test('quotes every venue and the replacement ratio in one request and keeps the best executable venue', async () => {
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			const quoter = quoterClient({
				replacementOut: 120n * 10n ** 18n,
				v3BuyIn: 8n * 10n ** 17n,
				v3SellOut: 12n * 10n ** 17n,
				v4: fee => (fee === 500 ? { buyIn: 7n * 10n ** 17n, sellOut: 13n * 10n ** 17n } : undefined),
			})
			const evaluation = await evaluate(quoter.client, config, report, pool, 10n ** 9n, marketBlock)
			expect(quoter.batched()).toBe(1)
			expect(quoter.requests).toHaveLength(3 + 8)
			expect(quoter.requests.every(request => request.blockTag === '0x64')).toBeTrue()
			expect(evaluation.replacementAmount2).toBe(120n * 10n ** 18n)
			expect(evaluation.candidate?.venue).toBe('uniswap-v4')
			expect(evaluation.candidate?.hedgeFee).toBe(500)
			expect(evaluation.candidate?.hedgePool).toBe(v4PoolManager)
			expect(evaluation.candidate?.quote.netProfitAttoWeth).toBeGreaterThan(0n)
			// Uniswap V3 plus the one initialized V4 tier produce consensus evidence; reverting tiers are logged and skipped.
			expect(evaluation.observations.map(observation => observation.sourceId)).toEqual(['uniswap-v3', 'uniswap-v4'])
			expect(evaluation.observations.every(observation => observation.blockNumber === 100n && observation.blockHash === marketBlock.hash)).toBeTrue()
			expect(logged).toHaveBeenCalledTimes(6)
		} finally {
			logged.mockRestore()
		}
	})

	test('reports a pool without any usable quote instead of failing the batch', async () => {
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			const provider = multicallProvider(network.multicall3, () => {
				throw new Error('quoter reverted')
			})
			const client = createPublicClient({ chain: network.chain, transport: custom(provider) })
			const evaluation = await evaluate(client, { ...config, v4PoolManager: undefined, v4Quoter: undefined }, report, pool, 10n ** 9n, marketBlock)
			expect(evaluation.candidate).toBeUndefined()
			expect(evaluation.replacementAmount2).toBeUndefined()
			expect(evaluation.replacementQuoteFailure).toBe('Multicall contract call failed: execution reverted: quoter reverted')
		} finally {
			logged.mockRestore()
		}
	})
})

describe('report inspection over batched pool evaluations', () => {
	const inspectionConfig: ReportInspectionConfiguration = {
		...config,
		execute: false,
		maxSpotTwapTicks: 100n,
		minimumProfitAttoWeth: 0n,
		minimumProfitBps: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		openOracle: getAddress('0x0000000000000000000000000000000000000099'),
		v4PoolManager: undefined,
		v4Quoter: undefined,
	}
	const otherPool: Pool = { ...pool, address: getAddress('0x0000000000000000000000000000000000000501'), fee: 500 }
	const metadata = { decimals: 18, symbol: 'REP' }
	const policy = { ...report.game, coordinator: reporter, openOracle: inspectionConfig.openOracle }
	const blockTimestamp = report.game.reportTimestamp + report.game.disputeDelay + 1n

	function poolQuoterClient(quotes: (fee: number) => { buyIn: bigint; replacementOut: bigint | undefined; sellOut: bigint }) {
		const provider = multicallProvider(network.multicall3, ({ data, to }) => {
			if (to.toLowerCase() !== network.quoter.toLowerCase()) throw new Error(`Unexpected contract read ${to}`)
			const decoded = decodeFunctionData({ abi: quoterAbi, data })
			const fee = Number(decoded.args[0].fee)
			if (decoded.functionName === 'quoteExactOutputSingle') return encodeAbiParameters(quoterAbi[1].outputs, [quotes(fee).buyIn, 0n, 0n, 0n])
			if (decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase()) return encodeAbiParameters(quoterAbi[0].outputs, [quotes(fee).sellOut, 0n, 0n, 0n])
			const replacementOut = quotes(fee).replacementOut
			if (replacementOut === undefined) throw new Error('replacement quote reverted')
			return encodeAbiParameters(quoterAbi[0].outputs, [replacementOut, 0n, 0n, 0n])
		})
		return createPublicClient({ chain: network.chain, transport: custom(provider) })
	}

	test('keeps the best pool when only another pool lost its replacement quote', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(fee => (fee === 3000 ? { buyIn: 7n * 10n ** 17n, replacementOut: 120n * 10n ** 18n, sellOut: 13n * 10n ** 17n } : { buyIn: 9n * 10n ** 17n, replacementOut: undefined, sellOut: 11n * 10n ** 17n }))
			const decisions: string[] = []
			const evaluated = await inspectReport(client, undefined, inspectionConfig, report, [otherPool, pool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], message => decisions.push(message))
			expect(evaluated?.opportunity.pool).toBe(pool.address)
			expect(evaluated?.opportunity.decision).toBe('dry-run-opportunity')
			expect(decisions).toEqual([])
		} finally {
			logged.mockRestore()
		}
	})

	test('fails the report only when the winning pool lost its replacement quote', async () => {
		const client = poolQuoterClient(() => ({ buyIn: 7n * 10n ** 17n, replacementOut: undefined, sellOut: 13n * 10n ** 17n }))
		await expect(inspectReport(client, undefined, inspectionConfig, report, [pool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], () => undefined)).rejects.toThrow(
			`Uniswap replacement exact-input quote failed for pool ${pool.address}: Multicall contract call failed: execution reverted: replacement quote reverted`,
		)
	})
})
