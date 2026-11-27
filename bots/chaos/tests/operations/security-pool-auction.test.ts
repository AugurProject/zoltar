import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, securityPoolCapitalLedgerAbi, securityPoolRepairAuctionAbi, securityPoolForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { MAX_REPAIR_AUCTION_CLAIM_BATCH } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { auctionFixture } from '../support/security-pool-fixtures.ts'
import { bidInCollateralRepairAuction, claimAuctionBids, startCollateralRepairAuction, finalizeCollateralRepairAuctionRoute, refundLosingAuctionBids, settleAuctionBids } from '../../src/operations/statoblast/auctions.ts'
import { address, snapshotFixture, planningOptionsFixture } from './fixture.ts'

test('security pool auction bids exact collateral lots and chosen REP price on the grid', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString() } })
	const operation = bidInCollateralRepairAuction
	const step = operation.buildPlan(snapshot, options)?.steps[0]
	if (step === undefined) throw new Error('Missing auction bid')
	expect(step.to).toBe(auction.address)
	expect(step.value).toBe('0')
	expect(decodeFunctionData({ abi: securityPoolRepairAuctionAbi, data: step.data }).args).toEqual([2n, 15n])
	expect(operation.buildPlan(snapshot, { ...options, maxEthSpendAttoEth: 1999n.toString() })).toBeUndefined()
	expect(operation.buildPlan(snapshot, { ...options, operationInputs: { minimumAttoRepPerLot: 14n.toString() } })).toBeUndefined()
	expect(operation.buildPlan(snapshot, { ...options, allowHighRisk: false })).toBeUndefined()
})

test('losing bids refund to the wallet before closing and finalized refunds use the same native bid identity', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture()
	const plan = refundLosingAuctionBids.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing refund settlement')
	expect(plan?.metadata['bidId']).toBe('1')
	expect(decodeFunctionData({ abi: securityPoolRepairAuctionAbi, data: step.data })).toMatchObject({ functionName: 'refundBid', args: [1n, snapshot.wallet.address] })
	auction.finalized = true
	expect(refundLosingAuctionBids.buildPlan(snapshot, options)).toBeUndefined()
	expect(settleAuctionBids.buildLifecyclePlans?.(snapshot, options)).toHaveLength(1)
	auction.refundableBidIds = []
	expect(settleAuctionBids.buildPlan(snapshot, options)).toBeUndefined()
})

test('branch finalization targets the fork controller', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	auction.endTime = '100'
	const options = planningOptionsFixture()
	const step = finalizeCollateralRepairAuctionRoute.buildPlan(snapshot, options)?.steps[0]
	if (step === undefined) throw new Error('Missing branch finalization')
	expect(step.to).toBe(auction.forkController)
	expect(decodeFunctionData({ abi: securityPoolForkCoordinatorAbi, data: step.data })).toMatchObject({ functionName: 'finalizeBranch', args: [2n] })
})

test('auction bids start from unrounded floor collateral before applying the REP grid', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.maximumBidAttoRepPerLot = '21'
	snapshot.auctions = [auction]
	const bid = bidInCollateralRepairAuction
	expect(bid.evaluate(snapshot, planningOptionsFixture({ operationInputs: { minimumAttoRepPerLot: 12n.toString() } })).eligible).toBe(true)
	expect(bid.evaluate(snapshot, planningOptionsFixture({ operationInputs: { minimumAttoRepPerLot: 9n.toString() } })).eligible).toBe(false)
	expect(bid.buildPlan(snapshot, planningOptionsFixture({}))?.metadata['minimumAttoRepPerLot']).toBe('12')
})

test('auction bids have no per-bidder bid limit', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.bids = Array.from({ length: 20 }, (_, index) => ({ bidId: (index + 1).toString(), lots: '1', minimumAttoRepPerLot: 15n.toString(), settled: false }))
	snapshot.auctions = [auction]
	expect(bidInCollateralRepairAuction.evaluate(snapshot, planningOptionsFixture({})).eligible).toBe(true)
})

