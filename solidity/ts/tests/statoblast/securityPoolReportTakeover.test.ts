import { describe, expect, test } from 'bun:test'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_openOracle_OpenOracle_OpenOracle as oracleArtifact } from '../../types/contractArtifact'
import { encodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../types/contractArtifact'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { ReputationToken_ReputationToken as tokenArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { loadOpenOracleEventState, openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { preparePortfolioTruthAuction } from './securityPoolPortfolioTruthAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const requestAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])
function operationBatch(intent: {
	positionId: bigint
	bidId: bigint
	commitment: bigint
	minimumAward: bigint
	maximumOwnRep: bigint
	maximumOwnerPrincipal: bigint
	maximumOwnerCommitment: bigint
	expectedTargetHealthFactorBps: bigint
	expectedSourceBatch: bigint
	minimumPrice: bigint
	maximumPrice: bigint
	deadline: bigint
}) {
	const bounds = { maximumOwnerPrincipal: intent.maximumOwnerPrincipal, maximumOwnerCommitment: intent.maximumOwnerCommitment, expectedTargetHealthFactorBps: intent.expectedTargetHealthFactorBps, expectedAcceptedPriceEpoch: 0n, expectedSourceBatch: intent.expectedSourceBatch }
	const data =
		intent.bidId === 0n
			? encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'takeOverWithBounds', args: [intent.positionId, intent.commitment, intent.minimumAward, intent.maximumOwnRep, bounds] })
			: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'takeOverAuctionBid', args: [intent.bidId, intent.commitment, intent.minimumAward, intent.maximumOwnRep, bounds] })
	return { gasLimit: 3_100_000n, minimumPrice: intent.minimumPrice, maximumPrice: intent.maximumPrice, deadline: intent.deadline, operations: [{ gasLimit: 3_000_000n, data }] }
}

