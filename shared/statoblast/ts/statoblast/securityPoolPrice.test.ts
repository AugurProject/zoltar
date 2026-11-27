import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolPriceOperationsRequest, buildSecurityPoolPriceApprovalRequest, buildSecurityPoolPricePreparationRequest, buildSecurityPoolPriceRequest, buildSecurityPoolPriceWrapRequest, loadSecurityPoolPriceSnapshot, quoteSecurityPoolPriceFunding } from './securityPool.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const securityPool: Address = '0x0000000000000000000000000000000000000002'
const factory: Address = '0x0000000000000000000000000000000000000003'
const seed: Address = '0x0000000000000000000000000000000000000004'
const zoltar: Address = '0x0000000000000000000000000000000000000005'
const feed: Address = '0x0000000000000000000000000000000000000006'
const rep: Address = '0x0000000000000000000000000000000000000007'
const weth: Address = '0x0000000000000000000000000000000000000008'
const oracle: Address = '0x0000000000000000000000000000000000000009'
const unit = 10n ** 18n
const settlementBounty = 15_804_573n * 10_000_000_000n + 101n
const supportedOperation = encodeFunctionData({ abi: parseAbi(['function setHealthTarget(uint256 target)']), functionName: 'setHealthTarget', args: [15000n] })
const hash: Hex = `0x${'11'.repeat(32)}`
const abi = parseAbi([
	'function prepareSecurityPoolPriceFeed(address source,uint248 universeId) returns (address)',
	'function requestSecurityPoolPrice(uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth) payable returns (uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])

function fixture(overrides: Record<string, unknown> = {}) {
	const calls: { functionName: string; address: Address; blockNumber: bigint }[] = []
	const values: Record<string, unknown> = {
		collateralToken: weth,
		factory,
		originUniverseId: 0n,
		getQuestions: [123n],
		getQuestionLedger: seed,
		zoltar,
		priceFeed: feed,
		isPriceReportingOpen: true,
		securityPoolOf: securityPool,
		getQuestionLedgerOriginId: hash,
		// The factory's getQuestionLedger(originId, universeId) shares its name with the security pool's question lookup.
		factoryGetQuestionLedger: seed,
		sharedPriceFeeds: feed,
		getRepToken: rep,
		securityPool,
		securityPoolFactory: factory,
		reputationToken: rep,
		weth,
		openOracle: oracle,
		oracleExposure: 100n * unit,
		minimumReportCollateral: unit,
		minimumToken1ReportAttoEth: 2n * unit,
		minimumToken2ReportAttoRep: 0n,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		getSettlementCallbackGasLimit: 4_000_000n,
		maxSettlementBaseFeeMultiplierBps: 30_000n,
		lastPrice: unit,
		lastSettlementTimestamp: 800n,
		priceValidityWindowSeconds: 600n,
		settlementTime: 300n,
		escalationHaltMultiplierBps: 30000n,
		pendingReportId: 9n,
		balanceOf: 20n * unit,
		allowance: 10n * unit,
		...overrides,
	}
	const client: Parameters<typeof loadSecurityPoolPriceSnapshot>[0]['client'] = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: 1_000n }),
		getBalance: async parameters => {
			expect(parameters).toEqual({ address: owner, blockNumber: 10n })
			return 10n * unit
		},
		readContract: async parameters => {
			calls.push(parameters)
			if (parameters.functionName === 'universeId') return parameters.address === seed ? 0n : 42n
			const key = parameters.functionName === 'getQuestionLedger' && typeof parameters.args?.[0] === 'string' ? 'factoryGetQuestionLedger' : parameters.functionName
			if (!(key in values)) throw new Error(`Unexpected read ${key}`)
			return values[key]
		},
	}
	return { client, calls }
}
const load = (client: Parameters<typeof loadSecurityPoolPriceSnapshot>[0]['client']) => loadSecurityPoolPriceSnapshot({ client, securityPool, owner, universeId: 42n })

