import { expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, securityPoolPortfolioAuctionAbi, securityPoolPortfolioForkCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
import { auctionFixture } from '../support/portfolio-fixtures.ts'
import { auctionDefinition, finalizeCollateralRepairAuctionRoute, refundLosingAuctionBids, settleAuctionBids } from '../../src/operations/statoblast/auctions.ts'
import { address, hash, snapshotFixture, planningOptionsFixture } from './fixture.ts'

test('portfolio auction bids exact collateral lots and chosen REP price on the grid', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString(), healthFactorBps: '10000' } })
	const operation = auctionDefinition('bid')
	const step = operation.buildPlan(snapshot, options)?.steps[0]
	if (step === undefined) throw new Error('Missing auction bid')
	expect(step.to).toBe(auction.address)
	expect(step.value).toBe('0')
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

test('auction bids approve collateral separately, enforce token balances, and clean up changed terms', () => {
	const snapshot = snapshotFixture()
	const auction = auctionFixture()
	snapshot.auctions = [auction]
	auction.collateralAllowance = '0'
	const options = planningOptionsFixture({ maxEthSpendAttoEth: 2000n.toString(), operationInputs: { lots: '2', minimumAttoRepPerLot: 15n.toString(), healthFactorBps: '10000' } })
	const operation = auctionDefinition('bid')
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
