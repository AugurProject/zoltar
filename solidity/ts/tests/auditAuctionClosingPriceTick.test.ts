import { describe, expect, test } from 'bun:test'
import { prepareSecurityPoolCollateralRepairAuction } from './statoblast/securityPoolCollateralRepairAuctionFixture'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
} from '../types/contractArtifact'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Audit regression: the whole collateral repair auction used to be cancelled when the last
// report accepted before the fixed close was even one price unit above the price cached by the
// one-shot, permissionless open(). One ordinary, undisputable report voided every funded bid
// and left the branch impaired for good. A higher closing price now only raises the REP every
// winning lot must receive to what backs it at that price.
describe('audit: a higher closing price no longer cancels the collateral repair auction', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('a closing report one unit above the opening price still fills every funded lot', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report(unit)
		await context.open()
		const opening = await context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'openingConservativePrice' })
		// Bidders fund the complete shortfall (5 lots of 1 collateral unit).
		const bid = await context.bid(context.other, 5n)
		await context.closingQuote(unit + 1n)
		const closing = await context.owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'conservativePrice' })
		expect(closing).toBeGreaterThan(opening)
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(5n)
		expect(fill.refundAttoEth).toBe(0n)
		// Every winning lot is backed at the closing price, on the auction's REP grid.
		const [capital, grid, lot] = await Promise.all([
			context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'capital' }),
			context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' }),
			context.owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'lotAttoEth' }),
		])
		const required = await context.owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requiredRep', args: [lot, 10_000n] })
		const repPerLot = fill.principalAttoRep / fill.filledLots
		expect(repPerLot).toBeGreaterThanOrEqual(required)
		expect(repPerLot % grid).toBe(0n)
		// The branch is fully repaired.
		const settlement = await context.owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const book = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const bookId = await context.owner.readContract({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		const totals = await context.owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [bookId] })
		expect(totals[0]).toBe(10n * unit)
		expect(totals[1]).toBe(10n * unit)
	})

	test('the same bids with an unchanged closing price repair the branch', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report(unit)
		await context.open()
		const bid = await context.bid(context.other, 5n)
		await context.closingQuote(unit)
		await context.finalize()
		const fill = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })
		expect(fill.filledLots).toBe(5n)
	})
})