describe('security pool branch price SDK', () => {
	test('#1341 exposes the report coverage and its remaining growth headroom', async () => {
		const snapshot = await load(fixture().client)
		expect(quoteSecurityPoolPriceFunding(snapshot, unit, (25n * unit) / 10n)).toMatchObject({ coveredExposureAttoEth: 150n * unit, growthHeadroomAttoEth: 50n * unit })
	})
	test('#1252 operation batches fund the extra public settlement work', async () => {
		const snapshot = await load(fixture({ getRequestPriceCostAttoEth: 1_000_000_101n }).client)
		const quoted = quoteSecurityPoolPriceFunding(snapshot, unit, 2n * unit, 200_000n)
		expect(quoted.bounty).toBeGreaterThan(1_000_000_101n)
		expect(quoted.requiredEth).toBe(quoted.bounty)
		const batch = { gasLimit: 200_000n, minimumPrice: unit, maximumPrice: unit, deadline: 2_000n, operations: [{ gasLimit: 100_000n, data: supportedOperation }] }
		const request = buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, batch)
		expect(request.value).toBeGreaterThan(1_000_000_101n)
	})
	test('operation batches are bounded by gas and preserve caller order without a count cap', async () => {
		const snapshot = await load(fixture().client)
		const operations = Array.from({ length: 32 }, () => ({ gasLimit: 80_000n, data: supportedOperation }))
		const batch = { gasLimit: 5_760_000n, minimumPrice: unit, maximumPrice: unit, deadline: 2_000n, operations }
		const request = buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, batch)
		for (const bytes of [512, 513]) {
			const data: Hex = `0x${supportedOperation.slice(2, 10)}${'ab'.repeat(bytes - 4)}`
			const build = () => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, operations: [{ gasLimit: 80_000n, data }] })
			if (bytes === 512) expect(build).not.toThrow()
			else expect(build).toThrow('512 bytes')
		}
		const operationAbi = parseAbi(['function requestSecurityPoolPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])
		expect(decodeFunctionData({ abi: operationAbi, data: request.data })).toEqual({ functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 2n * unit, 36_869_712n * 10_000_000_000n + 101n, batch] })
		expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, gasLimit: batch.gasLimit - 1n })).toThrow('gas budget')
		// The feed adds 4,000,000 settlement gas and rejects a callback above 10,000,000.
		expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, gasLimit: 6_000_000n })).not.toThrow()
		expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, gasLimit: 6_000_001n })).toThrow('Report settlement gas exceeds the limit')
	})

	test('a confirmed execution quote requires the requested block for every funding read', async () => {
		const { client, calls } = fixture()
		const heads: (bigint | undefined)[] = []
		const pinned = {
			...client,
			getBlock: async (parameters?: { blockNumber?: bigint }) => {
				heads.push(parameters?.blockNumber)
				return { number: parameters?.blockNumber ?? 11n, hash, timestamp: 1_000n }
			},
		}
		await loadSecurityPoolPriceSnapshot({ client: pinned, securityPool, owner, universeId: 42n, blockNumber: 10n })
		expect(heads).toEqual([10n, 10n])
		expect(calls.every(call => call.blockNumber === 10n)).toBe(true)
		await expect(loadSecurityPoolPriceSnapshot({ client, securityPool, owner, universeId: 42n, blockNumber: 9n })).rejects.toThrow('another block')
	})

	test('prices the independently required auction REP challenge budget into the signed WETH amount', async () => {
		const snapshot = await load(fixture({ minimumToken1ReportAttoEth: 2n, minimumToken2ReportAttoRep: 11n }).client)
		const quote = quoteSecurityPoolPriceFunding(snapshot, 3n * unit)
		expect(quote.weth).toBe(4n)
		expect(quote.rep).toBe(12n)
	})
	test('#1252 derives the settlement bounty from pinned immutable settings and base fee', async () => {
		const { client, calls } = fixture()
		const anchored = { ...client, getBlock: async () => ({ number: 10n, hash, timestamp: 1_000n, baseFeePerGas: 7n }) }
		const snapshot = await load(anchored)
		expect(snapshot.observation?.bounty).toBe(15_804_573n * (10_000_000_000n + 7n) + 101n)
		const reviewed = quoteSecurityPoolPriceFunding(snapshot, unit)
		const nextBlock = await load({ ...client, getBlock: async () => ({ number: 10n, hash, timestamp: 1_000n, baseFeePerGas: 8n }) })
		const laterBlock = await load({ ...client, getBlock: async () => ({ number: 10n, hash, timestamp: 1_000n, baseFeePerGas: 9n }) })
		expect(nextBlock.observation?.bounty).toBe(reviewed.bounty)
		expect(laterBlock.observation?.bounty ?? 0n).toBeGreaterThan(reviewed.bounty)
		expect(calls.find(call => call.functionName === 'getSettlementCallbackGasLimit')).toMatchObject({ blockNumber: 10n })
	})

	test('authenticates one feed and all funding reads at the same block', async () => {
		const { client, calls } = fixture()
		const snapshot = await load(client)
		expect(snapshot).toMatchObject({ owner, securityPool, factory, originUniverseId: 0n, feed, repToken: rep, universeId: 42n, reportingOpen: true })
		expect(snapshot.observation).toMatchObject({ weth, openOracle: oracle, minimumWethAttoEth: 2n * unit, bounty: settlementBounty, repAllowanceAttoRep: 10n * unit })
		expect(new Set(calls.map(call => call.blockNumber))).toEqual(new Set([10n]))
		expect(calls.length).toBeLessThan(40)
		expect(calls.some(call => call.functionName === 'questionLedger' || call.functionName === 'stagedOperations')).toBe(false)
	})
	test('missing feeds remain readable and produce only a canonical preparation transaction', async () => {
		const { client, calls } = fixture({ priceFeed: zeroAddress, sharedPriceFeeds: zeroAddress, isPriceReportingOpen: false, getRepToken: zeroAddress })
		const snapshot = await load(client)
		expect(snapshot.observation).toBeUndefined()
		expect(calls.some(call => call.address === zeroAddress)).toBe(false)
		const request = buildSecurityPoolPricePreparationRequest(snapshot)
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'prepareSecurityPoolPriceFeed', args: [seed, 42n] })
		expect(() => quoteSecurityPoolPriceFunding(snapshot, unit)).toThrow('Prepare')
	})
	test('a security pool without admitted questions has no preparation source but existing reports remain readable', async () => {
		const snapshot = await load(fixture({ getQuestions: [] }).client)
		expect(snapshot.sourcePool).toBeUndefined()
		expect(snapshot.observation?.pendingReportId).toBe(9n)
		expect(() => buildSecurityPoolPricePreparationRequest(snapshot)).toThrow('No registered origin question')
	})
	test('a predeployed feed stays readable before capital registration without exposure sizing', async () => {
		const { client, calls } = fixture({ isPriceReportingOpen: false })
		const snapshot = await load(client)
		expect(snapshot.observation?.minimumWethAttoEth).toBeUndefined()
		expect(snapshot.observation?.pendingReportId).toBe(9n)
		expect(calls.some(call => call.functionName === 'minimumToken1ReportAttoEth')).toBe(false)
		expect(() => quoteSecurityPoolPriceFunding(snapshot, unit)).toThrow('closed')
	})
	test.each([{ securityPool: owner }, { securityPoolFactory: owner }, { reputationToken: owner }, { sharedPriceFeeds: owner }, { factoryGetQuestionLedger: owner }, { securityPoolOf: owner }])('rejects mismatched canonical identities %j', async overrides => {
		await expect(load(fixture(overrides).client)).rejects.toThrow()
	})
	test('quotes upward REP rounding and exact wrap and bounty requirements', async () => {
		const snapshot = await load(fixture({ minimumToken1ReportAttoEth: 3n, balanceOf: 1n }).client)
		expect(quoteSecurityPoolPriceFunding(snapshot, unit + 1n)).toEqual({ price: unit + 1n, weth: 3n, minimumWeth: 3n, rep: 4n, wrap: 2n, bounty: settlementBounty, requiredEth: settlementBounty + 2n, coveredExposureAttoEth: 0n, growthHeadroomAttoEth: 0n })
		expect(quoteSecurityPoolPriceFunding(snapshot, unit, 7n)).toMatchObject({ weth: 7n, rep: 7n, wrap: 6n })
		expect(() => quoteSecurityPoolPriceFunding(snapshot, 0n)).toThrow('positive')
	})
	test('funds a default report above the current minimum so exposure growth before settlement cannot void it', async () => {
		const snapshot = await load(fixture({ minimumToken1ReportAttoEth: 101n * unit, minimumToken2ReportAttoRep: 1n }).client)
		expect(quoteSecurityPoolPriceFunding(snapshot, unit).weth).toBe(101n * unit + (101n * unit) / 20n)
		expect(quoteSecurityPoolPriceFunding(snapshot, unit, 200n * unit).weth).toBe(200n * unit)
	})
	test('rejects prices and amounts outside the feed range', async () => {
		const snapshot = await load(fixture().client)
		expect(() => quoteSecurityPoolPriceFunding(snapshot, 1n << 255n)).toThrow('Initial REP report is out of range.')
		expect(() => quoteSecurityPoolPriceFunding(snapshot, unit, 1n << 128n)).toThrow('WETH for the report is out of range.')
	})
	test('request, wrapping and editable approvals are distinct bounded transactions', async () => {
		const snapshot = await load(fixture().client)
		const request = buildSecurityPoolPriceRequest(snapshot, 3n * unit)
		expect(request).toMatchObject({ account: owner, to: feed, value: settlementBounty })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestSecurityPoolPrice', args: [3n * unit, (21n * unit) / 10n, settlementBounty] })
		for (const token of ['weth', 'rep'] as const) {
			const approval = buildSecurityPoolPriceApprovalRequest(snapshot, token, 99n * unit)
			expect(approval.to).toBe(token === 'weth' ? weth : rep)
			expect(decodeFunctionData({ abi, data: approval.data })).toEqual({ functionName: 'approve', args: [feed, 99n * unit] })
		}
		expect(buildSecurityPoolPriceWrapRequest(snapshot, unit)).toMatchObject({ account: owner, to: weth, value: unit })
		expect(() => buildSecurityPoolPriceRequest({ ...snapshot, reportingOpen: false }, unit)).toThrow('closed')
	})
	test('reorganizations and changed chain identities invalidate the snapshot', async () => {
		const reorg = fixture()
		reorg.client.getBlock = async parameters => ({ number: 10n, hash: parameters?.blockNumber === undefined ? hash : `0x${'22'.repeat(32)}`, timestamp: 1_000n })
		await expect(load(reorg.client)).rejects.toThrow('changed')
		const chain = fixture()
		let calls = 0
		chain.client.getChainId = async () => ++calls
		await expect(load(chain.client)).rejects.toThrow('changed')
	})
})

