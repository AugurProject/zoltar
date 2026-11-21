import { describe, expect, spyOn, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { constantProductPairAbi, erc20Abi, openOracleAbi, poolAbi } from '#contracts/abi'
import { uniswapV3FactoryAbi, uniswapV3QuoterAbi, uniswapV4QuoterAbi } from '@zoltar/core-shared/evm/uniswapAbis'
import { parseOperatorSettings } from '#config/settings-store'
import { constantProductExactInput, constantProductExactOutput } from '#core/venue-strategy'
import { calculateFee, calculateNextAmount1, fundedCapitalAtRiskAttoWeth } from '#core/strategy'
import { networkConfiguration } from '#config/network'
import type { RiskLimits } from '#core/safety-controls'
import { evaluate, executionReadQuorum, type EvaluationConfiguration } from '#monitoring/opportunity-evaluation'
import { executableVenueQuotes, quoteVenue } from '#monitoring/venue-quotes'
import { inspectReport, type ReportInspectionConfiguration } from '#monitoring/report-inspection'
import type { Pool } from '#core/operator-types'
import type { Configuration } from '#config/configuration'
import { attoWethValue, valuationFromSqrtPrice, WETH_VALUATION } from '#core/collateral-valuation'
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
const config: EvaluationConfiguration & Pick<Configuration, 'collateralTokens' | 'maxSpotTwapTicks' | 'twapSeconds'> = {
	collateralTokens: [],
	maxSpotTwapTicks: 100n,
	twapSeconds: 60,
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
const pool: Pool = { venue: 'uniswap-v3', address: poolAddress, fee: 3000, liquidity: 10n ** 24n, quoteToken: network.weth, spotTick: 0n, token: rep, twapTick: 0n }
const marketBlock = { hash: `0x${'ab'.repeat(32)}` as Hex, number: 100n, observedAt: 1_000 }

function sqrt(value: bigint) {
	if (value < 2n) return value
	let root = value
	let next = (root + 1n) / 2n
	while (next < root) {
		root = next
		next = (root + value / root) / 2n
	}
	return root
}
function marginalSqrt(replacement: bigint, v4 = false) {
	const amount1 = calculateNextAmount1(report.game)
	return sqrt((2n ** 192n * (v4 ? replacement : amount1)) / (v4 ? amount1 : replacement))
}
function marginalReplacement(replacement: bigint, v4 = false) {
	const price = marginalSqrt(replacement, v4) ** 2n
	return v4 ? (calculateNextAmount1(report.game) * price) / 2n ** 192n : (calculateNextAmount1(report.game) * 2n ** 192n) / price
}
function slot0(price: bigint, tick = 0n) {
	return encodeAbiParameters([{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], [price, tick, 0n, 1n, 1n, 0n, true])
}
function v4Slot0(replacement: bigint) {
	return encodeAbiParameters([{ type: 'bytes32' }], [`0x${marginalSqrt(replacement, true).toString(16).padStart(64, '0')}`])
}

function quoterClient(options: { v3SellOut: bigint; v3BuyIn: bigint | undefined; replacementOut: bigint; v4: (fee: number) => { sellOut: bigint; buyIn: bigint } | undefined }) {
	const requests: { blockTag: unknown; functionName: string; target: string }[] = []
	let batched = 0
	const provider = multicallProvider(network.multicall3, ({ blockTag, data, to }) => {
		if (to === poolAddress) return slot0(marginalSqrt(options.replacementOut))
		if (to === v4PoolManager) return v4Slot0(options.replacementOut)
		if (to.toLowerCase() === network.quoter.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
			requests.push({ blockTag, functionName: decoded.functionName, target: 'v3' })
			if (decoded.functionName === 'quoteExactInputSingle') {
				const amountOut = decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase() ? options.v3SellOut : options.replacementOut
				return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [amountOut, 0n, 0n, 0n])
			}
			if (options.v3BuyIn === undefined) throw new Error('buy quote unavailable')
			return encodeAbiParameters(uniswapV3QuoterAbi[1].outputs, [options.v3BuyIn, 0n, 0n, 0n])
		}
		if (to.toLowerCase() === v4Quoter.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: uniswapV4QuoterAbi, data })
			requests.push({ blockTag, functionName: decoded.functionName, target: 'v4' })
			const quotes = options.v4(Number(decoded.args[0].poolKey.fee))
			if (quotes === undefined) throw new Error('V4 pool is not initialized')
			const exactInput = decoded.args[0].zeroForOne ? options.replacementOut : quotes.sellOut
			return encodeAbiParameters(uniswapV4QuoterAbi[0].outputs, [decoded.functionName === 'quoteExactInputSingle' ? exactInput : quotes.buyIn, 0n])
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
		const quoter = quoterClient({ replacementOut: 88n * 10n ** 18n, v3BuyIn: 0n, v3SellOut: 0n, v4: fee => (fee === 500 ? { buyIn: 132n * 10n ** 16n, sellOut: 13n * 10n ** 17n } : undefined) })
		const evaluation = await evaluate(quoter.client, { ...config, router: undefined }, report, { venue: 'uniswap-v4', address: v4PoolManager, fee: 500, quoteToken: network.weth, token: rep }, 10n ** 9n, marketBlock, WETH_VALUATION)
		expect(quoter.batched()).toBe(1)
		expect(quoter.requests).toHaveLength(3)
		expect(quoter.requests.every(request => request.blockTag === '0x64' && request.target === 'v4')).toBeTrue()
		expect(evaluation.replacementAmount2).toBe(marginalReplacement(88n * 10n ** 18n, true))
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
			const evaluation = await evaluate(client, { ...config, v4PoolManager: undefined, v4Quoter: undefined }, report, pool, 10n ** 9n, marketBlock, WETH_VALUATION)
			expect(evaluation.candidate).toBeUndefined()
			expect(evaluation.replacementAmount2).toBeUndefined()
			expect(evaluation.replacementQuoteFailure).toContain('execution reverted: quoter reverted')
		} finally {
			logged.mockRestore()
		}
	})
})

