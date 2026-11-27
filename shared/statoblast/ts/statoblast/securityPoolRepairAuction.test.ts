import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	buildSecurityPoolAuctionBidRequest,
	buildSecurityPoolAuctionOpenRequest,
	buildSecurityPoolAuctionMaterializeRequest,
	buildSecurityPoolAuctionClaimAllRequest,
	MAX_REPAIR_AUCTION_CLAIM_BATCH,
	securityPoolAuctionClaimBatch,
	loadSecurityPoolAuctionClaimableBidIds,
	securityPoolAuctionClaimReason,
	buildSecurityPoolAuctionRefundClaimRequest,
	buildSecurityPoolAuctionRefundCreditRequest,
	buildSecurityPoolAuctionRefundWithdrawRequest,
	quoteSecurityPoolAuctionRefundClaim,
	loadSecurityPoolAuctionSnapshot,
	securityPoolAuctionOpeningReason,
	quoteSecurityPoolAuctionBid,
} from './securityPool.js'

const bidder: Address = '0x0000000000000000000000000000000000000001'
const securityPool: Address = '0x0000000000000000000000000000000000000002'
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
const abi = parseAbi([
	'function open()',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot) returns (uint256 bidId)',
	'function settleRefund(uint256 bidId)',
	'function materializeRepairAuctionBids(uint256[] bidIds) returns (uint96[] positionIds)',
	'function withdrawRefunds(address recipient)',
	'function settleAndWithdrawRefund(uint256 bidId,address recipient) returns (uint256)',
])
function fixture(overrides: Record<string, unknown> = {}, options: { timestamp?: bigint; walletAttoEth?: bigint; finalized?: boolean; opened?: boolean } = {}) {
	const calls: { functionName: string; address: Address; blockNumber: bigint; args?: readonly unknown[] }[] = []
	const opened = options.opened ?? true
	const finalized = options.finalized ?? false
	const values: Record<string, unknown> = {
		collateralToken: rep,
		factory,
		forkController: controller,
		securityPool,
		zoltar,
		repairAuctions: auction,
		capitalLedger: capital,
		priceFeed: feed,
		oracleExposure: 20n * unit,
		getRepToken: rep,
		getForkTime: 0n,
		branches: [0n, 1n, 0n, 0n, 0n, 0n, true, true, false, zeroAddress, 0n],
		forkAuthority: controller,
		capital,
		engine,
		unclaimedRepairAuctionBids: 3n,
		importing: false,
		repToken: rep,
		universeId: 42n,
		closesAt: 100_000n,
		inventoryAttoRep: 18n * unit + 1n,
		shortfallAttoEth: 10n * unit,
		lotAttoEth: unit,
		minimumCommitmentAttoEth: unit,
		targetLots: 10n,
		repGrid: 2n,
		openingConservativePrice: 2n * unit,
		minimumCollateralAttoRepPerLot: 4n * unit,
		opened,
		finalized,
		initialized: opened,
		controller: auction,
		maximumBidAttoRepPerLot: 18n * unit,
		maximumAdmissibleBidAttoRepPerLot: 18n * unit,
		depositedAttoEth: 6n * unit,
		securityMultiplierBps: 20_000n,
		conservativePrice: 2n * unit,
		priceValidUntil: 1_100n,
		lastSettlementTimestamp: 90n,
		acceptedExposureLimitAttoEth: 20n * unit,
		acceptedRepExposureLimitAttoRep: 100n * unit,
		refundCreditAttoEth: 0n,
		earlyRefundAttoEth: 0n,
		bidderBidCount: 3n,
		balanceOf: options.walletAttoEth ?? 100n * unit,
		allowance: 100n * unit,
		clearing: [6n * unit, 3n, 3n * unit, 18n * unit, 0n, 0n, 0n, 3n, false],
		...overrides,
	}
	const client: Parameters<typeof loadSecurityPoolAuctionSnapshot>[0]['client'] = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: options.timestamp ?? 100n }),
		getBalance: async () => options.walletAttoEth ?? 100n * unit,
		readContract: async parameters => {
			calls.push(parameters)
			const scoped = `${parameters.address}:${parameters.functionName}`
			if (scoped in overrides) return overrides[scoped]
			if (parameters.functionName === 'repairAuctionPosition') throw new Error('Use repairAuctionPositions')
			if (parameters.functionName in overrides) return overrides[parameters.functionName]
			const id = parameters.args?.[0]
			if (parameters.functionName === 'bidderBidId') return BigInt(String(parameters.args?.[1])) + 1n
			if (parameters.functionName === 'bids' && typeof id === 'bigint') return [bidder, false, false, 2n, 5n * unit]
			if (parameters.functionName === 'previewBid' && typeof id === 'bigint') return [bidder, 1n, unit, 6n * unit, unit]
			if (parameters.functionName === 'repairAuctionPositions' && Array.isArray(id)) return id.map(() => overrides['repairAuctionPosition'] ?? [bidder, 0n, 6n * unit, unit, 30n, false, false, 7n, 9n])
			if (!(parameters.functionName in values)) throw new Error(`Unexpected auction read ${parameters.functionName}`)
			return values[parameters.functionName]
		},
	}
	return { client, calls }
}
const load = (source: ReturnType<typeof fixture>, bidStart = 0n, bidCount = 16) => loadSecurityPoolAuctionSnapshot({ client: source.client, securityPool, bidder, universeId: 42n, bidStart, bidCount })
const bidTerms = { lots: 2n, minimumAttoRepPerLot: 5n * unit }