test('a non-WETH collateral report uses raw-unit pricing and never adds token funding to its ETH budget', async () => {
	const collateralToken = '0x0000000000000000000000000000000000000010'
	const snapshot = await load(fixture({ collateralToken, minimumToken1ReportAttoEth: 10_000n, minimumToken2ReportAttoRep: 0n }).client)
	const funding = quoteSecurityPoolPriceFunding(snapshot, 10n ** 30n, 1_000_000n)
	expect(funding.rep).toBe(10n ** 18n)
	expect(funding.wrap).toBe(0n)
	expect(funding.requiredEth).toBe(funding.bounty)
	expect(buildSecurityPoolPriceApprovalRequest(snapshot, 'weth', funding.weth).to).toBe(collateralToken)
	expect(() => buildSecurityPoolPriceWrapRequest(snapshot, 1n)).toThrow()
})

test('#1637 explicit funding below the minimum is rejected by both request builders', async () => {
	const snapshot = await load(fixture().client)
	expect(() => buildSecurityPoolPriceRequest(snapshot, unit, unit)).toThrow('minimum')
	expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, unit, { gasLimit: 200_000n, minimumPrice: unit, maximumPrice: unit, deadline: 2000n, operations: [{ gasLimit: 100_000n, data: '0x12345678' }] })).toThrow('minimum')
	expect(quoteSecurityPoolPriceFunding(snapshot, unit, 0n).weth).toBeGreaterThan(2n * unit)
	expect(quoteSecurityPoolPriceFunding(snapshot, unit, 2n * unit).weth).toBe(2n * unit)
})
test('#1705 unsupported sponsored operations are rejected before funding', async () => {
	const snapshot = await load(fixture().client)
	expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { gasLimit: 200_000n, minimumPrice: unit, maximumPrice: unit, deadline: 2000n, operations: [{ gasLimit: 100_000n, data: '0x12345678' }] })).toThrow('Unsupported report operation')
})

