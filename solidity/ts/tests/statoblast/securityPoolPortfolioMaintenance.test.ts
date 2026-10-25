import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { getPendingReportId, getRequestPriceCostAttoEth, openOracleSettleWithGasPrice, requestPriceWithValue, balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'

const maximumReward = 10n ** 12n

describe('Statoblast: purpose-bound oracle maintenance rewards', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n, serviceFeeBps: 10_000n, maximumOracleRewardAttoEth: maximumReward })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const services = async () => ({ abi: servicesArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'services' }) })
	const reserve = async (universe = fixture.base.genesisUniverse) => fixture.owner().readContract({ ...(await services()), functionName: 'maintenanceReserveAttoEth', args: [universe] })
	const credit = async (sender = fixture.owner()) => sender.readContract({ ...(await services()), functionName: 'pullCreditsAttoEth', args: [sender.account.address] })
	const feed = async () => ({ abi: feedArtifact.abi, address: await fixture.owner().readContract({ ...portfolio(), functionName: 'priceFeed', args: [fixture.base.genesisUniverse] }) })
	const request = async (sender: WriteClient, question = fixture.base.questionId) => {
		const coordinator = fixture.poolFor(question).openOraclePriceCoordinator
		await requestPriceWithValue(sender, coordinator, await getRequestPriceCostAttoEth(sender, coordinator), unit)
		return getPendingReportId(sender, coordinator)
	}
	const prepare = async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		expect(await reserve()).toBeGreaterThan(maximumReward)
	}
	test('an accepted useful report credits its sponsor within the cap and pays only on a separate pull claim', async () => {
		await prepare()
		const sponsor = fixture.other()
		const before = await reserve()
		const reportId = await request(sponsor)
		expect(await credit(sponsor)).toBe(0n)
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettleWithGasPrice(fixture.owner(), reportId, 1_000_000_000n)
		expect(await fixture.owner().readContract({ ...(await feed()), functionName: 'reportOutcome', args: [reportId] })).toBe(1n)
		expect(await credit(sponsor)).toBe(maximumReward)
		expect(await credit()).toBe(0n)
		expect(await reserve()).toBe(before - maximumReward)
		const receiver = fixture.owner().account.address
		const balance = await fixture.owner().getBalance({ address: receiver })
		await writeContractAndWait(sponsor, async () => sponsor.writeContract({ ...(await services()), functionName: 'claimServiceCredit', args: [receiver] }))
		expect(await fixture.owner().getBalance({ address: receiver })).toBe(balance + maximumReward)
		expect(await credit(sponsor)).toBe(0n)
		expect(await fixture.owner().readContract({ ...(await services()), functionName: 'totalPullCreditsAttoEth' })).toBe(0n)
	})
	test.each([0n, 480n])('concurrent candidates cannot collect twice, even when an old candidate settles later (%s seconds)', async delay => {
		await prepare()
		const first = await request(fixture.owner())
		const second = await request(fixture.other(), fixture.secondQuestionId)
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettleWithGasPrice(fixture.owner(), first, 1_000_000_000n)
		const afterFirst = await reserve()
		if (delay !== 0n) await fixture.base.mockWindow.advanceTime(delay)
		await openOracleSettleWithGasPrice(fixture.other(), second, 1_000_000_000n)
		expect(await fixture.owner().readContract({ ...(await feed()), functionName: 'reportOutcome', args: [second] })).toBe(1n)
		expect(await credit()).toBe(maximumReward)
		expect(await credit(fixture.other())).toBe(0n)
		expect(await reserve()).toBe(afterFirst)
		const next = await request(fixture.other())
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettleWithGasPrice(fixture.other(), next, 1_000_000_000n)
		expect(await credit(fixture.other())).toBe(maximumReward)
	})
	test('a rejected stale report gets no reward and cannot consume the maintenance reserve', async () => {
		await prepare()
		const before = await reserve()
		const reportId = await request(fixture.other())
		await fixture.base.mockWindow.advanceTime(1_300n)
		await openOracleSettleWithGasPrice(fixture.owner(), reportId, 1_000_000_000n)
		expect(await fixture.owner().readContract({ ...(await feed()), functionName: 'reportOutcome', args: [reportId] })).toBe(2n)
		expect(await credit(fixture.other())).toBe(0n)
		expect(await reserve()).toBe(before)
	})
	test('maintenance cannot pay arbitrary callers or subsidize another universe budget', async () => {
		await prepare()
		const sender = fixture.other()
		const now = (await sender.getBlock()).timestamp
		await expect(sender.writeContract({ ...portfolio(), functionName: 'rewardOracleReport', args: [fixture.base.genesisUniverse, sender.account.address, 1_000_000n, now] })).rejects.toThrow('Only canonical shared feed')
		await expect(sender.writeContract({ ...(await services()), functionName: 'rewardOracleReport', args: [fixture.base.genesisUniverse, sender.account.address, 1_000_000n, now] })).rejects.toThrow('Only service portfolio')
		expect(await sender.readContract({ ...(await services()), functionName: 'quoteOracleReward', args: [42n, 10n ** 20n, 10n ** 20n] })).toBe(0n)
		expect(await sender.readContract({ ...(await services()), functionName: 'quoteOracleReward', args: [fixture.base.genesisUniverse, 10n ** 20n, 10n ** 20n] })).toBe(maximumReward)
		const lowGasQuote = await sender.readContract({ ...(await services()), functionName: 'quoteOracleReward', args: [fixture.base.genesisUniverse, 1n, 1n] })
		expect(lowGasQuote).toBe(1n)
	})
	test('a funded universe with no underwriting or demand accepts prices without paying unnecessary service rewards', async () => {
		await prepare()
		const pool = fixture.poolFor(fixture.base.questionId)
		const shares = await balanceOfShares(fixture.other(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.securityPool, shares[0])
		const capital = { abi: capitalArtifact.abi, address: fixture.capitalLedger }
		const owner = await fixture.owner().readContract({ ...capital, functionName: 'ownerAccount', args: [fixture.owner().account.address] })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...capital, functionName: 'requestRetirement', args: [owner.positionId] }))
		expect((await fixture.owner().readContract({ ...capital, functionName: 'totals' }))[1]).toBe(0n)
		const before = await reserve()
		const reportId = await request(fixture.other())
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettleWithGasPrice(fixture.owner(), reportId, 1_000_000_000n)
		expect(await fixture.owner().readContract({ ...(await feed()), functionName: 'reportOutcome', args: [reportId] })).toBe(1n)
		expect(await credit(fixture.other())).toBe(0n)
		expect(await reserve()).toBe(before)
	})
})

