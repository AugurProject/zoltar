import { describe, expect, test } from 'bun:test'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact } from '../../types/contractArtifact'
import { preparePortfolioCollateralRepairAuction } from './securityPoolPortfolioCollateralRepairAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: auction closing price assumption (#1344)', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test('an undisputed wrong-high closing price still increases a winning bid’s REP allocation', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const bid = await context.bid(context.other, 5n, 6n * unit)
		const saved = await context.mock.anvilSnapshot()
		await context.closingQuote()
		await context.finalize()
		const fair = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fair.principalAttoRep).toBe(30n * unit)
		await context.mock.anvilRevert(saved)
		await context.mock.setTime(context.deadline - 1000n)
		const reportStake = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [50n * unit] })
		await context.report(50n * unit, reportStake)
		await context.finalize()
		const wrong = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(wrong.usedAttoEth).toBe(fair.usedAttoEth)
		expect(wrong.filledLots).toBe(fair.filledLots)
		expect(wrong.principalAttoRep).toBeGreaterThan(fair.principalAttoRep)
	})
})