test('#1756 report funding enforces the oracle dispute limit uint128 bound', async () => {
	const snapshot = await load(fixture({ escalationHaltMultiplierBps: 30000n }).client)
	const maximum = ((1n << 128n) - 1n) / 3n
	expect(quoteSecurityPoolPriceFunding(snapshot, unit, maximum).weth).toBe(maximum)
	expect(() => quoteSecurityPoolPriceFunding(snapshot, unit, maximum + 1n)).toThrow('Dispute limit is out of range.')
})

test('#1756 an operations bounty must also fit the oracle uint96 domain', async () => {
	const snapshot = await load(fixture().client)
	if (snapshot.observation === undefined) throw new Error('Expected feed')
	snapshot.observation.nextBlockBounty = ((1n << 96n) - 1n) / 2n
	expect(() => quoteSecurityPoolPriceFunding(snapshot, unit, 2n * unit, 6000000n)).toThrow('Settlement bounty is out of range.')
})

test('#1682 operation deadline includes the first eligible settlement second', async () => {
	const { client } = fixture()
	const snapshot = await load(client)
	const batch = { gasLimit: 300_000n, minimumPrice: unit, maximumPrice: unit, deadline: snapshot.timestamp + 299n, operations: [{ gasLimit: 100_000n, data: supportedOperation }] }
	expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, batch)).toThrow('before settlement')
	expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, deadline: snapshot.timestamp + 300n })).not.toThrow()
})

test('#1624 funding rejects a positive price with an unpublishable liquidation bound', async () => {
	const snapshot = await load(fixture().client)
	expect(() => quoteSecurityPoolPriceFunding(snapshot, 1n)).toThrow('liquidation price')
	expect(quoteSecurityPoolPriceFunding(snapshot, 2n).price).toBe(2n)
})
