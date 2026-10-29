import { type Address, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { unit, type useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

export async function preparePortfolioTruthAuction(fixture: ReturnType<typeof useSecurityPoolPortfolioFixture>) {
	const owner = fixture.owner()
	const other = fixture.other()
	const mock = fixture.base.mockWindow
	const source = fixture.base.genesisUniverse
	await fixture.prepare()
	await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(source), functionName: 'transfer', args: [other.account.address, 1_000n * unit] }))
	await fixture.deposit(1_000n * unit, other)
	await fixture.authorize(200n * unit, other)
	await fixture.mint(10n * unit)
	const forks = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'forkController' })
	await mock.setTime(fixture.base.questionData.endTime + 1n)
	await approveToken(owner, getRepTokenAddress(source), getZoltarAddress())
	await forkUniverse(owner, source, fixture.base.questionId)
	const forkTime = (await getUniverseData(owner, source)).forkTime
	await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'choose', args: [source, 1n] }))
	const child = getChildUniverseId(source, 1)
	await mock.setTime(forkTime + 56n * DAY)
	await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'startBranch', args: [source, 1n] }))
	const auction = await owner.readContract({ abi: forkArtifact.abi, address: forks, functionName: 'auctions', args: [child] })
	if (auction === zeroAddress) throw new Error('Truth auction was not created')
	const engine = await owner.readContract({ abi: auctionArtifact.abi, address: auction, functionName: 'engine' })
	const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'capitalLedger', args: [child] })
	const index = await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'commitmentIndex' })
	await writeContractAndWait(owner, () => owner.writeContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'preparePortfolioPriceFeed', args: [fixture.poolFor(fixture.base.questionId).securityPool, child] }))
	const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [child] })
	await addRepToMigrationBalance(owner, source, 200n * unit)
	await splitMigrationRep(owner, source, 200n * unit, [1])
	const token = getRepTokenAddress(child)
	await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'transfer', args: [other.account.address, 100n * unit] }))
	const weth = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'weth' })
	await wrapWeth(owner, 100n * unit)
	await approveToken(owner, weth, feed)
	await approveToken(owner, token, feed)
	for (const bidder of [owner, other]) await approveToken(bidder, token, auction)
	const deadline = forkTime + 63n * DAY
	const report = async (price = unit, budget = 10n * unit) => {
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [price, budget, bounty], value: bounty }))
		const id = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		await mock.advanceTime(481n)
		await openOracleSettle(owner, id)
		if ((await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'reportOutcome', args: [id] })) !== 1n) throw new Error('Truth auction price report was not accepted')
	}
	const open = () => writeContractAndWait(owner, () => owner.writeContract({ abi: auctionArtifact.abi, address: auction, functionName: 'open' }))
	const bid = async (bidder: WriteClient, lots: bigint, price = (15n * unit) / 10n, health = 12_000n) => {
		const reserve = await bidder.readContract({ abi: auctionArtifact.abi, address: auction, functionName: 'minimumExecutionReservePerLot' })
		const id = (await bidder.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bidCount' })) + 1n
		await writeContractAndWait(bidder, () => bidder.writeContract({ abi: auctionArtifact.abi, address: auction, functionName: 'submitBid', args: [lots, price, health, reserve], value: lots * (unit + reserve) }))
		const [, vault] = await bidder.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bids', args: [id] })
		return { id, vault, reserve }
	}
	const closingQuote = async (price = unit) => {
		await mock.setTime(deadline - 1_000n)
		await report(price)
	}
	const finalize = async (at = deadline) => {
		await mock.setTime(at)
		return writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: forks, functionName: 'finalizeBranch', args: [child] }))
	}
	const balance = (recipient: Address, asset = token) => owner.readContract({ abi: tokenArtifact.abi, address: asset, functionName: 'balanceOf', args: [recipient] })
	return { owner, other, mock, source, child, forks, auction, engine, capital, index, feed, token, deadline, report, open, bid, closingQuote, finalize, balance }
}