describe('security pool collateral repair auction SDK', () => {
	test('#1493: opening accounts for lot resizing before checking inventory', async () => {
		const snapshot = await load(fixture({ lotAttoEth: 100n, targetLots: 8n, shortfallAttoEth: 800n, inventoryAttoRep: 150n, repGrid: 101n, securityMultiplierBps: 10_000n, conservativePrice: unit }, { opened: false }))
		expect(securityPoolAuctionOpeningReason(snapshot)).toContain('cannot back one collateral lot')
	})
	test('#1495: an unopened finalized auction remains readable', async () => {
		const snapshot = await load(fixture({ [`${engine}:finalized`]: true, bidderBidCount: 0n }, { opened: false, finalized: true }))
		expect(snapshot.auction?.opened).toBe(false)
		expect(snapshot.auction?.finalized).toBe(true)
	})
	test('Collateral bids need token approval but no existing REP and pledge only purchased collateral', async () => {
		const source = fixture()
		const snapshot = await load(source)
		const quote = quoteSecurityPoolAuctionBid(snapshot, { ...bidTerms, minimumAttoRepPerLot: 5n * unit })
		expect(buildSecurityPoolAuctionBidRequest(snapshot, quote).value).toBe(0n)
		expect(quote.minimumPrincipalAttoRep).toBe(10n * unit)
		expect(quote).not.toHaveProperty('topUpAttoRep')
		expect(quote).not.toHaveProperty('executionReserveAttoEth')
		expect(source.calls.some(call => ['refundCreditAttoRep', 'minimumExecutionReservePerLot', 'bidReservePerLotAttoEth'].includes(call.functionName))).toBe(false)
	})
	test('#1371 rejects an excluded bid before asking for collateral approval', async () => {
		const snapshot = await load(fixture())
		if (snapshot.auction === undefined) throw new Error('Auction snapshot missing')
		const blocked = { ...snapshot, collateralAllowance: 0n, auction: { ...snapshot.auction, maximumAdmissibleBidAttoRepPerLot: (49n * unit) / 10n } }
		expect(() => quoteSecurityPoolAuctionBid(blocked, bidTerms)).toThrow('Better funded bids exclude this limit')
		expect(() => buildSecurityPoolAuctionBidRequest(blocked, bidTerms)).toThrow('Better funded bids exclude this limit')
	})

	test('#1371 explains when no new bid can meet the book and backing limits', async () => {
		const snapshot = await load(fixture())
		if (snapshot.auction === undefined) throw new Error('Auction snapshot missing')
		const full = { ...snapshot, auction: { ...snapshot.auction, maximumAdmissibleBidAttoRepPerLot: 0n } }
		expect(() => quoteSecurityPoolAuctionBid(full, bidTerms)).toThrow('Better funded bids leave no admissible new limit')
	})

	test('authenticates canonical modules and each bidder bid at one block without enumerating other bidders', async () => {
		const source = fixture({ bidderBidCount: 1_000_000n })
		const snapshot = await load(source, 123n, 2)
		expect(snapshot).toMatchObject({ securityPool, bidder, controller, capitalLedger: capital, repToken: rep, universeId: 42n })
		expect(snapshot.auction?.bids.map(bid => [bid.id, bid.bidder])).toEqual([
			[124n, bidder],
			[125n, bidder],
		])
		expect(snapshot.auction?.bids[0]).not.toHaveProperty('vault')
		expect(snapshot.auction?.bids[0]).not.toHaveProperty('targetHealthFactorBps')
		expect(snapshot.auction).toMatchObject({ totalBidCount: 1_000_000n, bidStart: 123n, unclaimedBidCount: 3n })
		expect(snapshot.auction).not.toHaveProperty('maximumBidsPerBidder')
		expect(snapshot.auction).not.toHaveProperty('vaultImplementation')
		expect(new Set(source.calls.map(call => call.blockNumber))).toEqual(new Set([10n]))
		expect(source.calls.filter(call => call.functionName === 'bidderBidId')).toHaveLength(2)
		expect(source.calls.filter(call => call.functionName === 'bids')).toHaveLength(2)
		await expect(load(source, 0n, 65)).rejects.toThrow('64 bids')
	})
	test('missing auctions stay readable without touching zero-address capital and preserve an explicit empty state', async () => {
		const source = fixture({ repairAuctions: zeroAddress, capitalLedger: zeroAddress, getRepToken: zeroAddress, priceFeed: zeroAddress })
		const snapshot = await load(source)
		expect(snapshot.auction).toBeUndefined()
		expect(source.calls.some(call => call.address === zeroAddress || call.functionName === 'oracleExposure')).toBe(false)
		expect(securityPoolAuctionOpeningReason(snapshot)).toContain('Start a branch')
		expect(() => quoteSecurityPoolAuctionBid(snapshot, bidTerms)).toThrow('no repair auction')
	})
	test('rejects mismatched route, ledger, engine and bid owner bindings before funding', async () => {
		for (const [address, name, value] of [
			[controller, 'securityPool', bidder],
			[auction, 'capital', bidder],
			[capital, 'forkAuthority', bidder],
			[engine, 'controller', bidder],
		] as const) {
			await expect(load(fixture({ [`${address}:${name}`]: value }))).rejects.toThrow()
		}
		await expect(load(fixture({ bids: [securityPool, false, false, 2n, 5n * unit] }))).rejects.toThrow('another wallet')
		await expect(load(fixture({ previewBid: [securityPool, 1n, unit, 6n * unit, unit] }, { finalized: true }))).rejects.toThrow('fill identity')
		await expect(load(fixture({ repairAuctionPosition: [securityPool, 0n, 6n * unit, unit, 30n, false, false, 7n, 9n] }, { finalized: true }))).rejects.toThrow('capital position identity')
	})
	test('opening needs both funded exposure budgets, a fresh observation and the immutable deadline', async () => {
		const snapshot = await load(fixture({}, { opened: false }))
		expect(securityPoolAuctionOpeningReason(snapshot)).toBeUndefined()
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionOpenRequest(snapshot).data })).toEqual({ functionName: 'open', args: [] })
		for (const patch of [{ lastSettlementTimestamp: 0n }, { priceValidUntil: 100n }, { acceptedExposureLimitAttoEth: unit }, { acceptedRepExposureLimitAttoRep: unit }, { getForkTime: 1n }]) {
			const blocked = await load(fixture(patch, { opened: false }))
			expect(securityPoolAuctionOpeningReason(blocked)).toBeDefined()
			expect(() => buildSecurityPoolAuctionOpenRequest(blocked)).toThrow()
		}
		expect(securityPoolAuctionOpeningReason(await load(fixture({}, { opened: false, timestamp: 100_000n })))).toContain('closed')
		expect(securityPoolAuctionOpeningReason(await load(fixture({ inventoryAttoRep: 3n * unit }, { opened: false })))).toContain('cannot back one collateral lot')
	})
	test('#1331 opening quotes reserve a full day for competing bidders', async () => {
		const snapshot = await load(fixture({}, { opened: false, timestamp: 13_601n }))
		expect(securityPoolAuctionOpeningReason(snapshot)).toContain('1 day')
		expect(() => buildSecurityPoolAuctionOpenRequest(snapshot)).toThrow('1 day')
	})

	test('#1371 better funded bids block both the quote and its approval amount', async () => {
		const snapshot = await load(fixture({ maximumAdmissibleBidAttoRepPerLot: 4n * unit }))
		expect(() => quoteSecurityPoolAuctionBid(snapshot, bidTerms)).toThrow('Better funded bids')
		expect(() => buildSecurityPoolAuctionBidRequest(snapshot, bidTerms)).toThrow('Better funded bids')
	})

	test('#1371 a full book reports when no limit can meet the protocol backing floor', async () => {
		const snapshot = await load(fixture({ maximumAdmissibleBidAttoRepPerLot: 3n * unit }))
		expect(() => quoteSecurityPoolAuctionBid(snapshot, bidTerms)).toThrow('no admissible new limit')
	})

	test('bids need only the protocol collateral floor because winning lots take the owner account health target later', async () => {
		const snapshot = await load(fixture({ openingConservativePrice: 3n, securityMultiplierBps: 10_000n, repGrid: 2n, minimumCollateralAttoRepPerLot: 4n }))
		const quote = quoteSecurityPoolAuctionBid(snapshot, { ...bidTerms, minimumAttoRepPerLot: 4n })
		expect(quote.requiredPrincipalPerLotAttoRep).toBe(4n)
		expect(quote.minimumPrincipalAttoRep).toBe(8n)
		expect(quote).not.toHaveProperty('targetHealthFactorBps')
		expect(() => quoteSecurityPoolAuctionBid(snapshot, { ...bidTerms, minimumAttoRepPerLot: 2n })).toThrow('at least 0.000000000000000004 REP to back each lot')
	})
	test('one account can place any number of bids', async () => {
		for (const count of [8n, 9n, 100n]) expect(quoteSecurityPoolAuctionBid(await load(fixture({ bidderBidCount: count })), bidTerms).lots).toBe(2n)
	})
	test('quotes exact collateral funding and purchased collateral with two-argument bid terms', async () => {
		const snapshot = await load(fixture())
		const quote = quoteSecurityPoolAuctionBid(snapshot, bidTerms)
		expect(quote).toMatchObject({
			bidAttoEth: 2n * unit,
			requiredPrincipalPerLotAttoRep: 4n * unit,
			minimumPrincipalAttoRep: 10n * unit,
			maximumPrice: { attoEth: unit, attoRep: 5n * unit },
		})
		const request = buildSecurityPoolAuctionBidRequest(snapshot, quote)
		expect(request).toMatchObject({ account: bidder, to: auction, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'submitBid', args: [2n, 5n * unit] })
		expect(quoteSecurityPoolAuctionBid(snapshot, { ...bidTerms, minimumAttoRepPerLot: 4n * unit }).minimumPrincipalAttoRep).toBe(8n * unit)
		for (const patch of [{ lots: 0n }, { minimumAttoRepPerLot: 1n }, { minimumAttoRepPerLot: 101n * unit }, { minimumAttoRepPerLot: 4n * unit - 2n }, { lots: 1n << 128n }]) expect(() => quoteSecurityPoolAuctionBid(snapshot, { ...bidTerms, ...patch })).toThrow()
	})
	test('Collateral balance and closing deadline block submission without increasing signed funding', async () => {
		const snapshot = await load(fixture({}, { walletAttoEth: 2n * unit - 1n }))
		expect(() => buildSecurityPoolAuctionBidRequest(snapshot, bidTerms)).toThrow('Insufficient collateral')
		const closed = await load(fixture({}, { timestamp: 100_000n }))
		expect(() => buildSecurityPoolAuctionBidRequest(closed, bidTerms)).toThrow('not accepting')
		expect(buildSecurityPoolAuctionBidRequest(await load(fixture({}, { walletAttoEth: 2n * unit })), bidTerms).value).toBe(0n)
	})
	test('provably losing bids can credit and withdraw collateral before closing', async () => {
		const snapshot = await load(fixture({ earlyRefundAttoEth: 2n * unit }))
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionRefundCreditRequest(snapshot, 1n).data })).toEqual({ functionName: 'settleRefund', args: [1n] })
		const credited = await load(fixture({ refundCreditAttoEth: 2n * unit }))
		expect(buildSecurityPoolAuctionRefundWithdrawRequest(credited, bidder)).toMatchObject({ to: auction, value: 0n })
	})
	test('a combined refund claim settles only uncredited bids and discloses the whole accumulated credit', async () => {
		const early = await load(fixture({ earlyRefundAttoEth: 2n * unit, refundCreditAttoEth: unit }))
		expect(quoteSecurityPoolAuctionRefundClaim(early, 1n)).toEqual({ bidId: 1n, settles: true, bidRefundAttoEth: 2n * unit, creditedAttoEth: unit, totalAttoEth: 3n * unit })
		const request = buildSecurityPoolAuctionRefundClaimRequest(early, 1n, bidder)
		expect(request).toMatchObject({ account: bidder, to: auction, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'settleAndWithdrawRefund', args: [1n, bidder] })
		// A keeper's earlier credit is skipped, not double counted.
		const credited = await load(fixture({ bids: [bidder, true, false, 2n, 5n * unit], refundCreditAttoEth: 3n * unit, bidderBidCount: 1n }))
		expect(quoteSecurityPoolAuctionRefundClaim(credited, 1n)).toEqual({ bidId: 1n, settles: false, bidRefundAttoEth: 0n, creditedAttoEth: 3n * unit, totalAttoEth: 3n * unit })
		const withdrawn = await load(fixture({ bids: [bidder, true, false, 2n, 5n * unit], bidderBidCount: 1n }))
		expect(() => quoteSecurityPoolAuctionRefundClaim(withdrawn, 1n)).toThrow('No refund credit remains')
		const pending = await load(fixture())
		expect(() => quoteSecurityPoolAuctionRefundClaim(pending, 1n)).toThrow('may still win')
		expect(() => quoteSecurityPoolAuctionRefundClaim(early, 100n)).toThrow('page')
		expect(() => buildSecurityPoolAuctionRefundClaimRequest(early, 1n, zeroAddress)).toThrow('recipient')
		const closed = await load(fixture({}, { finalized: true }))
		expect(quoteSecurityPoolAuctionRefundClaim(closed, 1n)).toMatchObject({ settles: true, bidRefundAttoEth: unit, totalAttoEth: unit })
		const fullWinner = await load(fixture({ previewBid: [bidder, 2n, 2n * unit, 12n * unit, 0n], refundCreditAttoEth: unit, bidderBidCount: 1n }, { finalized: true }))
		expect(() => buildSecurityPoolAuctionRefundCreditRequest(fullWinner, 1n)).toThrow('no unused collateral')
		expect(quoteSecurityPoolAuctionRefundClaim(fullWinner, 1n)).toMatchObject({ bidRefundAttoEth: 0n, creditedAttoEth: unit, totalAttoEth: unit })
		if (fullWinner.auction === undefined) throw new Error('Missing auction')
		fullWinner.auction.refundAttoEth = 0n
		expect(() => quoteSecurityPoolAuctionRefundClaim(fullWinner, 1n)).toThrow('No refund credit')
	})
	test('early refund reads reject partial amounts and keep potential winners committed', async () => {
		const pending = await load(fixture())
		expect(pending.auction?.bids[0]?.earlyRefundAttoEth).toBe(0n)
		expect(() => buildSecurityPoolAuctionRefundCreditRequest(pending, 1n)).toThrow('may still win')
		await expect(load(fixture({ earlyRefundAttoEth: unit }))).rejects.toThrow('early auction refund accounting')
		const source = fixture({ bids: [bidder, true, false, 2n, 5n * unit], bidderBidCount: 1n })
		const credited = await load(source)
		expect(() => buildSecurityPoolAuctionRefundCreditRequest(credited, 1n)).toThrow('unsettled bid')
		expect(source.calls.some(call => call.functionName === 'earlyRefundAttoEth')).toBe(false)
	})
	test('partial fills expose original principal while unused bid refunds remain separate transactions', async () => {
		const snapshot = await load(fixture({ [`${engine}:refundCreditAttoEth`]: unit }, { finalized: true }))
		expect(snapshot.auction?.bids[0]?.fill).toEqual({ filledLots: 1n, usedAttoEth: unit, refundAttoEth: unit, principalAttoRep: 6n * unit })
		expect(snapshot.auction).toMatchObject({ refundAttoEth: unit, clearing: { soldAttoRep: 18n * unit } })
		expect(snapshot.auction?.bids[0]?.position).toMatchObject({ positionId: 0n, materialized: false, principalAttoRep: 6n * unit, commitmentAttoEth: unit, liquidationStarted: 30n, earnedAttoEth: 7n, earnedAttoRep: 9n })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionRefundCreditRequest(snapshot, 1n).data })).toEqual({ functionName: 'settleRefund', args: [1n] })
		expect(buildSecurityPoolAuctionMaterializeRequest(snapshot, [1n])).toMatchObject({ account: bidder, to: capital, value: 0n })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionMaterializeRequest(snapshot, [1n, 2n]).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[1n, 2n]] })
		const joined = await load(fixture({ bids: [bidder, false, true, 2n, 5n * unit], repairAuctionPosition: [bidder, 4n, 6n * unit, unit, 0n, true, true, 0n, 0n] }, { finalized: true }))
		expect(joined.auction?.bids[0]).toMatchObject({ claimed: true, position: { positionId: 4n, materialized: true } })
		expect(securityPoolAuctionClaimReason(joined, 1n)).toBe('This bid is claimed.')
		expect(() => buildSecurityPoolAuctionMaterializeRequest(joined, [1n])).toThrow('This bid is claimed.')
		// A losing bid still needs a claim before its bidder can choose a fork branch.
		const lost = await load(fixture({ previewBid: [bidder, 0n, 0n, 0n, 2n * unit], repairAuctionPosition: [bidder, 0n, 0n, 0n, 0n, false, false, 0n, 0n] }, { finalized: true }))
		expect(lost.auction?.bids[0]).toMatchObject({ claimable: true, claimed: false, position: undefined })
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionMaterializeRequest(lost, [1n]).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[1n]] })
		expect(() => buildSecurityPoolAuctionMaterializeRequest(snapshot, [])).toThrow('at least one bid')
		expect(() => buildSecurityPoolAuctionMaterializeRequest(snapshot, [1n, 1n])).toThrow('each bid once')
		// A claim transaction carries at most one batch, so it always fits in a block.
		const many = Array.from({ length: MAX_REPAIR_AUCTION_CLAIM_BATCH + 4 }, (_, index) => BigInt(index + 1))
		expect(() => buildSecurityPoolAuctionMaterializeRequest(snapshot, many)).toThrow(`at most ${MAX_REPAIR_AUCTION_CLAIM_BATCH} bids`)
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionClaimAllRequest(snapshot, many).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [many.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH)] })
		expect(securityPoolAuctionClaimBatch(many)).toEqual({ bidIds: many.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH), completes: false })
		expect(securityPoolAuctionClaimBatch(many.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH))).toEqual({ bidIds: many.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH), completes: true })
		expect(() => buildSecurityPoolAuctionMaterializeRequest(snapshot, [100n])).toThrow('page')
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionRefundWithdrawRequest(snapshot, bidder).data })).toEqual({ functionName: 'withdrawRefunds', args: [bidder] })
		expect(() => buildSecurityPoolAuctionRefundCreditRequest(snapshot, 100n)).toThrow('page')
		expect(() => buildSecurityPoolAuctionRefundWithdrawRequest(snapshot, zeroAddress)).toThrow('recipient')
	})
	test('rejects reorgs after bidder authentication and malformed fill accounting', async () => {
		const source = fixture()
		source.client.getBlock = async parameters => ({ number: 10n, timestamp: 100n, hash: parameters?.blockNumber === undefined ? hash : `0x${'22'.repeat(32)}` })
		await expect(load(source)).rejects.toThrow('state changed')
		await expect(load(fixture({ previewBid: [bidder, 3n, unit, 2n * unit, unit] }, { finalized: true }))).rejects.toThrow('fill')
	})
	test('claims read every page bid in one ledger call and only bids that can be claimed now', async () => {
		const open = fixture()
		const pending = await load(open)
		expect(pending.auction?.bids.map(bid => [bid.claimable, bid.claimed])).toEqual([
			[false, false],
			[false, false],
			[false, false],
		])
		expect(open.calls.some(call => call.functionName === 'repairAuctionPositions')).toBe(false)
		expect(securityPoolAuctionClaimReason(pending, 1n)).toContain('after the auction closes')
		expect(() => buildSecurityPoolAuctionMaterializeRequest(pending, [1n])).toThrow('after the auction closes')
		const excluded = await load(fixture({ bids: [bidder, true, false, 2n, 5n * unit], repairAuctionPosition: [bidder, 0n, 0n, 0n, 0n, false, false, 0n, 0n] }))
		expect(excluded.auction?.bids.map(bid => [bid.claimable, bid.claimed])).toEqual([
			[true, false],
			[true, false],
			[true, false],
		])
		const finalized = fixture({}, { finalized: true })
		const snapshot = await load(finalized)
		expect(finalized.calls.filter(call => call.functionName === 'repairAuctionPositions').map(call => call.args)).toEqual([[[1n, 2n, 3n]]])
		expect(await loadSecurityPoolAuctionClaimableBidIds(finalized.client, snapshot)).toEqual([1n, 2n, 3n])
		expect(decodeFunctionData({ abi, data: buildSecurityPoolAuctionClaimAllRequest(snapshot, [1n, 2n, 3n]).data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[1n, 2n, 3n]] })
		expect(() => buildSecurityPoolAuctionClaimAllRequest(snapshot, [])).toThrow('No bids')
		if (snapshot.auction === undefined) throw new Error('Missing auction')
		const importing = { ...snapshot, auction: { ...snapshot.auction, capitalImporting: true } }
		expect(() => buildSecurityPoolAuctionMaterializeRequest(importing, [1n])).toThrow('importing')
	})
	test('claiming all bids scans every page only when the loaded page is partial', async () => {
		const source = fixture({ bidderBidCount: 70n }, { finalized: true })
		const snapshot = await load(source, 0n, 2)
		source.calls.length = 0
		const ids = await loadSecurityPoolAuctionClaimableBidIds(source.client, snapshot)
		expect(ids).toHaveLength(70)
		expect(source.calls.filter(call => call.functionName === 'repairAuctionPositions').map(call => (Array.isArray(call.args?.[0]) ? call.args[0].length : 0))).toEqual([64, 6])
		expect(new Set(source.calls.map(call => call.blockNumber))).toEqual(new Set([10n]))
		const none = await load(fixture({ unclaimedRepairAuctionBids: 0n }, { finalized: true }))
		expect(await loadSecurityPoolAuctionClaimableBidIds(source.client, none)).toEqual([])
	})
})

