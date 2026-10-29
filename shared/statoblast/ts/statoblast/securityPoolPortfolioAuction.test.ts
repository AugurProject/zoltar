import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioAuctionApprovalRequest,
	buildPortfolioAuctionBidRequest,
	buildPortfolioAuctionOpenRequest,
	buildPortfolioAuctionMaterializeRequest,
	buildPortfolioAuctionRefundCreditRequest,
	buildPortfolioAuctionRefundWithdrawRequest,
	buildPortfolioAuctionVaultDepositRequest,
	buildPortfolioAuctionVaultExecuteRequest,
	loadPortfolioAuctionSnapshot,
	portfolioAuctionOpeningReason,
	quotePortfolioAuctionBid,
} from './securityPoolPortfolio.js'

const bidder: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const factory: Address = '0x0000000000000000000000000000000000000003'
const zoltar: Address = '0x0000000000000000000000000000000000000004'
const controller: Address = '0x0000000000000000000000000000000000000005'
const capital: Address = '0x0000000000000000000000000000000000000006'
const feed: Address = '0x0000000000000000000000000000000000000007'
const rep: Address = '0x0000000000000000000000000000000000000008'
const auction: Address = '0x0000000000000000000000000000000000000009'
const engine: Address = '0x0000000000000000000000000000000000000010'
const unit = 10n ** 18n
const hash: Hex = `0x${'11'.repeat(32)}`
const vaultFor = (id: bigint) => getAddress(`0x${(100n + id).toString(16).padStart(40, '0')}`)
const abi = parseAbi([
	'function open()',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot,uint256 targetHealthFactorBps,uint256 executionReservePerLotAttoEth) payable returns (uint256 bidId,address vault)',
	'function settleRefund(uint256 bidId)',
	'function materializeAuctionBid(uint256 bidId) returns (address vault,uint96 positionId)',
	'function withdrawRefunds(address recipient)',
	'function execute(address target,uint256 value,bytes data) payable returns (bytes)',
	'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns (bytes)',
	'function depositPrincipal(address ledger,uint256 amount,uint256 targetHealthFactorBps)',
])
function fixture(overrides: Record<string, unknown> = {}, options: { timestamp?: bigint; walletAttoEth?: bigint; finalized?: boolean; opened?: boolean } = {}) {
	const calls: { functionName: string; address: Address; blockNumber: bigint; args?: readonly unknown[] }[] = []
	const opened = options.opened ?? true
	const finalized = options.finalized ?? false
	const values: Record<string, unknown> = {
		factory,
		forkController: controller,
		portfolio,
		zoltar,
		auctions: auction,
		capitalLedger: capital,
		priceFeed: feed,
		auctionReserveFactorBps: 5_000n,
		oracleExposure: 20n * unit,
		getRepToken: rep,
		getForkTime: 0n,
		forkAuthority: controller,
		capital,
		engine,
		repToken: rep,
		universeId: 42n,
		closesAt: 1_000n,
		inventoryAttoRep: 100n * unit,
		shortfallAttoEth: 10n * unit,
		lotAttoEth: unit,
		targetLots: 10n,
		minimumExecutionReservePerLot: unit / 100n,
		bidReservePerLotAttoEth: unit / 50n,
		repGrid: 2n,
		openingConservativePrice: 2n * unit,
		topUpPerLotAttoRep: 4n * unit,
		opened,
		finalized,
		initialized: opened,
		controller: auction,
		initialMaximumAttoRepPerLot: 2n * unit,
		depositedAttoEth: 6n * unit,
		securityMultiplierBps: 20_000n,
		conservativePrice: 2n * unit,
		liquidationPrice: unit,
		priceValidUntil: 1_100n,
		lastSettlementTimestamp: 90n,
		acceptedExposureLimitAttoEth: 20n * unit,
		acceptedRepExposureLimitAttoRep: 100n * unit,
		refundCreditAttoRep: 0n,
		refundCreditAttoEth: 0n,
		bidderBidCount: 3n,
		owner: bidder,
		initialCapital: capital,
		auction,
		balanceOf: 100n * unit,
		allowance: 100n * unit,
		clearing: [2n * unit, 3n, 3n * unit, 6n * unit, 0n, 0n, 0n, 3n, false],
		...overrides,
	}
	const client: Parameters<typeof loadPortfolioAuctionSnapshot>[0]['client'] = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: options.timestamp ?? 100n }),
		getBalance: async () => options.walletAttoEth ?? 100n * unit,
		readContract: async parameters => {
			calls.push(parameters)
			const scoped = `${parameters.address}:${parameters.functionName}`
			if (scoped in overrides) return overrides[scoped]
			if (parameters.functionName in overrides) return overrides[parameters.functionName]
			const id = parameters.args?.[0]
			if (parameters.functionName === 'bidderBidId') return BigInt(String(parameters.args?.[1])) + 1n
			if (parameters.functionName === 'bids' && typeof id === 'bigint') return [bidder, vaultFor(id), 12_000n, 2n, unit, false, false]
			if (parameters.functionName === 'previewBid' && typeof id === 'bigint') return [bidder, vaultFor(id), 12_000n, 1n, unit, 2n * unit, unit]
			if (parameters.functionName === 'auctionPosition' && typeof id === 'bigint') return [vaultFor(id), 0n, 6n * unit, unit, 12_000n, 30n, false, 7n, 9n]
			if (parameters.functionName === 'bidId') return BigInt(parameters.address) - 100n
			if (parameters.functionName === 'bidIdForVault' && typeof id === 'string') return BigInt(id) - 100n
			if (!(parameters.functionName in values)) throw new Error(`Unexpected auction read ${parameters.functionName}`)
			return values[parameters.functionName]
		},
	}
	return { client, calls }
}
const load = (source: ReturnType<typeof fixture>, bidStart = 0n, bidCount = 16) => loadPortfolioAuctionSnapshot({ client: source.client, portfolio, bidder, universeId: 42n, bidStart, bidCount })
const bidTerms = { lots: 2n, minimumAttoRepPerLot: unit, targetHealthFactorBps: 12_000n, executionReservePerLotAttoEth: unit / 100n }

