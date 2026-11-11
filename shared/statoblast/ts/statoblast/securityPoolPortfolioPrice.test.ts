import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPriceOperationsRequest, buildPortfolioPriceApprovalRequest, buildPortfolioPricePreparationRequest, buildPortfolioPriceRequest, buildPortfolioPriceWrapRequest, loadPortfolioPriceSnapshot, quotePortfolioPriceFunding } from './securityPoolPortfolio.js'

const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const factory: Address = '0x0000000000000000000000000000000000000003'
const seed: Address = '0x0000000000000000000000000000000000000004'
const zoltar: Address = '0x0000000000000000000000000000000000000005'
const feed: Address = '0x0000000000000000000000000000000000000006'
const rep: Address = '0x0000000000000000000000000000000000000007'
const weth: Address = '0x0000000000000000000000000000000000000008'
const oracle: Address = '0x0000000000000000000000000000000000000009'
const unit = 10n ** 18n
const hash: Hex = `0x${'11'.repeat(32)}`
const abi = parseAbi([
	'function preparePortfolioPriceFeed(address source,uint248 universeId) returns (address)',
	'function requestPortfolioPrice(uint256 proposedRepPerEthPrice,uint256 requestedInitialAttoWeth,uint256 bountyAttoEth) payable returns (uint256)',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function deposit() payable',
])

function fixture(overrides: Record<string, unknown> = {}) {
	const calls: { functionName: string; address: Address; blockNumber: bigint }[] = []
	const values: Record<string, unknown> = {
		factory,
		originUniverseId: 0n,
		getQuestions: [123n],
		getPool: seed,
		zoltar,
		priceFeed: feed,
		isPriceReportingOpen: true,
		getSecurityPoolPortfolio: portfolio,
		getSecurityPoolOriginId: hash,
		getSecurityPool: seed,
		sharedPriceFeeds: feed,
		getRepToken: rep,
		portfolio,
		securityPoolFactory: factory,
		reputationToken: rep,
		weth,
		openOracle: oracle,
		minimumToken1ReportAttoEth: 2n * unit,
		minimumToken2ReportAttoRep: 0n,
		getRequestPriceCostAttoEth: 101n,
		lastPrice: unit,
		lastSettlementTimestamp: 800n,
		priceValidityWindowSeconds: 600n,
		settlementTime: 300n,
		pendingReportId: 9n,
		balanceOf: 20n * unit,
		allowance: 10n * unit,
		...overrides,
	}
	const client: Parameters<typeof loadPortfolioPriceSnapshot>[0]['client'] = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: 1_000n }),
		getBalance: async parameters => {
			expect(parameters).toEqual({ address: owner, blockNumber: 10n })
			return 10n * unit
		},
		readContract: async parameters => {
			calls.push(parameters)
			if (parameters.functionName === 'universeId') return parameters.address === seed ? 0n : 42n
			if (!(parameters.functionName in values)) throw new Error(`Unexpected read ${parameters.functionName}`)
			return values[parameters.functionName]
		},
	}
	return { client, calls }
}
const load = (client: Parameters<typeof loadPortfolioPriceSnapshot>[0]['client']) => loadPortfolioPriceSnapshot({ client, portfolio, owner, universeId: 42n })