test('opening rejects an unaffordable default lot even when an intermediate lot count is viable', async () => {
	// One 20-attoETH lot needs 21 attoREP and would fit; default rounding selects one 60-attoETH lot.
	const snapshot = await load(fixture({ shortfallAttoEth: 60n, minimumCommitmentAttoEth: 15n, lotAttoEth: 15n, targetLots: 4n, securityMultiplierBps: 10_500n, repGrid: 21n, conservativePrice: unit, inventoryAttoRep: 21n }, { opened: false }))
	expect(securityPoolAuctionOpeningReason(snapshot)).toContain('cannot back one collateral lot')
	expect(() => buildSecurityPoolAuctionOpenRequest(snapshot)).toThrow('cannot back one collateral lot')
})

test('#1634 opening coverage must include the final rounded lot product', async () => {
	const snapshot = await load(fixture({ shortfallAttoEth: 58n, minimumCommitmentAttoEth: 1n, lotAttoEth: 1n, targetLots: 58n, securityMultiplierBps: 10_500n, repGrid: 21n, conservativePrice: unit, oracleExposure: 58n, acceptedExposureLimitAttoEth: 58n }, { opened: false }))
	expect(securityPoolAuctionOpeningReason(snapshot)).toContain('final auction collateral exposure')
})

test('#1652 preflight identifies cumulative escrow exhaustion before bid ranking', async () => {
	const snapshot = await load(fixture({ depositedAttoEth: (1n << 128n) - 1n, maximumAdmissibleBidAttoRepPerLot: 0n }))
	expect(() => quoteSecurityPoolAuctionBid(snapshot, bidTerms)).toThrow('Total bid collateral')
})