describe('Statoblast: report sponsor takeover priority', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const prepare = async () => {
		await fixture.prepare(400n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		const sponsor = fixture.other()
		await fixture.deposit(3_000n * unit, sponsor)
		const owner = await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [fixture.owner().account.address] })
		const address = await sponsor.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		const weth = await sponsor.readContract({ ...feed, functionName: 'weth' })
		const rep = await sponsor.readContract({ ...feed, functionName: 'reputationToken' })
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, weth, address)
		await approveToken(sponsor, rep, address)
		const timestamp = (await sponsor.getBlock()).timestamp
		return {
			sponsor,
			feed,
			intent: {
				positionId: owner.positionId,
				bidId: 0n,
				commitment: 100n * unit,
				minimumAward: 1n,
				maximumOwnRep: 3_000n * unit,
				maximumOwnerPrincipal: 4_000n * unit,
				maximumOwnerCommitment: 100n * unit,
				expectedTargetHealthFactorBps: 10_000n,
				expectedSourceBatch: 0n,
				minimumPrice: 4n * unit,
				maximumPrice: 4n * unit,
				deadline: timestamp + 1000n,
			},
		}
	}
	test('a competing settler executes the funded sponsor takeover before they can take it', async () => {
		const { sponsor, feed, intent } = await prepare()
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: requestAbi, address: feed.address, functionName: 'requestPortfolioPriceWithOperations', args: [4n * unit, 10n * unit, bounty, operationBatch(intent)], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(fixture.owner(), report)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		const receiver = await sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [sponsor.account.address] })
		expect(receiver[1]).toBe(100n * unit)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [fixture.owner().account.address] }))[1]).toBe(0n)
	})
	for (const failure of ['expiry', 'price', 'award', 'funding', 'cohort', 'health target'] as const) {
		test(`a failed ${failure} bound preserves accepted price and both owners' funds`, async () => {
			const { sponsor, feed, intent } = await prepare()
			if (failure === 'expiry') intent.deadline -= 600n
			if (failure === 'price') intent.maximumPrice--
			if (failure === 'award') intent.minimumAward = 1_000n * unit
			if (failure === 'funding') intent.maximumOwnRep = 0n
			if (failure === 'cohort') intent.expectedSourceBatch = 1n
			if (failure === 'health target') intent.expectedTargetHealthFactorBps = 12_000n
			// Expiry and price must be valid at submission, then become invalid before acceptance.
			if (failure === 'price') intent.minimumPrice = 0n
			const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
			await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: requestAbi, address: feed.address, functionName: 'requestPortfolioPriceWithOperations', args: [4n * unit, 10n * unit, bounty, operationBatch(intent)], value: bounty }))
			const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
			const before = await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })
			await fixture.base.mockWindow.advanceTime(481n)
			await openOracleSettle(fixture.owner(), report)
			expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
			expect(await sponsor.readContract({ ...capital(), functionName: 'isPriceValid' })).toBe(true)
			expect(await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).toEqual(before)
			expect((await sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [fixture.owner().account.address] }))[1]).toBe(100n * unit)
		})
	}
	test('only the canonical feed can execute a sponsor intent', async () => {
		const { sponsor, intent } = await prepare()
		const abi = parseAbi(['function executeReportOperation(address sponsor,bytes data)'])
		await expect(sponsor.writeContract({ abi, address: fixture.capitalLedger, functionName: 'executeReportOperation', args: [sponsor.account.address, operationBatch(intent).operations[0]?.data ?? '0x'] })).rejects.toThrow('Only canonical shared feed')
	})

	test.each([false, true])('an auction winner materialization rolls back with its failed takeover: %s', async failure => {
		const context = await preparePortfolioTruthAuction(fixture)
		await context.report()
		await context.open()
		await context.bid(context.owner, 2n, (35n * unit) / 10n)
		const winner = await context.bid(context.other, 3n, (35n * unit) / 10n)
		await context.closingQuote()
		await context.finalize()
		const ledger = { abi: capitalArtifact.abi, address: context.capital }
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ ...ledger, functionName: 'setCommitment', args: [0n] }))
		await context.report(5n * unit)
		await context.mock.advanceTime(3601n)
		const sponsor = createWriteClient(context.mock, TEST_ADDRESSES[2])
		await writeContractAndWait(context.owner, () => context.owner.writeContract({ abi: tokenArtifact.abi, address: context.token, functionName: 'transfer', args: [sponsor.account.address, 150n * unit] }))
		await approveToken(sponsor, context.token, context.capital)
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...ledger, functionName: 'depositFor', args: [sponsor.account.address, 60n * unit] }))
		await approveToken(sponsor, context.token, context.feed)
		const weth = await sponsor.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'weth' })
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, weth, context.feed)
		const timestamp = (await context.owner.getBlock()).timestamp
		const bounty = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'getRequestPriceCostAttoEth' })
		const intent = {
			positionId: 0n,
			bidId: winner.id,
			commitment: 3n * unit,
			minimumAward: failure ? 10_000n * unit : 0n,
			maximumOwnRep: 10_000n * unit,
			maximumOwnerPrincipal: 20_000n * unit,
			maximumOwnerCommitment: 10n * unit,
			expectedTargetHealthFactorBps: 10_000n,
			expectedSourceBatch: 0n,
			minimumPrice: 5n * unit,
			maximumPrice: 5n * unit,
			deadline: timestamp + 1000n,
		}
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: requestAbi, address: context.feed, functionName: 'requestPortfolioPriceWithOperations', args: [5n * unit, 10n * unit, bounty, operationBatch(intent)], value: bounty }))
		const id = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'pendingReportId' })
		await context.mock.advanceTime(481n)
		await openOracleSettle(context.other, id)
		expect((await context.owner.readContract({ ...ledger, functionName: 'auctionPosition', args: [winner.id] })).materialized).toBe(!failure)
		expect((await context.owner.readContract({ ...ledger, functionName: 'ownerCollateral', args: [sponsor.account.address] }))[1]).toBe(failure ? 0n : 3n * unit)
	})
	test('a settler cannot publish the price by starving the protected takeover callback', async () => {
		const { sponsor, feed, intent } = await prepare()
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: requestAbi, address: feed.address, functionName: 'requestPortfolioPriceWithOperations', args: [4n * unit, 10n * unit, bounty, operationBatch(intent)], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		const epoch = await sponsor.readContract({ ...feed, functionName: 'acceptedEpoch' })
		const preimage = (await loadOpenOracleEventState(sponsor, report)).latest
		await fixture.base.mockWindow.advanceTime(481n)
		const attacker = fixture.owner()
		await writeContractAndWait(attacker, () => attacker.writeContract({ abi: oracleArtifact.abi, address: getInfraContractAddresses().openOracle, functionName: 'settle', args: [report, getOpenOracleGameTuple(preimage.game), getOpenOracleHelperTuple(preimage.helper)], gas: 1_500_000n }))
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(0n)
		expect(await sponsor.readContract({ ...feed, functionName: 'acceptedEpoch' })).toBe(epoch)
		expect(await sponsor.readContract({ ...capital(), functionName: 'isPriceValid' })).toBe(false)
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report] }))
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(2n)
	})
})