test('identifies insufficient V3 liquidity only when the failed buy exceeds the pool token balance', async () => {
	const provider = multicallProvider(network.multicall3, ({ blockTag, data, to }) => {
		expect(blockTag).toBe('0x64')
		if (to === poolAddress) return slot0(marginalSqrt(88n * 10n ** 18n))
		if (to.toLowerCase() === rep.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: erc20Abi, data })
			expect(decoded.functionName).toBe('balanceOf')
			expect(decoded.args).toEqual([pool.address])
			return encodeAbiParameters([{ type: 'uint256' }], [500n])
		}
		const decoded = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
		if (decoded.functionName === 'quoteExactOutputSingle') throw new Error('Unexpected error')
		return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [100n, 0n, 0n, 0n])
	})
	const client = createPublicClient({ chain: network.chain, transport: custom(provider) })
	const insufficient = await quoteVenue(client, config, pool, { sellAmount: 490n, buyAmount: 501n, replacementAmount1: 100n }, 100n)
	expect(insufficient.failureSummary).toBe('Not enough token liquidity')
	expect(insufficient.failure).toContain('Unexpected error')
	const otherFailure = await quoteVenue(client, config, pool, { sellAmount: 490n, buyAmount: 499n, replacementAmount1: 100n }, 100n)
	expect(otherFailure.failureSummary).toBe('Venue quote unavailable')
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
			if (to === poolAddress || to === otherPool.address) return slot0(marginalSqrt(quotes(to === poolAddress ? 3000 : 500).replacementOut ?? 88n * 10n ** 18n))
			if (to.toLowerCase() !== network.quoter.toLowerCase()) throw new Error(`Unexpected contract read ${to}`)
			const decoded = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
			const fee = Number(decoded.args[0].fee)
			if (decoded.functionName === 'quoteExactOutputSingle') return encodeAbiParameters(uniswapV3QuoterAbi[1].outputs, [quotes(fee).buyIn, 0n, 0n, 0n])
			if (decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase()) return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [quotes(fee).sellOut, 0n, 0n, 0n])
			const replacementOut = quotes(fee).replacementOut
			if (replacementOut === undefined) throw new Error('replacement quote reverted')
			return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [replacementOut, 0n, 0n, 0n])
		})
		return createPublicClient({ chain: network.chain, transport: custom(provider) })
	}

	test('keeps the best pool when only another pool lost its replacement quote', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(fee => (fee === 3000 ? { buyIn: 132n * 10n ** 16n, replacementOut: 88n * 10n ** 18n, sellOut: 13n * 10n ** 17n } : { buyIn: 9n * 10n ** 17n, replacementOut: undefined, sellOut: 11n * 10n ** 17n }))
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
			const client = poolQuoterClient(() => ({ buyIn: 132n * 10n ** 16n, replacementOut: undefined, sellOut: 13n * 10n ** 17n }))
			const decisions: string[] = []
			const evaluated = await inspectReport(client, undefined, inspectionConfig, report, [pool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], (_, reason) => decisions.push(reason))
			expect(evaluated?.candidate).toBeUndefined()
			expect(evaluated?.dexObservations).toEqual([])
			const reason = 'Uniswap V3: Venue quote unavailable'
			const reasonDetails = `Uniswap V3 ${pool.address} (fee 3000): Venue quote failed: Multicall contract call failed: execution reverted: replacement quote reverted`
			expect(evaluated?.opportunity).toEqual({
				decision: 'skipped',
				reason,
				reasonDetails,
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
			const mixedClient = poolQuoterClient(() => ({ buyIn: 132n * 10n ** 16n, replacementOut: undefined, sellOut: 13n * 10n ** 17n }))
			const mixed = await inspectReport(mixedClient, undefined, inspectionConfig, report, [drifted, otherPool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, undefined, metadata, true, true, false, [policy], () => {})
			expect(mixed?.opportunity).toMatchObject({
				decision: 'skipped',
				reason: 'Uniswap V3: Venue quote unavailable; 1 pool exceeds the 100 tick spot/TWAP limit',
				reasonDetails: `Uniswap V3 ${otherPool.address} (fee 500): Venue quote failed: Multicall contract call failed: execution reverted: replacement quote reverted`,
			})
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
		expect(decisions).toEqual(['Report creator is not an approved coordinator', `Report token1 ${otherPool.address} is neither WETH nor an allowlisted collateral token`, 'No configured pool can price REP', 'Report token was observed permissionlessly and is not in the execution allowlist'])
	})

	test('keeps timing skips visible while the report is inside its settlement window', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const client = poolQuoterClient(() => ({ buyIn: 132n * 10n ** 16n, replacementOut: 88n * 10n ** 18n, sellOut: 13n * 10n ** 17n }))
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
const reserveToken = 1_000_000n * 10n ** 18n
const reserveWeth = 13_000n * 10n ** 18n
const replacement = 88n * 10n ** 18n

function independentClient(venue: 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4', options: { replacement?: bigint; failReplacement?: boolean; empty?: boolean } = {}) {
	const calls: { blockTag: unknown; to: string }[] = []
	const provider = multicallProvider(
		network.multicall3,
		({ blockTag, data, to }) => {
			calls.push({ blockTag, to })
			if (venue === 'uniswap-v4' && to === v4PoolManager) return v4Slot0(options.replacement ?? replacement)
			if (venue === 'uniswap-v3' && to.toLowerCase() === poolAddress.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: poolAbi, data })
				if (decoded.functionName === 'liquidity') return encodeAbiParameters([{ type: 'uint128' }], [options.empty ? 0n : 10n ** 24n])
				if (decoded.functionName === 'slot0') return slot0(marginalSqrt(options.replacement ?? replacement), 5n)
				return encodeAbiParameters(
					[{ type: 'int56[]' }, { type: 'uint160[]' }],
					[
						[0n, 300n],
						[0n, 0n],
					],
				)
			}
			if (venue === 'uniswap-v3' && to.toLowerCase() === network.quoter.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
				const exactInput = decoded.functionName === 'quoteExactInputSingle' && decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase() ? 13n * 10n ** 17n : replacement
				const amount = decoded.functionName === 'quoteExactOutputSingle' ? 132n * 10n ** 16n : exactInput
				return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [amount, 0n, 0n, 0n])
			}
			if (venue === 'uniswap-v2' && to.toLowerCase() === pair.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: constantProductPairAbi, data })
				if (decoded.functionName === 'token0') return encodeAbiParameters([{ type: 'address' }], [rep])
				return encodeAbiParameters([{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }], [options.empty ? 0n : reserveToken, reserveWeth, 0n])
			}
			if (venue === 'uniswap-v4' && to.toLowerCase() === v4Quoter.toLowerCase()) {
				const decoded = decodeFunctionData({ abi: uniswapV4QuoterAbi, data })
				expect(decoded.args[0].poolKey.currency0).toBe('0x0000000000000000000000000000000000000000')
				expect(decoded.args[0].poolKey.currency1).toBe(rep)
				expect(decoded.args[0].poolKey.hooks).toBe('0x0000000000000000000000000000000000000000')
				if (options.empty) throw new Error('uninitialized V4 pool')
				if (decoded.functionName === 'quoteExactOutputSingle') return encodeAbiParameters(uniswapV4QuoterAbi[0].outputs, [132n * 10n ** 16n, 0n])
				if (decoded.args[0].zeroForOne) {
					expect(decoded.args[0].exactAmount).toBe(calculateNextAmount1(report.game))
					if (options.failReplacement) throw new Error('replacement unavailable')
					return encodeAbiParameters(uniswapV4QuoterAbi[0].outputs, [options.replacement ?? replacement, 0n])
				}
				return encodeAbiParameters(uniswapV4QuoterAbi[0].outputs, [13n * 10n ** 17n, 0n])
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
		const selected: Pool = { venue, address: venue === 'uniswap-v2' ? pair : v4PoolManager, fee: 3000, quoteToken: network.weth, token: rep }
		const enabled = { ...config, router: undefined, v2Router: venue === 'uniswap-v2' ? pair : undefined, v4PoolManager: venue === 'uniswap-v4' ? v4PoolManager : undefined, v4Quoter: venue === 'uniswap-v4' ? v4Quoter : undefined }
		const inspection: ReportInspectionConfiguration = { ...enabled, execute: false, maxSpotTwapTicks: 0n, minimumProfitAttoWeth: 0n, minimumProfitBps: 0n, minimumRemainingBlocks: 1n, minimumRemainingSeconds: 1n, openOracle: oracle }
		const reader = independentClient(venue)
		const evaluated = await inspectReport(reader.client, undefined, inspection, report, [{ ...pool, spotTick: 1000n }, selected], 100n, marketBlock.hash, 101n, 1n, undefined, { decimals: 18, symbol: 'REP' }, true, true, false, [{ ...report.game, coordinator: reporter, openOracle: oracle }], () => {})
		expect(evaluated?.opportunity).toMatchObject({ decision: 'dry-run-opportunity', venue })
		const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
		const execution = { ...enabled, connectivity: saved.connectivity, quorumRpcUrls: ['https://second.example'], rpcQuorum: 1 as const, executor: reporter, openOracle: oracle, twapSeconds: 60 }
		const snapshot = await executionReadQuorum([reader.client, independentClient(venue).client], execution, report, selected, venue, 3000, 100n, reporter)
		expect(snapshot.v3State).toBeUndefined()
		expect(snapshot.replacementAmount2).toBe(venue === 'uniswap-v2' ? (calculateNextAmount1(report.game) * reserveToken) / reserveWeth : marginalReplacement(replacement, true))
		expect(snapshot.sellHedgeQuote).toBe(venue === 'uniswap-v2' ? constantProductExactInput(report.game.currentAmount2, reserveToken, reserveWeth) : 13n * 10n ** 17n)
		if (venue === 'uniswap-v2') expect(snapshot.buyHedgeQuote).toBe(constantProductExactOutput(report.game.currentAmount2 + calculateFee(report.game.currentAmount2, report.game.feePercentage) + calculateFee(report.game.currentAmount2, report.game.protocolFee), reserveWeth, reserveToken))
		expect(reader.calls.every(call => call.blockTag === '0x64' && call.to.toLowerCase() !== network.quoter.toLowerCase() && call.to.toLowerCase() !== poolAddress.toLowerCase())).toBeTrue()
		await expect(executionReadQuorum([reader.client, independentClient(venue, { empty: true }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
		if (venue === 'uniswap-v4') {
			await expect(executionReadQuorum([reader.client, independentClient(venue, { replacement: replacement + 1n }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
			await expect(executionReadQuorum([independentClient(venue, { failReplacement: true }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow()
		}
		const disabled = await evaluate(reader.client, { ...enabled, v2Router: undefined, v4PoolManager: undefined, v4Quoter: undefined }, report, selected, 1n, marketBlock, WETH_VALUATION)
		expect(disabled.candidate).toBeUndefined()
	})
}

test('V3 retains its own liquidity and TWAP reads in the final quorum', async () => {
	const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
	const execution = { ...config, connectivity: saved.connectivity, quorumRpcUrls: ['https://second.example'], rpcQuorum: 1 as const, executor: reporter, openOracle: oracle, twapSeconds: 60 }
	const reader = independentClient('uniswap-v3')
	const snapshot = await executionReadQuorum([reader.client, independentClient('uniswap-v3').client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)
	expect(snapshot.v3State).toMatchObject({ liquidity: 10n ** 24n, spotTick: 5n, twapTick: 5n })
	expect(snapshot.replacementAmount2).toBe(marginalReplacement(replacement))
	await expect(executionReadQuorum([independentClient('uniswap-v3', { empty: true }).client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)).rejects.toThrow()
})

test('selects a profitable direction consistent with the same venue replacement ratio', async () => {
	const quoter = quoterClient({ replacementOut: 88n * 10n ** 18n, v3BuyIn: 132n * 10n ** 16n, v3SellOut: 13n * 10n ** 17n, v4: () => undefined })
	const evaluation = await evaluate(quoter.client, config, report, pool, 1n, marketBlock, WETH_VALUATION)
	expect(evaluation.candidate?.quote.direction).toBe('sell-rep')
	expect(evaluation.candidate?.quote.netProfitAttoWeth).toBeGreaterThan(0n)
})

test('a higher-profit sell with a missing buy quote cannot block an executable alternative venue', async () => {
	const quoter = quoterClient({ replacementOut: replacement, v3BuyIn: undefined, v3SellOut: 1132n * 10n ** 16n, v4: () => ({ sellOut: 13n * 10n ** 17n, buyIn: 132n * 10n ** 16n }) })
	const raw = await quoteVenue(quoter.client, config, pool, { sellAmount: report.game.currentAmount2, buyAmount: report.game.currentAmount2, replacementAmount1: calculateNextAmount1(report.game) }, 100n)
	expect(raw.sell).toBe(1132n * 10n ** 16n)
	expect(raw.replacement).toBe(marginalReplacement(replacement))
	expect(raw.buy).toBeUndefined()
	const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
	const execution = { ...config, connectivity: saved.connectivity, quorumRpcUrls: [], rpcQuorum: 1 as const, executor: reporter, openOracle: oracle, twapSeconds: 60 }
	await expect(executionReadQuorum([quoter.client], execution, report, pool, 'uniswap-v3', 3000, 100n, reporter)).rejects.toThrow('Selected venue quote failed')
	const inspection: ReportInspectionConfiguration = { ...config, execute: false, maxSpotTwapTicks: 100n, minimumProfitAttoWeth: 0n, minimumProfitBps: 0n, minimumRemainingBlocks: 1n, minimumRemainingSeconds: 1n, openOracle: oracle }
	const alternative: Pool = { venue: 'uniswap-v4', address: v4PoolManager, fee: 3000, quoteToken: network.weth, token: rep }
	const evaluated = await inspectReport(quoter.client, undefined, inspection, report, [pool, alternative], 100n, marketBlock.hash, 101n, 1n, undefined, { decimals: 18, symbol: 'REP' }, true, true, false, [{ ...report.game, coordinator: reporter, openOracle: oracle }], () => {})
	expect(evaluated?.opportunity).toMatchObject({ decision: 'dry-run-opportunity', venue: 'uniswap-v4' })
	const final = await executionReadQuorum([independentClient('uniswap-v4').client], execution, report, alternative, 'uniswap-v4', 3000, 100n, reporter)
	expect(final.replacementAmount2).toBe(marginalReplacement(replacement, true))
})

test('summarizes uninitialized V4 pools and keeps the decoded cause for details', async () => {
	const reverted = `0x6190b2b0${encodeAbiParameters([{ type: 'bytes' }], ['0x486aa307']).slice(2)}`
	const outputs = [
		{
			type: 'tuple[]',
			components: [
				{ name: 'success', type: 'bool' },
				{ name: 'returnData', type: 'bytes' },
			],
		},
	] as const
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: async () =>
				encodeAbiParameters(outputs, [
					[
						{ success: false, returnData: reverted },
						{ success: false, returnData: reverted },
						{ success: false, returnData: reverted },
						{ success: false, returnData: reverted },
					],
				]),
		}),
	})
	const quotes = await quoteVenue(client, config, { venue: 'uniswap-v4', address: v4PoolManager, fee: 500, quoteToken: network.weth, token: rep }, { sellAmount: 100n, buyAmount: 100n, replacementAmount1: 1n }, 100n)
	expect(quotes.failureSummary).toBe('Pool is not initialized')
	expect(quotes.failure).toContain('UnexpectedRevertBytes(PoolNotInitialized())')
})

test('#1483: final execution rejects excessive impact even when a pool passed earlier selection', async () => {
	const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
	const execution = { ...config, connectivity: saved.connectivity, quorumRpcUrls: [], rpcQuorum: 1 as const, executor: reporter, openOracle: oracle, twapSeconds: 60 }
	for (const venue of ['uniswap-v3', 'uniswap-v4'] as const) {
		const selected: Pool = venue === 'uniswap-v3' ? pool : { venue, address: v4PoolManager, quoteToken: network.weth, token: rep, fee: 3000 }
		await expect(executionReadQuorum([independentClient(venue, { replacement: 10n ** 18n }).client], execution, report, selected, venue, 3000, 100n, reporter)).rejects.toThrow('maximum price impact')
	}
})

describe('#1274: reports collateralized in an allowlisted non-WETH token', () => {
	const usdc = getAddress('0x00000000000000000000000000000000000000c0')
	const valuationPool = getAddress('0x00000000000000000000000000000000000000c1')
	const usdcPool: Pool = { venue: 'uniswap-v3', address: getAddress('0x00000000000000000000000000000000000000c2'), fee: 3000, liquidity: 10n ** 24n, quoteToken: usdc, spotTick: 0n, token: rep, twapTick: 0n }
	const usdcUnit = 10n ** 6n
	// 100 REP reported at 3000 USDC; the market sells 100 REP for 3900 USDC and WETH trades at 3000 USDC.
	const usdcReport: OpenOracleStatePreimage = { ...report, game: { ...report.game, currentAmount1: 3_000n * usdcUnit, escalationHalt: 10_000_000n * usdcUnit, token1: usdc } }
	const sellOut = 3_900n * usdcUnit
	const buyIn = 3_960n * usdcUnit
	const replacementOut = 88n * 10n ** 18n
	// USDC sorts before WETH, so the collateral/WETH pool price is atto-WETH per USDC base unit: 1e12 / 3000.
	const valuationSqrt = sqrt((2n ** 192n * 10n ** 12n) / 3_000n)
	const valuation = valuationFromSqrtPrice(usdc, network.weth, valuationSqrt)
	const collateralTokens = [{ address: usdc, wethPoolFee: 500 as const }]
	const account = getAddress('0x00000000000000000000000000000000000000a1')
	const usdcBalance = 1_000_000n * usdcUnit
	const blockTimestamp = report.game.reportTimestamp + report.game.disputeDelay + 1n

	function usdcClient(options: { valuationTick?: bigint } = {}) {
		const quoted: { tokenIn: string; tokenOut: string }[] = []
		const balanceReads: string[] = []
		const provider = multicallProvider(
			network.multicall3,
			({ data, to }) => {
				if (to.toLowerCase() === network.factory.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: uniswapV3FactoryAbi, data })
					expect(decoded.args).toEqual([usdc, network.weth, 500n])
					return encodeAbiParameters([{ type: 'address' }], [valuationPool])
				}
				if (to === valuationPool || to === usdcPool.address) {
					const decoded = decodeFunctionData({ abi: poolAbi, data })
					if (decoded.functionName === 'liquidity') return encodeAbiParameters([{ type: 'uint128' }], [10n ** 24n])
					if (decoded.functionName === 'slot0') return to === valuationPool ? slot0(valuationSqrt, options.valuationTick ?? 0n) : slot0(sqrt((2n ** 192n * replacementOut) / calculateNextAmount1(usdcReport.game)))
					return encodeAbiParameters(
						[{ type: 'int56[]' }, { type: 'uint160[]' }],
						[
							[0n, 0n],
							[0n, 0n],
						],
					)
				}
				if (to.toLowerCase() === network.quoter.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: uniswapV3QuoterAbi, data })
					quoted.push({ tokenIn: decoded.args[0].tokenIn, tokenOut: decoded.args[0].tokenOut })
					if (decoded.functionName === 'quoteExactOutputSingle') return encodeAbiParameters(uniswapV3QuoterAbi[1].outputs, [buyIn, 0n, 0n, 0n])
					return encodeAbiParameters(uniswapV3QuoterAbi[0].outputs, [decoded.args[0].tokenIn.toLowerCase() === rep.toLowerCase() ? sellOut : replacementOut, 0n, 0n, 0n])
				}
				if (to.toLowerCase() === oracle.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: openOracleAbi, data })
					return decoded.functionName === 'oracleGame' ? encodeAbiParameters([{ type: 'bytes32' }], [marketBlock.hash]) : encodeAbiParameters([{ type: 'uint256' }], [10n ** 30n])
				}
				if (to.toLowerCase() === usdc.toLowerCase() || to.toLowerCase() === rep.toLowerCase() || to.toLowerCase() === network.weth.toLowerCase()) {
					const decoded = decodeFunctionData({ abi: erc20Abi, data })
					if (decoded.functionName === 'balanceOf') balanceReads.push(to.toLowerCase())
					return encodeAbiParameters([{ type: 'uint256' }], [to.toLowerCase() === usdc.toLowerCase() ? usdcBalance : 10n ** 30n])
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
		return { balanceReads, client: createPublicClient({ chain: network.chain, transport: custom(provider) }), quoted }
	}

	const inspection: ReportInspectionConfiguration = {
		...config,
		collateralTokens,
		execute: true,
		maxSpotTwapTicks: 100n,
		// Above the raw USDC profit in base units, below its WETH value: the threshold must compare WETH-valued profit.
		minimumProfitAttoWeth: 10n ** 17n,
		minimumProfitBps: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		openOracle: oracle,
		v4PoolManager: undefined,
		v4Quoter: undefined,
	}
	// The shared feed's coordinator template names WETH; the operator allowlist adds USDC as accepted collateral.
	const usdcPolicy = { ...usdcReport.game, collateralTokens: [usdc], coordinator: reporter, openOracle: oracle, token1: network.weth }
	const balances = {
		attoWeth: 0n,
		ethAttoEth: 10n ** 18n,
		repAttoRep: 0n,
		tokens: new Map([
			[usdc.toLowerCase(), usdcBalance],
			[rep.toLowerCase(), 10n ** 24n],
		]),
	}
	const inspect = (client: ReturnType<typeof usdcClient>['client'], configuration: ReportInspectionConfiguration, policies: readonly (typeof usdcPolicy)[], decisions: string[]) =>
		inspectReport(client, { account: privateKeyToAccount(`0x${'22'.repeat(32)}`) }, configuration, usdcReport, [pool, usdcPool], 100n, marketBlock.hash, blockTimestamp, 10n ** 9n, balances, { decimals: 18, symbol: 'REP' }, true, true, false, policies, (_, reason) => decisions.push(reason), {
			decimals: 6,
			symbol: 'USDC',
		})

	test('an allowlisted collateral report becomes an eligible candidate priced against its own pool and valued in WETH', async () => {
		const logged = spyOn(console, 'log').mockImplementation(() => {})
		try {
			const reader = usdcClient()
			const decisions: string[] = []
			const evaluated = await inspect(reader.client, inspection, [usdcPolicy], decisions)
			expect(decisions).toEqual([])
			const candidate = evaluated?.candidate
			if (candidate === undefined) throw new Error(`Expected an eligible candidate, got ${JSON.stringify(evaluated?.opportunity)}`)
			expect(candidate.pool).toEqual(usdcPool)
			expect(candidate.quote).toMatchObject({ direction: 'sell-rep', grossProceedsToken1: sellOut, tokenToSwap: usdc, valuation })
			const fees = calculateFee(usdcReport.game.currentAmount1, usdcReport.game.feePercentage) + calculateFee(usdcReport.game.currentAmount1, usdcReport.game.protocolFee)
			expect(candidate.quote.hedgeCostToken1).toBe(usdcReport.game.currentAmount1 + fees)
			expect(candidate.quote.profitBeforeGasAttoWeth).toBe(attoWethValue(valuation, sellOut - usdcReport.game.currentAmount1 - fees, 'down'))
			// The sell-direction dispute pulls newAmount1 plus the replaced report's USDC and fees, and the replaced REP.
			const newAmount1 = calculateNextAmount1(usdcReport.game)
			const funding = { token1: newAmount1 + usdcReport.game.currentAmount1 + fees, token2: usdcReport.game.currentAmount2 }
			expect(evaluated?.opportunity).toMatchObject({ collateralSymbol: 'USDC', decision: 'eligible', hasRequiredInventory: true, pool: usdcPool.address, requiredToken: '100', requiredWeth: '6483' })
			const hedgeLimit = (sellOut * (10_000n - config.maxHedgeSlippageBps)) / 10_000n
			expect(candidate.capitalAtRiskAttoWeth).toBe(fundedCapitalAtRiskAttoWeth(funding, usdcReport.game.currentAmount2, sellOut, hedgeLimit, valuation))
			expect(candidate.capitalAtRiskAttoWeth).toBeGreaterThan(10n ** 18n)
			// Every hedge quote trades REP against USDC, and a collateral pool never feeds the REP/ETH consensus.
			expect(reader.quoted.length).toBeGreaterThan(0)
			expect(
				reader.quoted.every(
					quote =>
						[quote.tokenIn, quote.tokenOut]
							.map(token => token.toLowerCase())
							.sort()
							.join() ===
						[rep, usdc]
							.map(token => token.toLowerCase())
							.sort()
							.join(),
				),
			).toBeTrue()
			expect(evaluated?.dexObservations).toEqual([])
		} finally {
			logged.mockRestore()
		}
	})

	test('a collateral the operator did not allowlist is skipped with the token named', async () => {
		const decisions: string[] = []
		const reason = `Report token1 ${usdc} is neither WETH nor an allowlisted collateral token`
		expect(await inspect(usdcClient().client, { ...inspection, collateralTokens: [] }, [{ ...usdcPolicy, collateralTokens: [] }], decisions)).toBeUndefined()
		expect(await inspect(usdcClient().client, { ...inspection, collateralTokens: [] }, [usdcPolicy], decisions)).toBeUndefined()
		expect(decisions).toEqual([reason, reason])
	})

	test('a manipulated collateral/WETH valuation pool keeps the report visible but unpriced', async () => {
		const decisions: string[] = []
		const evaluated = await inspect(usdcClient({ valuationTick: 500n }).client, inspection, [usdcPolicy], decisions)
		expect(evaluated?.candidate).toBeUndefined()
		expect(evaluated?.opportunity).toMatchObject({ decision: 'skipped', reason: `Collateral/WETH pool ${valuationPool} exceeds the 100 tick spot/TWAP limit` })
	})

	test('the final execution quorum quotes, values, and funds the dispute in the report collateral', async () => {
		const saved = parseOperatorSettings(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).json())
		const execution = { ...config, collateralTokens, connectivity: saved.connectivity, quorumRpcUrls: ['https://second.example'], rpcQuorum: 1 as const, executor: reporter, openOracle: oracle }
		const reader = usdcClient()
		const snapshot = await executionReadQuorum([reader.client, usdcClient().client], execution, usdcReport, usdcPool, 'uniswap-v3', 3000, 100n, account)
		expect(snapshot).toMatchObject({ sellHedgeQuote: sellOut, buyHedgeQuote: buyIn, token1: usdcBalance, valuation })
		expect(reader.balanceReads).toContain(usdc.toLowerCase())
		expect(reader.balanceReads).not.toContain(network.weth.toLowerCase())
		await expect(executionReadQuorum([usdcClient().client], { ...execution, collateralTokens: [] }, usdcReport, usdcPool, 'uniswap-v3', 3000, 100n, account)).rejects.toThrow('neither WETH nor an allowlisted collateral token')
		await expect(executionReadQuorum([usdcClient().client], execution, usdcReport, pool, 'uniswap-v3', 3000, 100n, account)).rejects.toThrow('does not trade the report collateral')
	})

	test('V4 native-ETH pools cannot hedge non-WETH collateral', async () => {
		const quotes = await quoteVenue(usdcClient().client, { ...config, v4PoolManager, v4Quoter }, { venue: 'uniswap-v4', address: v4PoolManager, fee: 3000, quoteToken: usdc, token: rep }, { sellAmount: 1n, buyAmount: 1n, replacementAmount1: 1n }, 100n)
		expect(quotes.failure).toBe('Uniswap V4 hedges settle only against native ETH for WETH collateral')
		expect(executableVenueQuotes(quotes)).toBeUndefined()
	})
})
