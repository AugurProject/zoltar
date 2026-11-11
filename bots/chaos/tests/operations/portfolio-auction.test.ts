import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { securityPoolPortfolioAuctionAbi, securityPoolPortfolioForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { auctionFixture } from '../support/portfolio-fixtures.ts'
import { auctionDefinition, finalizeCollateralRepairAuctionRoute, refundLosingAuctionBids, settleAuctionBids } from '../../src/operations/statoblast/auctions.ts'
import { hash, snapshotFixture, planningOptionsFixture } from './fixture.ts'

test('portfolio auction bids exact ETH lots and chosen REP price on the grid', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString(), healthFactorBps: '10000' } })
	const operation = auctionDefinition('bid')
	const step = operation.buildPlan(snapshot, options)?.steps[0]
	if (step === undefined) throw new Error('Missing auction bid')
	expect(step.to).toBe(auction.address)
	expect(step.value).toBe('2000')
	expect(decodeFunctionData({ abi: securityPoolPortfolioAuctionAbi, data: step.data }).args).toEqual([2n, 15n, 10000n])
	expect(operation.buildPlan(snapshot, { ...options, maxEthSpendAttoEth: 1999n.toString() })).toBeUndefined()
	expect(operation.buildPlan(snapshot, { ...options, operationInputs: { minimumAttoRepPerLot: 14n.toString() } })).toBeUndefined()
	expect(operation.buildPlan(snapshot, { ...options, allowHighRisk: false })).toBeUndefined()
})

test('losing bids can settle before closing and finalized refunds use the same native bid identity', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture()
	const plan = refundLosingAuctionBids.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing refund settlement')
	expect(plan?.metadata['bidId']).toBe('1')
	expect(decodeFunctionData({ abi: securityPoolPortfolioAuctionAbi, data: step.data })).toMatchObject({ functionName: 'settleRefund', args: [1n] })
	auction.finalized = true
	expect(refundLosingAuctionBids.buildPlan(snapshot, options)).toBeUndefined()
	expect(settleAuctionBids.buildLifecyclePlans?.(snapshot, options)).toHaveLength(1)
	auction.refundableBidIds = []
	expect(settleAuctionBids.buildPlan(snapshot, options)).toBeUndefined()
})

test('branch finalization targets the fork controller and refund withdrawals preserve generation', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	auction.endTime = '100'
	const options = planningOptionsFixture()
	const step = finalizeCollateralRepairAuctionRoute.buildPlan(snapshot, options)?.steps[0]
	if (step === undefined) throw new Error('Missing branch finalization')
	expect(step.to).toBe(auction.forkController)
	expect(decodeFunctionData({ abi: securityPoolPortfolioForkCoordinatorAbi, data: step.data })).toMatchObject({ functionName: 'finalizeBranch', args: [2n] })
	auction.pendingEthRefund = '2000'
	const withdraw = auctionDefinition('withdraw-refund')
	expect(withdraw.buildPlan(snapshot, options)).toBeUndefined()
	auction.pendingEthRefundGeneration = hash(123)
	const refund = withdraw.buildPlan(snapshot, options)
	expect(refund?.metadata['refundGeneration']).toBe(hash(123))
	expect(refund?.steps[0]?.to).toBe(auction.address)
})

test('auction health rounding starts with unrounded collateral before applying the REP grid', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	auction.maximumBidAttoRepPerLot = '21'
	snapshot.auctions = [auction]
	const options = planningOptionsFixture({ operationInputs: { healthFactorBps: '20000', minimumAttoRepPerLot: 21n.toString() } })
	expect(auctionDefinition('bid').evaluate(snapshot, options).eligible).toBe(true)
})
