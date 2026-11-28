import { collateralBalance } from './burnEvidence'
import { describe, expect, test } from 'bun:test'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolAuctionBidRequest, buildSecurityPoolAuctionOpenRequest, loadSecurityPoolAuctionSnapshot, MAX_REPAIR_AUCTION_CLAIM_BATCH, quoteSecurityPoolAuctionBid } from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, forkUniverse, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: collateral repair auction winners own their lots', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const prepare = () => prepareSecurityPoolCollateralRepairAuction(fixture)
	test('#1339 #1551 equal lots cover a shortfall that is not a multiple of the minimum', async () => {
		const context = await prepare()
		const shortfall = (35n * unit) / 10n
		const receipt = await context.owner.waitForTransactionReceipt({
			hash: await context.owner.sendTransaction({ data: encodeDeployData({ abi: auctionArtifact.abi, bytecode: `0x${auctionArtifact.evm.bytecode.object}`, args: [context.owner.account.address, fixture.securityPool, context.child, context.deadline, 1_000n * unit, shortfall] }) }),
		})
		if (!receipt.contractAddress) throw new Error('Auction deployment missing')
		const target = { abi: auctionArtifact.abi, address: receipt.contractAddress }
		const lot = await context.owner.readContract({ ...target, functionName: 'lotAttoEth' })
		const lots = await context.owner.readContract({ ...target, functionName: 'targetLots' })
		// One lot per whole minimum commitment, rounded up to cover the deficit.
		expect(lots).toBe(3n)
		expect(lot).toBe((shortfall + 2n) / 3n)
		expect(lots * lot - shortfall).toBeLessThan(lots)
	})

	test('#1331 opening cannot compress the competitive bidding period to seconds', async () => {
		const context = await prepare()
		await context.mock.setTime(context.deadline - 600n)
		await context.report()
		await context.mock.setTime(context.deadline - 2n)
		await expect(context.open()).rejects.toThrow('requires one day of bidding')
	})

	test('#1331 exactly one full day of bidding remains available at the opening boundary', async () => {
		const context = await prepare()
		await context.mock.setTime(context.deadline - DAY - 600n)
		await context.report()
		await context.mock.setTime(context.deadline - DAY - 1n)
		await context.open()
		expect(await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'opened' })).toBe(true)
	})

	test.each(['target', 'inventory'] as const)('#1371 quote and engine agree at the %s-funded exclusion boundary', async mode => {
		const context = await prepare()
		await context.report()
		await context.open()
		const target = { abi: auctionArtifact.abi, address: context.auction }
		const lots = await context.owner.readContract({ ...target, functionName: 'targetLots' })
		await context.bid(context.owner, mode === 'target' ? lots : 1n, 6n * unit)
		const snapshot = await loadSecurityPoolAuctionSnapshot({ client: context.other, securityPool: fixture.securityPool, bidder: context.other.account.address, universeId: context.child })
		if (snapshot.auction === undefined) throw new Error('Auction snapshot missing')
		const { repGrid, maximumAdmissibleBidAttoRepPerLot: maximum, inventoryAttoRep } = snapshot.auction
		const inventoryLimit = inventoryAttoRep / 2n
		expect(maximum).toBe(mode === 'target' ? 6n * unit - repGrid : inventoryLimit - (inventoryLimit % repGrid))
		const terms = { lots: 1n, minimumAttoRepPerLot: maximum + repGrid }
		expect(() => quoteSecurityPoolAuctionBid(snapshot, terms)).toThrow('Better funded bids')
		await expect(context.bid(context.other, 1n, maximum + repGrid)).rejects.toThrow('Better bids already exclude this bid')
		expect(quoteSecurityPoolAuctionBid(snapshot, { ...terms, minimumAttoRepPerLot: maximum }).bidAttoEth).toBe(snapshot.auction.lotAttoEth)
		await context.bid(context.other, 1n, maximum)
	})

	test('all winners immediately back claims at one price before any bid is materialized', async () => {
		const context = await prepare()
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'oracleRepExposure', args: [context.child] })).toBe(2_000n * unit)
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'oracleExposure', args: [context.child] })).toBe(205n * unit)
		await expect(context.open()).rejects.toThrow('quote is not funded and fresh')
		await context.report()
		const readAuction = () => loadSecurityPoolAuctionSnapshot({ client: context.owner, securityPool: fixture.securityPool, bidder: context.owner.account.address, universeId: context.child })
		await writeContractAndWait(context.owner, async () => context.owner.sendTransaction(buildSecurityPoolAuctionOpenRequest(await readAuction())))
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const collateral = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'collateralToken' })
		await approveToken(context.owner, collateral, context.auction)
		const opened = await readAuction()
		if (opened.auction === undefined) throw new Error('Auction snapshot missing')
		const terms = { lots: 2n, minimumAttoRepPerLot: 5n * unit - ((5n * unit) % grid) }
		const bidQuote = quoteSecurityPoolAuctionBid(opened, terms)
		expect(bidQuote.bidAttoEth).toBe(2n * unit)
		await writeContractAndWait(context.owner, () => context.owner.sendTransaction(buildSecurityPoolAuctionBidRequest(opened, terms)))
		const firstSnapshot = (await readAuction()).auction?.bids[0]
		if (firstSnapshot === undefined) throw new Error('Submitted bid missing')
		const first = { id: firstSnapshot.id, bidder: firstSnapshot.bidder }
		expect(first.bidder).toBe(context.owner.account.address)
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'unclaimedRepairAuctionBids', args: [first.bidder] })).toBe(1n)
		const second = await context.bid(context.other, 4n)
		// The bidder chose this branch, so its imported position already exists.
		const base = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.bidder] })
		const accountBefore = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [first.bidder] })
		expect(accountBefore.positionId).not.toBe(0n)
		await context.closingQuote()
		const supplyBefore = await context.owner.readContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'totalSupply' })
		await context.finalize()
		// A full repair burns the 970 unsold REP instead of attaching it to claims.
		expect(await context.owner.readContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'totalSupply' })).toBe(supplyBefore - 970n * unit)
		expect(await context.balance(context.forks)).toBe(0n)
		const firstFill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [first.id] })
		const secondFill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [second.id] })
		expect([firstFill.filledLots, secondFill.filledLots]).toEqual([2n, 3n])
		expect(firstFill.principalAttoRep * secondFill.usedAttoEth).toBe(secondFill.principalAttoRep * firstFill.usedAttoEth)
		expect((await readAuction()).auction?.bids[0]?.fill?.filledLots).toBe(2n)
		const totalsBefore = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'totals' })
		expect(totalsBefore[1]).toBe(205n * unit)
		expect(await context.balance(context.capital)).toBe(1_000n * unit + 30n * unit)
		// Unclaimed lots stay in the shared cohort: the account shows only its own position until the bid is claimed.
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.bidder] })).slice(0, 2)).toEqual(base.slice(0, 2))
		const [unclaimedFirst] = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'repairAuctionPositions', args: [[first.id]] })
		expect(unclaimedFirst).toMatchObject({ bidder: first.bidder, principal: firstFill.principalAttoRep, commitment: 2n * unit, claimed: false })
		// Anyone may claim.
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'materializeRepairAuctionBids', args: [[first.id]] }))
		const virtual = [base[0] + firstFill.principalAttoRep, base[1] + 2n * unit]
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'totals' })).toEqual(totalsBefore)
		const account = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [first.bidder] })
		// The lots merged into the bidder's existing position, which keeps the owner's own health target.
		expect(account.positionId).toBe(accountBefore.positionId)
		expect(account.targetHealthFactorBps).toBe(accountBefore.targetHealthFactorBps)
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.bidder] })).slice(0, 2)).toEqual(virtual.slice(0, 2))
		expect(await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'unclaimedRepairAuctionBids', args: [first.bidder] })).toBe(0n)
		const before = await context.balance(context.other.account.address)
		const refundRecipient = context.owner.account.address
		const ethBefore = await collateralBalance(context.owner, fixture.securityPool, refundRecipient)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [second.id, refundRecipient] }))
		expect(await context.balance(context.other.account.address)).toBe(before)
		expect(await collateralBalance(context.owner, fixture.securityPool, refundRecipient)).toBe(ethBefore + unit)
		const settlement = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect((await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] }))[0]).toBe(10n * unit)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'recoveryRep', args: [bookId] })).toBe(0n)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'isCashFunded', args: [bookId] })).toBe(true)
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'availableMintCapacity', args: [context.child] })).toBe(195n * unit)
		await expect(context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [context.child, fixture.base.questionId, unit] })).rejects.toThrow('Settlement mint closed')
		expect(await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'quoteMintRecoveryRep', args: [context.child, fixture.secondQuestionId, unit] })).toBe(0n)
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'quoteRecoveryRep', args: [bookId, fixture.base.questionId, 10n * unit] })).toBe(0n)
		await approveToken(context.owner, context.token, context.capital)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'depositAndSetHealthTarget', args: [unit, 12_000n] }))
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerCollateral', args: [first.bidder] }))[0]).toBe((virtual[0] ?? 0n) + unit)
		expect((await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'ownerAccount', args: [first.bidder] })).targetHealthFactorBps).toBe(12_000n)
		const walletBefore = await context.balance(context.owner.account.address)
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'withdrawPrincipal', args: [unit, context.owner.account.address] }))
		expect(await context.balance(context.owner.account.address)).toBe(walletBefore + unit)
	})

	test('each claimed bid merges into the bidder’s existing position; ordinary operations claim nothing', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const capital = { abi: capitalArtifact.abi, address: context.capital } as const
		const unclaimed = (holder: Address) => context.owner.readContract({ ...capital, functionName: 'unclaimedRepairAuctionBids', args: [holder] })
		const bidPositions = (bidIds: bigint[]) => context.owner.readContract({ ...capital, functionName: 'repairAuctionPositions', args: [bidIds] })
		const account = (holder: Address) => context.owner.readContract({ ...capital, functionName: 'ownerAccount', args: [holder] })
		const position = (id: bigint) => context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'accountOf', args: [id] })
		const claim = (client: WriteClient, bidIds: bigint[]) => writeContractAndWait(client, () => client.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [bidIds] }))
		const bidder = context.owner.account.address
		const losing = context.other.account.address
		const winner = await context.bid(context.owner, 2n)
		const loser = await context.bid(context.other, 1n, 100n * unit)
		const partial = await context.bid(context.owner, 5n)
		await context.closingQuote()
		await context.finalize()
		const fills = await Promise.all([winner, partial].map(bid => context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })))
		const [winnerFill, partialFill] = fills
		if (winnerFill === undefined || partialFill === undefined) throw new Error('Fills missing')
		expect(winnerFill.filledLots).toBe(2n)
		expect(partialFill.filledLots).toBeGreaterThan(0n)
		// The owner chose this branch, so its imported position already exists.
		const before = await account(bidder)
		expect(before.positionId).not.toBe(0n)
		const imported = await position(before.positionId)
		expect(await unclaimed(bidder)).toBe(2n)
		const totals = await context.owner.readContract({ ...capital, functionName: 'totals' })
		// An ordinary operation no longer moves lots.
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ ...capital, functionName: 'setHealthTarget', args: [12_000n] }))
		expect(await unclaimed(bidder)).toBe(2n)
		expect(await position(before.positionId)).toMatchObject({ rep: imported.rep, commitment: imported.commitment })
		// Each claim merges exactly its own bid.
		await claim(context.other, [winner.id])
		expect(await unclaimed(bidder)).toBe(1n)
		expect(await position(before.positionId)).toMatchObject({ rep: imported.rep + winnerFill.principalAttoRep, commitment: imported.commitment + 2n * unit })
		// A batch may mix claimed, winning and losing bids of several bidders; claimed ones are skipped.
		await claim(context.other, [winner.id, partial.id, loser.id])
		expect(await unclaimed(bidder)).toBe(0n)
		expect(await unclaimed(losing)).toBe(0n)
		const merged = await position(before.positionId)
		expect(merged).toMatchObject({ rep: imported.rep + winnerFill.principalAttoRep + partialFill.principalAttoRep, commitment: imported.commitment + (2n + partialFill.filledLots) * unit })
		expect((await account(bidder)).positionId).toBe(before.positionId)
		expect(await context.owner.readContract({ ...capital, functionName: 'totals' })).toEqual(totals)
		const [winnerView, partialView, loserView] = await bidPositions([winner.id, partial.id, loser.id])
		// Claimed lots belong to the bidder's account, whose position the account reports.
		expect(winnerView).toMatchObject({ bidder, claimed: true, principal: winnerFill.principalAttoRep, earnedAttoEth: 0n, earnedAttoRep: 0n })
		expect(partialView).toMatchObject({ bidder, claimed: true, principal: partialFill.principalAttoRep, earnedAttoEth: 0n, earnedAttoRep: 0n })
		expect(loserView).toMatchObject({ bidder: losing, claimed: true, principal: 0n })
		expect((await account(losing)).positionId).toBe(0n)
	})

	test('one account may place more bids than any former cap and claim them in one batch', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const grid = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		// Each later bid asks for less REP, so earlier bids never exclude it.
		const price = (step: bigint) => 6n * unit - step * grid
		const ids: bigint[] = []
		for (let count = 0n; count < 10n; count++) ids.push((await context.bid(context.other, 1n, price(count))).id)
		const capital = { abi: capitalArtifact.abi, address: context.capital } as const
		expect(await context.owner.readContract({ ...capital, functionName: 'unclaimedRepairAuctionBids', args: [context.other.account.address] })).toBe(10n)
		await context.closingQuote()
		await context.finalize()
		await writeContractAndWait(context.other, () => context.other.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [ids] }))
		expect(await context.owner.readContract({ ...capital, functionName: 'unclaimedRepairAuctionBids', args: [context.other.account.address] })).toBe(0n)
		expect((await context.owner.readContract({ ...capital, functionName: 'repairAuctionPositions', args: [ids] })).every(view => view.claimed)).toBe(true)
	})

	test('a claim batch of the clients’ maximum size of winning bids fits in one transaction', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture, 40n * unit)
		await context.report()
		await context.open()
		const auction = { abi: auctionArtifact.abi, address: context.auction } as const
		const capital = { abi: capitalArtifact.abi, address: context.capital } as const
		const [grid, targetLots] = await Promise.all([context.owner.readContract({ ...auction, functionName: 'repGrid' }), context.owner.readContract({ ...auction, functionName: 'targetLots' })])
		const ids: bigint[] = []
		for (let count = 0n; count < targetLots && count < BigInt(MAX_REPAIR_AUCTION_CLAIM_BATCH); count++) ids.push((await context.bid(context.other, 1n, 6n * unit - count * grid)).id)
		await context.closingQuote()
		await context.finalize()
		// Every bid in the batch won, so every claim merges lots: the costliest batch the clients send.
		const views = await context.owner.readContract({ ...capital, functionName: 'repairAuctionPositions', args: [ids] })
		expect(ids).toHaveLength(MAX_REPAIR_AUCTION_CLAIM_BATCH)
		expect(views.every(view => view.commitment !== 0n)).toBe(true)
		const hash = await writeContractAndWait(context.other, () => context.other.writeContract({ ...capital, functionName: 'materializeRepairAuctionBids', args: [ids] }))
		const gas = (await context.other.getTransactionReceipt({ hash })).gasUsed
		// The 2^24 per-transaction gas limit, with room for deeper bid and position trees.
		expect(gas).toBeLessThan(12_000_000n)
	})

	test('#1363 a week-old opening quote cannot settle the collateral repair sale', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const before = await collateralBalance(context.other, fixture.securityPool, context.other.account.address)
		const bid = await context.bid(context.other, 2n)
		// No report follows the opening one, so no price is valid at the deadline.
		await context.mock.setTime(context.deadline)
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })).toBeLessThan(context.deadline)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [bid.id, context.other.account.address] }))
		expect(await collateralBalance(context.other, fixture.securityPool, context.other.account.address)).toBe(before)
	})

	test('#1363 final-day acceptance cannot rescue an observation eligible before that day', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.mock.setTime(context.deadline - DAY - 482n)
		await context.report()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'lastSettlementTimestamp' })).toBe(context.deadline - DAY - 1n)
		expect((await context.owner.getBlock()).timestamp).toBeGreaterThan(context.deadline - DAY)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
	})

	test('#1363 a final-day quote can close after its short price validity window expires', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.mock.setTime(context.deadline - 7_200n)
		await context.report()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'priceValidUntil' })).toBeLessThan(context.deadline)
		await context.finalize()
		const fill = await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(2n)
		expect(fill.refundAttoEth).toBe(0n)
	})

	test('a closing price the inventory cannot back fills nothing and refunds bid ETH', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const before = await context.balance(context.other.account.address)
		const bid = await context.bid(context.other, 2n)
		// At 2,000 REP per ETH one lot needs more REP than the whole inventory holds.
		await addRepToMigrationBalance(context.owner, context.source, 30_000n * unit)
		await splitMigrationRep(context.owner, context.source, 30_000n * unit, [1])
		await approveToken(context.owner, context.token, context.feed)
		await context.closingQuote(2_000n * unit)
		await context.finalize()
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(0n)
		// An unrepaired branch keeps every unsold REP for its inherited claims.
		const settlement = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect(await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'recoveryRep', args: [bookId] })).toBe(1_000n * unit)
		await writeContractAndWait(context.other, () => context.other.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'refundBid', args: [bid.id, context.other.account.address] }))
		expect(await context.balance(context.other.account.address)).toBe(before)
		expect(await context.other.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'demandAttoEth' })).toBe(5n * unit)
	})

	test('a later native fork cannot cancel an auction that was valid at its earlier fixed close', async () => {
		const context = await prepare()
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 2n)
		await context.closingQuote()
		const threshold = await getZoltarForkThreshold(context.owner, context.child)
		await addRepToMigrationBalance(context.owner, context.source, threshold)
		await splitMigrationRep(context.owner, context.source, threshold, [1])
		await context.mock.setTime(context.deadline + 8n * DAY)
		await forkUniverse(context.owner, context.child, fixture.base.questionId)
		await context.finalize(context.deadline + 8n * DAY + 10n)
		expect((await context.other.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })).filledLots).toBe(2n)
	})

	test('the REP inventory challenge requirement cannot be bypassed with a cheap proposed REP price', async () => {
		const context = await prepare()
		expect(await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken2ReportAttoRep' })).toBe(20n * unit)
		const minimum = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit / 10n] })
		expect(minimum).toBe(200n * unit)
		await expect(context.report(unit / 10n, 10n * unit)).rejects.toThrow('Report funding below minimum')
	})
	test('the feed quote has an exact unrounded two-asset security frontier', async () => {
		const c = await prepare()
		const cash = await c.owner.readContract({ abi: feedArtifact.abi, address: c.feed, functionName: 'minimumToken1ReportAttoEth' }),
			rep = await c.owner.readContract({ abi: feedArtifact.abi, address: c.feed, functionName: 'minimumToken2ReportAttoRep' })
		expect(cash > 0n && rep > 0n).toBe(true)
		let last,
			repBound = 0,
			cashBound = 0,
			dust = 0
		await expect(c.owner.readContract({ abi: feedArtifact.abi, address: c.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [1n] })).rejects.toThrow('Oracle liquidation price is zero')
		const switchPrice = (rep * unit + cash - 1n) / cash
		for (const p of [...new Set([2n, 13n, 997n, unit / 5n, unit - 1n, unit, unit + 1n, switchPrice - 1n, switchPrice, switchPrice + 1n, 10n ** 27n].filter(p => p > 0n))].sort((a, b) => (a < b ? -1 : 1))) {
			const needed = await c.owner.readContract({ abi: feedArtifact.abi, address: c.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [p] })
			expect(needed >= cash && needed * p >= rep * unit).toBe(true)
			expect(needed - 1n < cash || (needed - 1n) * p < rep * unit).toBe(true)
			if (last !== undefined) expect(needed <= last).toBe(true)
			if (needed === cash) cashBound++
			else repBound++
			if (needed > cash && ((needed - 1n) * p + unit - 1n) / unit >= rep) dust++
			last = needed
		}
		expect(Math.min(cashBound, repBound, dust)).toBeGreaterThan(0)
	})
})
