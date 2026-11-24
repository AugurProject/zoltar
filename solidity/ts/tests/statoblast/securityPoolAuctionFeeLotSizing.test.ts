import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolSettlement_SecurityPoolSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
} from '../../types/contractArtifact'
import { burnedCollateralBalance, collateralBalance } from './burnEvidence'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: repair auction lots under a holding fee', () => {
	// The default fixture charges a 10% annual holding fee, so the branch deficit
	// is an attoETH-precision amount rather than a whole number of minimum commitments.
	const fixture = useSecurityPoolFixture()

	test('#1551 a fee-accrued deficit is sold in minimum-size lots and finalizes with exact conservation', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture, 150n * unit)
		const auction = { abi: auctionArtifact.abi, address: context.auction }
		const read = context.owner.readContract
		const shortfall = await read({ ...auction, functionName: 'shortfallAttoEth' })
		expect(shortfall % unit).not.toBe(0n)
		const lots = await read({ ...auction, functionName: 'targetLots' })
		const lot = await read({ ...auction, functionName: 'lotAttoEth' })
		expect(lots).toBe(shortfall / unit)
		expect(lot).toBe((shortfall + lots - 1n) / lots)
		expect(lots * lot - shortfall).toBeLessThan(lots)

		await context.report(unit, 100n * unit)
		await context.open()
		expect(await read({ ...auction, functionName: 'targetLots' })).toBe(lots)
		const grid = await read({ ...auction, functionName: 'repGrid' })
		const price = 6n * unit - ((6n * unit) % grid)
		const ownerLots = lots / 3n
		const firstOtherLots = lots / 4n
		const secondOtherLots = lots - ownerLots - firstOtherLots
		const bids = [await context.bid(context.owner, ownerLots, price), await context.bid(context.other, firstOtherLots, price), await context.bid(context.other, secondOtherLots, price)]
		await context.closingQuote()

		const forksBefore = await collateralBalance(context.owner, fixture.securityPool, context.forks)
		const burnedBefore = await burnedCollateralBalance(context.owner, fixture.securityPool)
		const inventory = await read({ ...auction, functionName: 'inventoryAttoRep' })
		const capitalRepBefore = await context.balance(context.capital)
		const forksRepBefore = await context.balance(context.forks)
		const settlement = await read({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'settlement' })
		const settlementRepBefore = await context.balance(settlement)
		expect(await context.balance(context.auction)).toBe(inventory)
		const book = await read({ abi: settlementArtifact.abi, address: settlement, functionName: 'ledger' })
		const parentBookId = await read({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.source] })
		const targetCash = await read({ abi: bookArtifact.abi, address: book, functionName: 'requiredForkCash', args: [parentBookId] })

		await context.finalize()

		const clearing = await read({ abi: engineArtifact.abi, address: context.engine, functionName: 'clearing' })
		const [, filledLots, raisedAttoEth, soldAttoRep] = clearing
		expect(filledLots).toBe(lots)
		expect(raisedAttoEth).toBe(lots * lot)
		const fills = await Promise.all(bids.map(bid => read({ abi: engineArtifact.abi, address: context.engine, functionName: 'previewBid', args: [bid.id] })))
		expect(fills.map(fill => fill.filledLots)).toEqual([ownerLots, firstOtherLots, secondOtherLots])
		expect(fills.reduce((sum, fill) => sum + fill.usedAttoEth, 0n)).toBe(raisedAttoEth)

		// Collateral: exactly the deficit reaches the child book; the sub-lot surplus is burned.
		const childBookId = await read({ abi: settlementArtifact.abi, address: settlement, functionName: 'bookIds', args: [context.child] })
		expect((await read({ abi: bookArtifact.abi, address: book, functionName: 'totals', args: [childBookId] }))[0]).toBe(targetCash)
		expect(await read({ abi: bookArtifact.abi, address: book, functionName: 'isCashFunded', args: [childBookId] })).toBe(true)
		expect(await read({ abi: capitalArtifact.abi, address: context.capital, functionName: 'demandAttoEth' })).toBe(targetCash)
		expect((await burnedCollateralBalance(context.owner, fixture.securityPool)) - burnedBefore).toBe(raisedAttoEth - shortfall)
		expect(await collateralBalance(context.owner, fixture.securityPool, context.forks)).toBe(forksBefore)
		expect(await collateralBalance(context.owner, fixture.securityPool, context.auction)).toBe(0n)
		expect(await collateralBalance(context.owner, fixture.securityPool, context.engine)).toBe(0n)

		// REP: sold inventory enters capital custody and the unsold rest joins the child's recovery REP.
		expect(await context.balance(context.auction)).toBe(0n)
		expect((await context.balance(context.capital)) - capitalRepBefore).toBe(soldAttoRep)
		const forksRepDelta = (await context.balance(context.forks)) - forksRepBefore
		const settlementRepDelta = (await context.balance(settlement)) - settlementRepBefore
		expect(forksRepDelta + settlementRepDelta + soldAttoRep).toBe(inventory)
		expect((await read({ abi: capitalArtifact.abi, address: context.capital, functionName: 'totals' }))[1]).toBeGreaterThanOrEqual(targetCash)
	})
})
