import { describe, expect, spyOn, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { constantProductPairAbi, erc20Abi, openOracleAbi, poolAbi, quoterAbi, v4QuoterAbi } from '#contracts/abi'
import { parseOperatorSettings } from '#config/settings-store'
import { constantProductExactInput, constantProductExactOutput } from '#core/venue-strategy'
import { calculateFee, calculateNextAmount1 } from '#core/strategy'
import { networkConfiguration } from '#config/network'
import type { RiskLimits } from '#core/safety-controls'
import { evaluate, executionReadQuorum, type EvaluationConfiguration } from '#monitoring/opportunity-evaluation'
import { quoteVenue } from '#monitoring/venue-quotes'
import { inspectReport, type ReportInspectionConfiguration } from '#monitoring/report-inspection'
import type { Pool } from '#core/operator-types'
import { multicallProvider } from '../helpers/multicall-provider.ts'

const network = networkConfiguration('sepolia')
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
	router: poolAddress,
	v2Router: undefined,
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
const pool: Pool = { venue: 'uniswap-v3', address: poolAddress, fee: 3000, liquidity: 10n ** 24n, spotTick: 0n, token: rep, twapTick: 0n }
const marketBlock = { hash: `0x${'ab'.repeat(32)}` as Hex, number: 100n, observedAt: 1_000 }

function quoterClient(options: { v3SellOut: bigint; v3BuyIn: bigint | undefined; replacementOut: bigint; v4: (fee: number) => { sellOut: bigint; buyIn: bigint } | undefined }) {
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
			if (options.v3BuyIn === undefined) throw new Error('buy quote unavailable')
			return encodeAbiParameters(quoterAbi[1].outputs, [options.v3BuyIn, 0n, 0n, 0n])
		}
		if (to.toLowerCase() === v4Quoter.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: v4QuoterAbi, data })
			requests.push({ blockTag, functionName: decoded.functionName, target: 'v4' })
			const quotes = options.v4(Number(decoded.args[0].poolKey.fee))
			if (quotes === undefined) throw new Error('V4 pool is not initialized')
			const exactInput = decoded.args[0].zeroForOne ? options.replacementOut : quotes.sellOut
			return encodeAbiParameters(v4QuoterAbi[0].outputs, [decoded.functionName === 'quoteExactInputSingle' ? exactInput : quotes.buyIn, 0n])
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
	test('quotes V4 and its replacement ratio without querying V3', async () => {
		const quoter = quoterClient({ replacementOut: 120n * 10n ** 18n, v3BuyIn: 0n, v3SellOut: 0n, v4: fee => (fee === 500 ? { buyIn: 7n * 10n ** 17n, sellOut: 13n * 10n ** 17n } : undefined) })
		const evaluation = await evaluate(quoter.client, { ...config, router: undefined }, report, { venue: 'uniswap-v4', address: v4PoolManager, fee: 500, token: rep }, 10n ** 9n, marketBlock)
		expect(quoter.batched()).toBe(1)
		expect(quoter.requests).toHaveLength(3)
		expect(quoter.requests.every(request => request.blockTag === '0x64' && request.target === 'v4')).toBeTrue()
		expect(evaluation.replacementAmount2).toBe(120n * 10n ** 18n)
		expect(evaluation.candidate?.venue).toBe('uniswap-v4')
		expect(evaluation.candidate?.quote.netProfitAttoWeth).toBeGreaterThan(0n)
		expect(evaluation.observations.map(observation => observation.sourceId)).toEqual(['uniswap-v4'])
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
			expect(evaluation.replacementQuoteFailure).toContain('execution reverted: quoter reverted')
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
			expect(evaluated?.opportunity).toMatchObject({ decision: 'dry-run-opportunity', pool: pool.address })
			expect(decisions).toEqual([])
		} finally {
			logged.mockRestore()
		}
	})

	test('keeps a report whose only venue quote failed visible with the quote failure', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(() => ({ buyIn: 7n * 10n ** 17n, replacementOut: undefined, sellOut: 13n * 10n ** 17n }))
			const decisions: string[] = []
			const evaluated = await inspectReport(client, undefined, inspectionConfig, report, [pool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], (_, reason) => decisions.push(reason))
			expect(evaluated?.candidate).toBeUndefined()
			expect(evaluated?.dexObservations).toEqual([])
			const reason = `Venue quotes failed: Uniswap V3 ${pool.address}: Venue quote failed: Multicall contract call failed: execution reverted: replacement quote reverted`
			expect(evaluated?.opportunity).toEqual({
				decision: 'skipped',
				reason,
				reportId: '7',
				token: rep,
				tokenSymbol: 'REP',
				timeRemaining: (report.game.reportTimestamp + report.game.settlementTime - blockTimestamp).toString(),
				windowUnit: 'seconds',
			})
			expect(decisions).toEqual([reason])
		} finally {
			logged.mockRestore()
		}
	})

	test('names the spot/TWAP limit when it removes every pool before quoting', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(() => {
				throw new Error('no pool should be quoted')
			})
			const decisions: string[] = []
			const drifted: Pool = { ...pool, spotTick: 500n, twapTick: 0n }
			const evaluated = await inspectReport(client, undefined, inspectionConfig, report, [drifted, { ...otherPool, spotTick: 500n, twapTick: 0n }], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], (_, reason) => decisions.push(reason))
			expect(evaluated?.opportunity).toMatchObject({ decision: 'skipped', reason: '2 pools exceed the 100 tick spot/TWAP limit', reportId: '7' })
			expect(decisions).toEqual(['2 pools exceed the 100 tick spot/TWAP limit'])
			const mixedClient = poolQuoterClient(() => ({ buyIn: 7n * 10n ** 17n, replacementOut: undefined, sellOut: 13n * 10n ** 17n }))
			const mixed = await inspectReport(mixedClient, undefined, inspectionConfig, report, [drifted, otherPool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], () => {})
			expect(mixed?.opportunity).toMatchObject({ decision: 'skipped', reason: `Venue quotes failed: Uniswap V3 ${otherPool.address}: Venue quote failed: Multicall contract call failed: execution reverted: replacement quote reverted; 1 pool exceeds the 100 tick spot/TWAP limit` })
		} finally {
			logged.mockRestore()
		}
	})

	test('keeps only live WETH/token reports visible and logs template or pair mismatches', async () => {
		const client = poolQuoterClient(() => {
			throw new Error('no pool should be quoted')
		})
		const decisions: string[] = []
		const inspect = (candidate: OpenOracleStatePreimage, candidatePools: readonly Pool[], policies = [policy]) =>
			inspectReport(client, undefined, inspectionConfig, candidate, candidatePools, 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, policies, (_, reason) => decisions.push(reason))
		expect(await inspect(report, [pool], [])).toBeUndefined()
		const nonWeth = { ...report, game: { ...report.game, token1: otherPool.address } }
		expect(await inspect(nonWeth, [pool], [{ ...policy, token1: otherPool.address }])).toBeUndefined()
		expect((await inspect(report, [{ ...pool, token: otherPool.address }]))?.opportunity).toMatchObject({ decision: 'skipped', reason: 'No configured pool can price REP', reportId: '7' })
		const disallowed = await inspectReport(client, undefined, { ...inspectionConfig, execute: true }, report, [pool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, false, true, false, [policy], (_, reason) => decisions.push(reason))
		expect(disallowed?.opportunity).toMatchObject({ decision: 'skipped', reason: 'Report token was observed permissionlessly and is not in the execution allowlist', tokenSymbol: 'REP' })
		expect(decisions).toEqual(['Report creator is not an approved coordinator', 'Report token1 is not WETH', 'No configured pool can price REP', 'Report token was observed permissionlessly and is not in the execution allowlist'])
	})

	test('keeps timing skips visible while the report is inside its settlement window', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(() => ({ buyIn: 7n * 10n ** 17n, replacementOut: 120n * 10n ** 18n, sellOut: 13n * 10n ** 17n }))
			const inspect = (timestamp: bigint, minimumRemainingSeconds = 1n) => inspectReport(client, undefined, { ...inspectionConfig, minimumRemainingSeconds }, report, [pool], 100n, marketBlock.hash, timestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], () => {})
			const beforeDelay = await inspect(report.game.reportTimestamp + 1n)
			expect(beforeDelay?.opportunity).toMatchObject({ decision: 'skipped', reason: 'Dispute delay has not elapsed; disputable in 9 seconds', timeRemaining: '299' })
			const tooLate = await inspect(report.game.reportTimestamp + report.game.settlementTime - 3n, 5n)
			expect(tooLate?.opportunity).toMatchObject({ decision: 'skipped', reason: 'Only 3 seconds remain; the strategy requires at least 5', timeRemaining: '3' })
			expect(await inspect(report.game.reportTimestamp + report.game.settlementTime)).toBeUndefined()
			expect((await inspect(blockTimestamp))?.opportunity.decision).toBe('dry-run-opportunity')
		} finally {
			logged.mockRestore()
		}
	})
})