describe('Statoblast: depleted oracle maintenance budget', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n, purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: 1n, serviceFeeBps: 10_000n })
	test('reimbursement is capped by actual funding and an empty reserve never blocks a fresh price', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const services = { abi: servicesArtifact.abi, address: await fixture.owner().readContract({ ...portfolio, functionName: 'services' }) }
		const universe = fixture.base.genesisUniverse
		expect(await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [universe] })).toBe(1n)
		for (let attempt = 0; attempt < 2; attempt++) {
			const coordinator = fixture.poolFor(fixture.base.questionId).openOraclePriceCoordinator
			await requestPriceWithValue(fixture.owner(), coordinator, await getRequestPriceCostAttoEth(fixture.owner(), coordinator), unit)
			const reportId = await getPendingReportId(fixture.owner(), coordinator)
			await fixture.base.mockWindow.advanceTime(481n)
			await openOracleSettleWithGasPrice(fixture.owner(), reportId, 1_000_000_000n)
			expect(await fixture.owner().readContract({ ...services, functionName: 'pullCreditsAttoEth', args: [fixture.owner().account.address] })).toBe(1n)
			expect(await fixture.owner().readContract({ ...services, functionName: 'maintenanceReserveAttoEth', args: [universe] })).toBe(0n)
			expect(await fixture.owner().readContract({ abi: capitalArtifact.abi, address: fixture.capitalLedger, functionName: 'isPriceValid' })).toBe(true)
		}
	})
})
