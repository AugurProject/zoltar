import { describe, expect, test } from 'bun:test'
import { keccak256 } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCapitalLifecycleDelegate_SecurityPoolCapitalLifecycleDelegate as lifecycleArtifact,
	statoblast_SecurityPoolCapitalAuctionDelegate_SecurityPoolCapitalAuctionDelegate as auctionArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolReportingRewards_SecurityPoolReportingRewards as rewardsArtifact,
} from '../../types/contractArtifact'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: production portfolio module deployment', () => {
	// The fixture measures every staged deployment receipt against Osaka's
	// transaction cap, including constructor-created module descendants.
	const fixture = useSecurityPoolPortfolioFixture()
	test('staged setup creates correctly bound lifecycle and reporting modules with runtime headroom', async () => {
		const client = fixture.owner()
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const services = await client.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		const lifecycle = await client.readContract({ ...capital, functionName: 'lifecycleDelegate' })
		const auction = await client.readContract({ ...capital, functionName: 'auctionDelegate' })
		const rewards = await client.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'reportingRewards' })
		expect(await client.readContract({ ...capital, functionName: 'portfolio' })).toBe(fixture.portfolio)
		expect(await client.readContract({ abi: lifecycleArtifact.abi, address: lifecycle, functionName: 'ledger' })).toBe(fixture.capitalLedger)
		expect(await client.readContract({ abi: auctionArtifact.abi, address: auction, functionName: 'ledger' })).toBe(fixture.capitalLedger)
		expect(await client.readContract({ abi: rewardsArtifact.abi, address: rewards, functionName: 'portfolio' })).toBe(fixture.portfolio)
		expect(await client.readContract({ abi: rewardsArtifact.abi, address: rewards, functionName: 'services' })).toBe(services)
		const observations = []
		for (const [name, address] of [
			['capital', fixture.capitalLedger],
			['services', services],
			['lifecycle', lifecycle],
			['auction', auction],
			['reportingRewards', rewards],
		] as const) {
			const code = await client.getCode({ address })
			if (code === undefined || code === '0x') throw new Error(`Production ${name} runtime missing`)
			const runtimeBytes = (code.length - 2) / 2
			expect(runtimeBytes).toBeLessThanOrEqual(24_576 - 1_024)
			observations.push({ name, address, runtimeBytes, runtimeHash: keccak256(code) })
		}
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ productionPortfolioModules: observations })
	})
})