const pair = getAddress('0x0000000000000000000000000000000000000022')
const oracle = getAddress('0x0000000000000000000000000000000000000099')
const reserveToken = 10_000n * 10n ** 18n
const reserveWeth = 130n * 10n ** 18n
const replacement = 90n * 10n ** 18n

function independentClient(venue: 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4', options: { replacement?: bigint; failReplacement?: boolean; empty?: boolean } = {}) {
	const calls: { blockTag: unknown; to: string }[] = []
	const provider = multicallProvider(
		network.multicall3,
		({ blockTag, data, to }) => {
			calls.push({ blockTag, to })
			if (venue === 'uniswap-v3' && to.toLowerCase() === poolAddress.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: poolAbi, data })
				if (decoded.functionName === 'liquidity') return encodeAbiParameters([{ type: 'uint128' }], [options.empty ? 0n : 10n ** 24n])
				if (decoded.functionName === 'slot0') return encodeAbiParameters([{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], [2n ** 96n, 5n, 0n, 1n, 1n, 0n, true])
				return encodeAbiParameters(
					[{ type: 'int56[]' }, { type: 'uint160[]' }],
					[
						[0n, 300n],
						[0n, 0n],
					],
				)
			}
			if (venue === 'uniswap-v3' && to.toLowerCase() === network.quoter.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: quoterAbi, data })
				const exactInput = decoded.functionName === 'quoteExactInputSingle' && decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase() ? 13n * 10n ** 17n : replacement
				const amount = decoded.functionName === 'quoteExactOutputSingle' ? 14n * 10n ** 17n : exactInput
				return encodeAbiParameters(quoterAbi[0].outputs, [amount, 0n, 0n, 0n])
			}
			if (venue === 'uniswap-v2' && to.toLowerCase() === pair.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: constantProductPairAbi, data })
				if (decoded.functionName === 'token0') return encodeAbiParameters([{ type: 'address' }], [rep])
				return encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }], [options.empty ? 0n : reserveToken, reserveWeth, 0n])
			}
			if (venue === 'uniswap-v4' && to.toLowerCase() === v4Quoter.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: v4QuoterAbi, data })
				expect(decoded.args[0].poolKey.currency0).toBe('0x0000000000000000000000000000000000000000')
				expect(decoded.args[0].poolKey.currency1).toBe(rep)
				expect(decoded.args[0].poolKey.hooks).toBe('0x0000000000000000000000000000000000000000')
				if (options.empty) throw new Error('uninitialized V4 pool')
				if (decoded.functionName === 'quoteExactOutputSingle') return encodeAbiParameters(v4QuoterAbi[0].outputs, [14n * 10n ** 17n, 0n])
				if (decoded.args[0].zeroForOne) {
					expect(decoded.args[0].exactAmount).toBe(calculateNextAmount1(report.game))
					if (options.failReplacement) throw new Error('replacement unavailable')
					return encodeAbiParameters(v4QuoterAbi[0].outputs, [options.replacement ?? replacement, 0n])
				}
				return encodeAbiParameters(v4QuoterAbi[0].outputs, [13n * 10n ** 17n, 0n])
			}
			if (to.toLowerCase() === oracle.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: openOracleAbi, data })
				return decoded.functionName === 'oracleGame' ? encodeAbiParameters([{ type: 'bytes32' }], [marketBlock.hash]) : encodeAbiParameters([{ type: 'uint256' }], [10n ** 24n])
			}
			if ([rep.toLowerCase(), network.weth.toLowerCase()].includes(to.toLowerCase())) {
				decodeFunctionData({ abi: erc20Abi, data })
				return encodeAbiParameters([{ type: 'uint256' }], [10n ** 24n])
			}
			throw new Error(`Unexpected dependency ${to}`)
		},
		({ method }) => {
			if (method === 'eth_getBlockByNumber') return { hash: marketBlock.hash, number: '0x64', timestamp: '0x65', baseFeePerGas: '0x1', transactions: [] }
			if (method === 'eth_getTransactionCount') return '0x0'
			if (method === 'eth_getBalance') return '0x100000000000000000000'
			throw new Error(`Unexpected RPC ${method}`)
		},
	)
	return { client: createPublicClient({ chain: network.chain, transport: custom(provider) }), calls }
}

