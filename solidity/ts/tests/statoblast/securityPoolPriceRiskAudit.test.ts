import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact } from '../../types/contractArtifact'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

// Executable audit boundaries, not assertions that the oracle is truthful.
// These cases deliberately settle undisputed wrong prices through the real feed.
// They prevent the backing-preserving repair change being mistaken for a fix
// to #1344's separate withdrawal and auction-allocation risks.
describe('Statoblast: remaining accepted-price assumptions (#1344)', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })

	test('an undisputed wrong-low price still permits a withdrawal that the fair quote blocks', async () => {
		await fixture.prepare(400n * unit, 100n * unit)
		await fixture.mint(100n * unit)
		const owner = fixture.owner()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const withdraw = () => writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'withdrawPrincipal', args: [340n * unit, owner.account.address] }))
		await expect(withdraw()).rejects.toThrow('Owner collateral too low')
		await fixture.refreshPrice(fixture.base.questionId, unit / 4n)
		await withdraw()
		expect((await owner.readContract({ ...capital, functionName: 'ownerCollateral', args: [owner.account.address] }))[0]).toBe(60n * unit)
		await fixture.refreshPrice(fixture.base.questionId, unit)
		expect((await owner.readContract({ ...capital, functionName: 'totals' }))[2]).toBe(0n)
	})

	test('an undisputed wrong-high closing price still increases a winning bid’s REP allocation', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
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