test('opening rejects an unaffordable default lot instead of searching lower REP grid bands', async () => {
	const snapshot = await load(fixture({ shortfallAttoEth: 58n, minimumCommitmentAttoEth: 5n, lotAttoEth: 6n, targetLots: 10n, securityMultiplierBps: 10_500n, repGrid: 21n, conservativePrice: unit, inventoryAttoRep: 42n }, { opened: false }))
	expect(securityPoolAuctionOpeningReason(snapshot)).toContain('cannot back one collateral lot')
	expect(() => buildSecurityPoolAuctionOpenRequest(snapshot)).toThrow('cannot back one collateral lot')
})

test('opening rejects an unaffordable default lot instead of retrying the commitment minimum', async () => {
	const snapshot = await load(fixture({ shortfallAttoEth: 61n, minimumCommitmentAttoEth: 20n, lotAttoEth: 21n, targetLots: 3n, securityMultiplierBps: 10_500n, repGrid: 21n, conservativePrice: unit, inventoryAttoRep: 21n }, { opened: false }))
	expect(securityPoolAuctionOpeningReason(snapshot)).toContain('cannot back one collateral lot')
	expect(() => buildSecurityPoolAuctionOpenRequest(snapshot)).toThrow('cannot back one collateral lot')
})

test('#1634 final coverage also reserves the branch chosen commitment', async () => {
	const snapshot = await load(
		fixture({ shortfallAttoEth: 58n, minimumCommitmentAttoEth: 1n, lotAttoEth: 1n, targetLots: 58n, securityMultiplierBps: 10_500n, repGrid: 21n, conservativePrice: unit, oracleExposure: 258n, acceptedExposureLimitAttoEth: 258n, branches: [0n, 1n, 0n, 200n, 0n, 0n, true, true, false, zeroAddress, 0n] }, { opened: false }),
	)
	expect(securityPoolAuctionOpeningReason(snapshot)).toContain('final auction collateral exposure')
})