for (const venue of ['uniswap-v2', 'uniswap-v4'] as const) {
	test(`${venue} alone supports report inspection and final quorum without a V3 dependency`, async () => {
		const selected: Pool = { venue, address: venue === 'uniswap-v2' ? pair : v4PoolManager, fee: 3000, token: rep }
		const enabled = { ...config, router: undefined, v2Router: venue === 'uniswap-v2' ? pair : undefined, v4PoolManager: venue === 'uniswap-v4' ? v4PoolManager : undefined, v4Quoter: venue === 'uniswap-v4' ? v4Quoter : undefined }
		const inspection: ReportInspectionConfiguration = { ...enabled, execute: false, maxSpotTwapTicks: 0n, minimumProfitAttoWeth: 0n, minimumProfitBps: 0n, minimumRemainingBlocks: 1n, minimumRemainingSeconds: 1n, openOracle: oracle }
		const reader = independentClient(venue)
		const evaluated = await inspectReport(reader.client, undefined, inspection, report, [{ ...pool, spotTick: 1000n }, selected], 100n, marketBlock.hash, 101n, 1n, undefined, { decimals: 18, symbol: 'REP' }, true, true, false, [{ ...report.game, coordinator: reporter, openOracle: oracle }], () => {})
		expect(evaluated?.opportunity).toMatchObject({ decision: 'dry-run-opportunity', venue })
		const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
		const execution = { ...enabled, connectivity: saved.connectivity, quorumRpcUrls: ['https://second.example'], executor: reporter, openOracle: oracle, twapSeconds: 60 }
		const snapshot = await executionReadQuorum([reader.client, independentClient(venue).client], execution, report, selected, venue, 3000, 100n, reporter)
		expect(snapshot.v3State).toBeUndefined()
		expect(snapshot.replacementAmount2).toBe(venue === 'uniswap-v2' ? constantProductExactInput(calculateNextAmount1(report.game), reserveWeth, reserveToken) : replacement)
		expect(snapshot.sellHedgeQuote).toBe(venue === 'uniswap-v2' ? constantProductExactInput(report.game.currentAmount2, reserveToken, reserveWeth) : 13n * 10n ** 17n)
		if (venue === 'uniswap-v2') expect(snapshot.buyHedgeQuote).toBe(constantProductExactOutput(report.game.currentAmount2 + calculateFee(report.game.currentAmount2, report.game.feePercentage) + calculateFee(report.game.currentAmount2, report.game.protocolFee), reserveWeth, reserveToken))
		expect(reader.calls.every(call => call.blockTag === '0x64' && call.to.toLowerCase() !== network.quoter.toLowerCase() && call.to.toLowerCase() !== poolAddress.toLowerCase())).toBeTrue()
		await expect(executionReadQuorum([reader.client, independentClient(venue, { empty: true }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
		if (venue === 'uniswap-v4') {
			await expect(executionReadQuorum([reader.client, independentClient(venue, { replacement: replacement + 1n }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
			await expect(executionReadQuorum([independentClient(venue, { failReplacement: true }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
		}
		const disabled = await evaluate(reader.client, { ...enabled, v2Router: undefined, v4PoolManager: undefined, v4Quoter: undefined }, report, selected, 1n, marketBlock)
		expect(disabled.candidate).toBeUndefined()
	})
}

test('V3 retains its own liquidity and TWAP reads in the final quorum', async () => {
	const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
	const execution = { ...config, connectivity: saved.connectivity, quorumRpcUrls: ['https://second.example'], executor: reporter, openOracle: oracle, twapSeconds: 60 }
	const reader = independentClient('uniswap-v3')
	const snapshot = await executionReadQuorum([reader.client, independentClient('uniswap-v3').client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)
	expect(snapshot.v3State).toMatchObject({ liquidity: 10n ** 24n, spotTick: 5n, twapTick: 5n })
	expect(snapshot.replacementAmount2).toBe(replacement)
	await expect(executionReadQuorum([independentClient('uniswap-v3', { empty: true }).client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)).rejects.toThrow()
})

test('selects a profitable direction consistent with the same venue replacement ratio', async () => {
	const quoter = quoterClient({ replacementOut: 90n * 10n ** 18n, v3BuyIn: 5n * 10n ** 17n, v3SellOut: 13n * 10n ** 17n, v4: () => undefined })
	const evaluation = await evaluate(quoter.client, config, report, pool, 1n, marketBlock)
	expect(evaluation.candidate?.quote.direction).toBe('sell-rep')
	expect(evaluation.candidate?.quote.netProfitAttoWeth).toBeGreaterThan(0n)
})

test('a higher-profit sell with a missing buy quote cannot block an executable alternative venue', async () => {
	const quoter = quoterClient({ replacementOut: replacement, v3BuyIn: undefined, v3SellOut: 15n * 10n ** 17n, v4: () => ({ sellOut: 13n * 10n ** 17n, buyIn: 14n * 10n ** 17n }) })
	const raw = await quoteVenue(quoter.client, config, pool, { sellAmount: report.game.currentAmount2, buyAmount: report.game.currentAmount2, replacementAttoWeth: calculateNextAmount1(report.game) }, 100n)
	expect(raw.sell).toBe(15n * 10n ** 17n)
	expect(raw.replacement).toBe(replacement)
	expect(raw.buy).toBeUndefined()
	const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
	const execution = { ...config, connectivity: saved.connectivity, quorumRpcUrls: [], executor: reporter, openOracle: oracle, twapSeconds: 60 }
	await expect(executionReadQuorum([quoter.client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)).rejects.toThrow('Selected venue quote failed')
	const inspection: ReportInspectionConfiguration = { ...config, execute: false, maxSpotTwapTicks: 100n, minimumProfitAttoWeth: 0n, minimumProfitBps: 0n, minimumRemainingBlocks: 1n, minimumRemainingSeconds: 1n, openOracle: oracle }
	const alternative: Pool = { venue: 'uniswap-v4', address: v4PoolManager, fee: 3000, token: rep }
	const evaluated = await inspectReport(quoter.client, undefined, inspection, report, [pool, alternative], 100n, marketBlock.hash, 101n, 1n, undefined, { decimals: 18, symbol: 'REP' }, true, true, false, [{ ...report.game, coordinator: reporter, openOracle: oracle }], () => {})
	expect(evaluated?.opportunity).toMatchObject({ decision: 'dry-run-opportunity', venue: 'uniswap-v4' })
	const final = await executionReadQuorum([independentClient('uniswap-v4').client], execution, report, alternative, 'uniswap-v4', 3000, 100n, reporter)
	expect(final.replacementAmount2).toBe(replacement)
})
