import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolUniformPriceAuction_SecurityPoolUniformPriceAuction as engineArtifact } from '../../types/contractArtifact'
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
		await expect(context.open()).rejects.toThrow('Collateral repair auction opening too late')
	})
})

describe('collateral repair auction REP precision', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n, minimumCommitmentAttoEth: 1n })
	test('#1339 rejects lots whose backing is dominated by the REP grid', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await expect(context.open()).rejects.toThrow('Collateral repair auction lot below REP precision')
	})
})
