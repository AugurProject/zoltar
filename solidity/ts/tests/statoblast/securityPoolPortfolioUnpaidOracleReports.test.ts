import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { getPendingReportId, getRequestPriceCostAttoEth, openOracleSettleWithGasPrice, requestPriceWithValue } from '../../testSupport/simulator/utils/contracts/statoblast'
import { receiptBurns } from './burnEvidence'

describe('Statoblast: oracle reports draw on no shared service budget', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const feed = async () => ({ abi: feedArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'priceFeed', args: [fixture.base.genesisUniverse] }) })
	const servicesCash = async () => fixture.owner().getBalance({ address: await fixture.owner().readContract({ ...portfolio(), functionName: 'services' }) })

	test.each([
		{ label: 'an accepted', delay: 481n, outcome: 1n },
		{ label: 'a rejected stale', delay: 1_300n, outcome: 2n },
	])('$label report pays its sponsor nothing and moves no service cash', async ({ delay, outcome }) => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const sponsor = fixture.other()
		const coordinator = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
		await requestPriceWithValue(sponsor, coordinator, await getRequestPriceCostAttoEth(sponsor, coordinator), unit)
		const reportId = await getPendingReportId(sponsor, coordinator)
		const serviceBefore = await servicesCash()
		await fixture.base.mockWindow.advanceTime(delay)
		const hash = await openOracleSettleWithGasPrice(fixture.owner(), reportId, 1_000_000_000n)
		expect(await fixture.owner().readContract({ ...(await feed()), functionName: 'reportOutcome', args: [reportId] })).toBe(outcome)
		if (outcome === 1n) expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'isPriceValid' })).toBe(true)
		// Sponsors fund their own reports: no service treasury pays or credits them.
		expect(await servicesCash()).toBe(serviceBefore)
		expect((await receiptBurns(fixture.owner(), hash)).serviceEth).toBe(0n)
	})
})