describe('portfolio branch price SDK', () => {
	test('operation batches are bounded by gas and preserve caller order without a count cap', async () => {
		const snapshot = await load(fixture().client)
		const operations = Array.from({ length: 32 }, () => ({ gasLimit: 100_000n, data: '0x12345678' as const }))
		const batch = { gasLimit: 6_400_000n, minimumPrice: unit, maximumPrice: unit, deadline: 2_000n, operations }
		const request = buildPortfolioPriceOperationsRequest(snapshot, unit, 2n * unit, batch)
		const operationAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])
		expect(decodeFunctionData({ abi: operationAbi, data: request.data })).toEqual({ functionName: 'requestPortfolioPriceWithOperations', args: [unit, 2n * unit, 101n, batch] })
		expect(() => buildPortfolioPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, gasLimit: batch.gasLimit - 1n })).toThrow('gas budget')
		expect(() => buildPortfolioPriceOperationsRequest(snapshot, unit, 2n * unit, { ...batch, gasLimit: 2n ** 32n })).toThrow('Callback gas')
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
		await loadPortfolioPriceSnapshot({ client: pinned, portfolio, owner, universeId: 42n, blockNumber: 10n })
		expect(heads).toEqual([10n, 10n])
		expect(calls.every(call => call.blockNumber === 10n)).toBe(true)
		await expect(loadPortfolioPriceSnapshot({ client, portfolio, owner, universeId: 42n, blockNumber: 9n })).rejects.toThrow('another block')
	})

	test('prices the independently required auction REP challenge budget into the signed WETH amount', async () => {
		const snapshot = await load(fixture({ minimumToken1ReportAttoEth: 2n, minimumToken2ReportAttoRep: 11n }).client)
		const quote = quotePortfolioPriceFunding(snapshot, 3n * unit)
		expect(quote.weth).toBe(4n)
		expect(quote.rep).toBe(12n)
	})
	test('authenticates one feed and all funding reads at the same block', async () => {
		const { client, calls } = fixture()
		const snapshot = await load(client)
		expect(snapshot).toMatchObject({ owner, portfolio, factory, originUniverseId: 0n, feed, repToken: rep, universeId: 42n, reportingOpen: true })
		expect(snapshot.observation).toMatchObject({ weth, openOracle: oracle, minimumWethAttoEth: 2n * unit, bounty: 101n, repAllowanceAttoRep: 10n * unit })
		expect(new Set(calls.map(call => call.blockNumber))).toEqual(new Set([10n]))
		expect(calls.length).toBeLessThan(40)
		expect(calls.some(call => call.functionName === 'securityPool' || call.functionName === 'stagedOperations')).toBe(false)
	})
	test('missing feeds remain readable and produce only a canonical preparation transaction', async () => {
		const { client, calls } = fixture({ priceFeed: zeroAddress, sharedPriceFeeds: zeroAddress, isPriceReportingOpen: false, getRepToken: zeroAddress })
		const snapshot = await load(client)
		expect(snapshot.observation).toBeUndefined()
		expect(calls.some(call => call.address === zeroAddress)).toBe(false)
		const request = buildPortfolioPricePreparationRequest(snapshot)
		expect(request).toMatchObject({ account: owner, to: factory, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'preparePortfolioPriceFeed', args: [seed, 42n] })
		expect(() => quotePortfolioPriceFunding(snapshot, unit)).toThrow('Prepare')
	})
	test('a portfolio without admitted questions has no preparation source but existing reports remain readable', async () => {
		const snapshot = await load(fixture({ getQuestions: [] }).client)
		expect(snapshot.sourcePool).toBeUndefined()
		expect(snapshot.observation?.pendingReportId).toBe(9n)
		expect(() => buildPortfolioPricePreparationRequest(snapshot)).toThrow('No registered origin question')
	})
	test('a predeployed feed stays readable before capital registration without exposure sizing', async () => {
		const { client, calls } = fixture({ isPriceReportingOpen: false })
		const snapshot = await load(client)
		expect(snapshot.observation?.minimumWethAttoEth).toBeUndefined()
		expect(snapshot.observation?.pendingReportId).toBe(9n)
		expect(calls.some(call => call.functionName === 'minimumToken1ReportAttoEth')).toBe(false)
		expect(() => quotePortfolioPriceFunding(snapshot, unit)).toThrow('closed')
	})
	test.each([{ portfolio: owner }, { securityPoolFactory: owner }, { reputationToken: owner }, { sharedPriceFeeds: owner }, { getSecurityPool: owner }, { getSecurityPoolPortfolio: owner }])('rejects mismatched canonical identities %j', async overrides => {
		await expect(load(fixture(overrides).client)).rejects.toThrow()
	})
	test('quotes upward REP rounding and exact wrap and bounty requirements', async () => {
		const snapshot = await load(fixture({ minimumToken1ReportAttoEth: 3n, balanceOf: 1n }).client)
		expect(quotePortfolioPriceFunding(snapshot, unit + 1n)).toEqual({ price: unit + 1n, weth: 3n, rep: 4n, wrap: 2n, bounty: 101n, requiredEth: 103n })
		expect(quotePortfolioPriceFunding(snapshot, unit, 7n)).toMatchObject({ weth: 7n, rep: 7n, wrap: 6n })
		expect(() => quotePortfolioPriceFunding(snapshot, 0n)).toThrow('positive')
		expect(() => quotePortfolioPriceFunding(snapshot, 1n << 255n)).toThrow('uint128')
		expect(() => quotePortfolioPriceFunding(snapshot, unit, 1n << 128n)).toThrow('uint128')
	})
	test('request, wrapping and editable approvals are distinct bounded transactions', async () => {
		const snapshot = await load(fixture().client)
		const request = buildPortfolioPriceRequest(snapshot, 3n * unit)
		expect(request).toMatchObject({ account: owner, to: feed, value: 101n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'requestPortfolioPrice', args: [3n * unit, 2n * unit, 101n] })
		for (const token of ['weth', 'rep'] as const) {
			const approval = buildPortfolioPriceApprovalRequest(snapshot, token, 99n * unit)
			expect(approval.to).toBe(token === 'weth' ? weth : rep)
			expect(decodeFunctionData({ abi, data: approval.data })).toEqual({ functionName: 'approve', args: [feed, 99n * unit] })
		}
		expect(buildPortfolioPriceWrapRequest(snapshot, unit)).toMatchObject({ account: owner, to: weth, value: unit })
		expect(() => buildPortfolioPriceRequest({ ...snapshot, reportingOpen: false }, unit)).toThrow('closed')
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
