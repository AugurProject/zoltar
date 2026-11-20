import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { preparePortfolioCollateralRepairAuction } from './securityPoolPortfolioCollateralRepairAuctionFixture'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('collateral repair auction safety bounds', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('#1363 an opening-week quote cannot authorize closing', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		await context.bid(context.owner, 1n)
		await context.finalize()
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'clearing' })
		expect(clearing.filledLots).toBe(0n)
		expect(clearing.soldAttoRep).toBe(0n)
	})

	test('#1331 opening cannot compress a week of bidding into its last seconds', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.mock.setTime(context.deadline - DAY + 1n)
		await context.report()
		await expect(context.open()).rejects.toThrow('Collateral repair auction requires one day of bidding')
	})
})

describe('collateral repair auction REP precision', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n, minimumCommitmentAttoEth: 1n })
	test('#1339 permits precise small lots while bounding rounding and covering the deficit', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		const auction = { abi: auctionArtifact.abi, address: context.auction }
		await context.open()
		const lot = await context.owner.readContract({ ...auction, functionName: 'lotAttoEth' })
		const lots = await context.owner.readContract({ ...auction, functionName: 'targetLots' })
		const shortfall = await context.owner.readContract({ ...auction, functionName: 'shortfallAttoEth' })
		const rounded = await context.owner.readContract({ ...auction, functionName: 'minimumCollateralAttoRepPerLot' })
		const price = await context.owner.readContract({ ...auction, functionName: 'openingConservativePrice' })
		const multiplier = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'securityMultiplierBps' })
		const required = await context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'requiredRep', args: [lot, price, multiplier, 10_000n] })
		expect(lots * lot).toBe(shortfall)
		expect(lots === 1n || (rounded - required) * 100n < required).toBe(true)
	})
})
