import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact } from '../../types/contractArtifact'
import { preparePortfolioCollateralRepairAuction } from './securityPoolPortfolioCollateralRepairAuctionFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: auction closing price assumption (#1344)', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	test.each([unit, (285n * unit) / 100n])('a single higher quote cannot raise the uniform payout above the submitted bids (opening %s)', async opening => {
		const closing = opening === unit ? 10n * unit : (101n * opening) / 100n
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report(opening)
		await context.open()
		const bid = await context.bid(context.other, 5n, 6n * unit, 10_000n)
		await context.closingQuote(closing)
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(0n)
		expect(fill.principalAttoRep).toBe(0n)
		expect(fill.refundAttoEth).toBe(5n * unit)
	})
})