describe('portfolio truth auction SDK', () => {
	test('authenticates canonical modules and each bidder vault at one block without enumerating other bidders', async () => {
		const source = fixture({ bidderBidCount: 1_000_000n })
		const snapshot = await load(source, 123n, 2)
		expect(snapshot).toMatchObject({ portfolio, bidder, controller, capitalLedger: capital, repToken: rep, universeId: 42n })
		expect(snapshot.auction?.bids.map(bid => [bid.id, bid.vault])).toEqual([
			[124n, vaultFor(124n)],
			[125n, vaultFor(125n)],
		])
		expect(snapshot.auction).toMatchObject({ totalBidCount: 1_000_000n, bidStart: 123n })
		expect(new Set(source.calls.map(call => call.blockNumber))).toEqual(new Set([10n]))
		expect(source.calls.filter(call => call.functionName === 'bidderBidId')).toHaveLength(2)
		expect(source.calls.filter(call => call.functionName === 'bids')).toHaveLength(2)
		await expect(load(source, 0n, 65)).rejects.toThrow('64 bids')
	})
	test('missing auctions stay readable without touching zero-address capital and preserve an explicit empty state', async () => {
		const source = fixture({ auctions: zeroAddress, capitalLedger: zeroAddress, getRepToken: zeroAddress, priceFeed: zeroAddress })
		const snapshot = await load(source)
		expect(snapshot.auction).toBeUndefined()
		expect(source.calls.some(call => call.address === zeroAddress || call.functionName === 'oracleExposure')).toBe(false)
		expect(portfolioAuctionOpeningReason(snapshot)).toContain('Start a branch')
		expect(() => quotePortfolioAuctionBid(snapshot, bidTerms)).toThrow('no truth auction')
	})
	test('rejects mismatched route, ledger, engine and vault bindings before funding', async () => {
		for (const [address, name, value] of [
			[controller, 'portfolio', bidder],
			[auction, 'capital', bidder],
			[capital, 'forkAuthority', bidder],
			[engine, 'controller', bidder],
			[vaultFor(1n), 'owner', portfolio],
			[vaultFor(1n), 'initialCapital', bidder],
			[vaultFor(1n), 'auction', engine],
			[vaultFor(1n), 'bidId', 9n],
		] as const) {
			await expect(load(fixture({ [`${address}:${name}`]: value }))).rejects.toThrow()
		}
	})
	test('opening needs both funded exposure budgets, a fresh observation and the immutable deadline', async () => {
		const snapshot = await load(fixture({}, { opened: false }))
		expect(portfolioAuctionOpeningReason(snapshot)).toBeUndefined()
		expect(decodeFunctionData({ abi, data: buildPortfolioAuctionOpenRequest(snapshot).data })).toEqual({ functionName: 'open', args: [] })
		for (const patch of [{ lastSettlementTimestamp: 0n }, { priceValidUntil: 100n }, { acceptedExposureLimitAttoEth: unit }, { acceptedRepExposureLimitAttoRep: unit }, { getForkTime: 1n }]) {
			const blocked = await load(fixture(patch, { opened: false }))
			expect(portfolioAuctionOpeningReason(blocked)).toBeDefined()
			expect(() => buildPortfolioAuctionOpenRequest(blocked)).toThrow()
		}
		expect(portfolioAuctionOpeningReason(await load(fixture({}, { opened: false, timestamp: 1_000n })))).toContain('closed')
	})
	test('quotes exact signed bid, REP top-up and execution budget without changing the chosen health target', async () => {
		const snapshot = await load(fixture())
		const quote = quotePortfolioAuctionBid(snapshot, bidTerms)
		expect(quote).toMatchObject({
			bidAttoEth: 2n * unit,
			topUpAttoRep: 8n * unit,
			executionReserveAttoEth: unit / 50n,
			totalAttoEth: (202n * unit) / 100n,
			requiredPrincipalPerLotAttoRep: (48n * unit) / 10n,
			minimumPurchasedAttoRep: 2n * unit,
			minimumPrincipalAttoRep: 10n * unit,
			maximumPrice: { attoEth: unit, attoRep: unit },
		})
		const request = buildPortfolioAuctionBidRequest(snapshot, quote)
		expect(request).toMatchObject({ account: bidder, to: auction, value: quote.totalAttoEth })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'submitBid', args: [2n, unit, 12_000n, unit / 100n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioAuctionApprovalRequest(snapshot, 99n).data })).toEqual({ functionName: 'approve', args: [auction, 99n] })
		for (const patch of [{ lots: 0n }, { minimumAttoRepPerLot: 1n }, { minimumAttoRepPerLot: 3n * unit }, { targetHealthFactorBps: 9_999n }, { targetHealthFactorBps: 20_000n }, { executionReservePerLotAttoEth: 0n }, { lots: 1n << 128n }])
			expect(() => quotePortfolioAuctionBid(snapshot, { ...bidTerms, ...patch })).toThrow()
	})
	test('balances, approvals and a rising execution minimum block submission without increasing signed funding', async () => {
		for (const [patch, options, reason] of [
			[{ balanceOf: 0n }, {}, 'Insufficient REP'],
			[{ allowance: 0n }, {}, 'Approve'],
			[{}, { walletAttoEth: 0n }, 'Insufficient ETH'],
			[{ minimumExecutionReservePerLot: unit }, {}, 'Review the updated'],
		] as const) {
			const snapshot = await load(fixture(patch, options))
			expect(() => buildPortfolioAuctionBidRequest(snapshot, bidTerms)).toThrow(reason)
		}
		const closed = await load(fixture({}, { timestamp: 1_000n }))
		expect(() => buildPortfolioAuctionBidRequest(closed, bidTerms)).toThrow('not accepting')
	})
	test('partial fills expose original principal and the bid-specific reserve while refunds remain separate transactions', async () => {
		const snapshot = await load(fixture({ [`${auction}:refundCreditAttoEth`]: unit / 50n, [`${engine}:refundCreditAttoEth`]: unit, refundCreditAttoRep: 4n * unit }, { finalized: true }))
		expect(snapshot.auction?.bids[0]?.fill).toEqual({ filledLots: 1n, usedAttoEth: unit, purchasedAttoRep: 2n * unit, refundAttoEth: unit, principalAttoRep: 6n * unit, reserveAttoEth: unit / 50n })
		expect(snapshot.auction).toMatchObject({ refundAttoEth: (102n * unit) / 100n, refundAttoRep: 4n * unit })
		expect(snapshot.auction?.bids[0]?.position).toMatchObject({ positionId: 0n, materialized: false, principalAttoRep: 6n * unit, commitmentAttoEth: unit, liquidationStarted: 30n, earnedAttoEth: 7n, earnedAttoRep: 9n })
		expect(decodeFunctionData({ abi, data: buildPortfolioAuctionRefundCreditRequest(snapshot, 1n).data })).toEqual({ functionName: 'settleRefund', args: [1n] })
		expect(buildPortfolioAuctionMaterializeRequest(snapshot, 1n)).toMatchObject({ account: bidder, to: capital, value: 0n })
		expect(decodeFunctionData({ abi, data: buildPortfolioAuctionMaterializeRequest(snapshot, 1n).data })).toEqual({ functionName: 'materializeAuctionBid', args: [1n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioAuctionRefundWithdrawRequest(snapshot, bidder).data })).toEqual({ functionName: 'withdrawRefunds', args: [bidder] })
		expect(() => buildPortfolioAuctionRefundCreditRequest(snapshot, 100n)).toThrow('page')
		expect(() => buildPortfolioAuctionRefundWithdrawRequest(snapshot, zeroAddress)).toThrow('recipient')
	})
	test('vault execution preserves the liability owner, target and exact funding, with a distinct wallet-funded deposit helper', () => {
		const vault = vaultFor(1n)
		const data: Hex = '0x12345678'
		const request = buildPortfolioAuctionVaultExecuteRequest({ bidder, vault, request: { account: vault, to: capital, value: 7n, data } })
		expect(request).toMatchObject({ account: bidder, to: vault, value: 7n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'execute', args: [capital, 7n, data] })
		const sweep = buildPortfolioAuctionVaultExecuteRequest({ bidder, vault, request: { account: vault, to: capital, value: 0n, data }, sweep: { repToken: rep, recipient: bidder } })
		expect(decodeFunctionData({ abi, data: sweep.data })).toEqual({ functionName: 'executeAndSweep', args: [capital, 0n, data, rep, bidder] })
		expect(() => buildPortfolioAuctionVaultExecuteRequest({ bidder, vault, request: { account: vault, to: capital, value: 0n, data }, sweep: { repToken: rep, recipient: zeroAddress } })).toThrow('Sweep recipient')
		expect(buildPortfolioAuctionVaultExecuteRequest({ bidder, vault, request: { account: vault, to: bidder, value: 7n, data: '0x' }, fundingAttoEth: 0n }).value).toBe(0n)
		expect(() => buildPortfolioAuctionVaultExecuteRequest({ bidder, vault, request: { account: bidder, to: capital, value: 0n, data } })).toThrow('selected auction vault')
		const deposit = buildPortfolioAuctionVaultDepositRequest({ bidder, vault, capitalLedger: capital, amountAttoRep: 9n, targetHealthFactorBps: 12_345n })
		expect(decodeFunctionData({ abi, data: deposit.data })).toEqual({ functionName: 'depositPrincipal', args: [capital, 9n, 12_345n] })
	})
	test('rejects reorgs after bidder authentication and malformed fill accounting', async () => {
		const source = fixture()
		source.client.getBlock = async parameters => ({ number: 10n, timestamp: 100n, hash: parameters?.blockNumber === undefined ? hash : `0x${'22'.repeat(32)}` })
		await expect(load(source)).rejects.toThrow('state changed')
		await expect(load(fixture({ previewBid: [bidder, vaultFor(1n), 12_000n, 3n, unit, 2n * unit, unit] }, { finalized: true }))).rejects.toThrow('fill')
	})
})