test('claims every claimable bid of the wallet in one capital ledger transaction', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture()
	expect(claimAuctionBids.evaluate(snapshot, options).eligible).toBe(false)
	expect(claimAuctionBids.buildLifecyclePlans?.(snapshot, options)).toEqual([])
	auction.claimableBidIds = ['1', '4']
	const plan = claimAuctionBids.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing bid claim')
	expect(plan?.steps).toHaveLength(1)
	expect(step.to).toBe(auction.capital)
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: step.data })).toMatchObject({ functionName: 'materializeRepairAuctionBids', args: [[1n, 4n]] })
	expect(plan?.metadata).toMatchObject({ auction: auction.address, capital: auction.capital, bidIds: '1,4' })
	expect(claimAuctionBids.enumerateLifecyclePresence?.(snapshot, options)).toEqual([{ auction: auction.address, capital: auction.capital, bidIds: '1,4' }])
	expect(claimAuctionBids.buildPlan(snapshot, planningOptionsFixture({ operationInputs: { auction: address(1) } }))).toBeUndefined()
})

test('a wallet with more claimable bids than one batch claims them one block-sized batch at a time', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	auction.claimableBidIds = Array.from({ length: MAX_REPAIR_AUCTION_CLAIM_BATCH + 5 }, (_, index) => String(index + 1))
	const step = claimAuctionBids.buildPlan(snapshot, planningOptionsFixture())?.steps[0]
	if (step === undefined) throw new Error('Missing bid claim')
	const batch = auction.claimableBidIds.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH).map(BigInt)
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: step.data })).toMatchObject({ functionName: 'materializeRepairAuctionBids', args: [batch] })
})

test('auction bids approve collateral separately, enforce token balances, and clean up changed terms', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	auction.collateralAllowance = '0'
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString() } })
	const operation = bidInCollateralRepairAuction
	const plan = operation.buildPlan(snapshot, options)
	if (plan === undefined || operation.buildContinuationPlan === undefined) throw new Error('Missing bid plan')
	expect(plan.steps.map(step => step.id)).toEqual(['approve-auction-collateral', 'bid'])
	const approval = plan.steps[0]
	if (approval === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi: erc20Abi, data: approval.data }).args).toEqual([auction.address, 2000n])
	expect(plan.steps[1]?.value).toBe('0')
	expect(plan.steps[1]?.walletAssetDebits).toEqual([{ amount: '2000', asset: snapshot.deployments.weth, kind: 'erc20', category: 'weth' }])
	auction.collateralAllowance = '2000'
	const context = { previousPlan: { ...plan, planningSeed: options.seed }, confirmedStepIds: ['approve-auction-collateral'] }
	expect(operation.buildContinuationPlan(snapshot, options, context)?.steps.map(step => step.id)).toEqual(['bid'])
	auction.walletCollateral = '1999'
	expect(operation.buildPlan(snapshot, options)).toBeUndefined()
	expect(operation.buildContinuationPlan(snapshot, options, context)?.continuationDisposition).toBe('cleanup-only')
	auction.walletCollateral = '2000'
	auction.collateralToken = address(8)
	expect(operation.buildPlan(snapshot, options)).toBeUndefined()
})

test('#1331 unattended opening reserves a full day for competing bids', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.opened = false
	auction.endTime = (BigInt(snapshot.anchor.timestamp) + 86_399n).toString()
	snapshot.auctions = [auction]
	expect(startCollateralRepairAuction.buildPlan(snapshot, planningOptionsFixture())).toBeUndefined()
	auction.endTime = (BigInt(snapshot.anchor.timestamp) + 86_400n).toString()
	expect(startCollateralRepairAuction.buildPlan(snapshot, planningOptionsFixture())).toBeDefined()
})

test('#1371 excluded bid prices do not produce an unattended approval or bid plan', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.maximumAdmissibleBidAttoRepPerLot = '14'
	auction.collateralAllowance = '0'
	snapshot.auctions = [auction]
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString() } })
	expect(bidInCollateralRepairAuction.buildPlan(snapshot, options)).toBeUndefined()
})

test('auction opening requires a successful anchored simulation of inventory, universe and funding guards', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.opened = false
	auction.openingExpectedSuccess = false
	snapshot.auctions = [auction]
	expect(startCollateralRepairAuction.buildPlan(snapshot, planningOptionsFixture())).toBeUndefined()
	auction.openingExpectedSuccess = true
	expect(startCollateralRepairAuction.buildPlan(snapshot, planningOptionsFixture())).toBeDefined()
})
