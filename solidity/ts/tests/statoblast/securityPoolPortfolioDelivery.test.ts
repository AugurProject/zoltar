import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getShareTokenSupplyAttoShares, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: bound complete-set delivery', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('new purchases exclude donated outcomes and forced ETH, and minimum delivery failures revert all accounting', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const { owner, other, base } = fixture
		const pool = fixture.poolFor(base.questionId)
		const helper = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		const ids = await Promise.all([0, 1, 2].map(outcome => owner().readContract({ abi: shareArtifact.abi, address: pool.shareToken, functionName: 'getTokenId', args: [base.genesisUniverse, outcome] })))
		await writeContractAndWait(other(), () => other().writeContract({ abi: shareArtifact.abi, address: pool.shareToken, functionName: 'safeBatchTransferFrom', args: [other().account.address, helper, ids, [unit, unit, unit], '0x'] }))
		await base.mockWindow.setBalance(helper, (await owner().getBalance({ address: helper })) + 7n)
		await expect(other().writeContract({ abi: servicesArtifact.abi, address: helper, functionName: 'purchase', args: [other().account.address, base.genesisUniverse, base.questionId, unit, other().account.address, 0n], value: unit })).rejects.toThrow('Only service portfolio')
		const supply = await getShareTokenSupplyAttoShares(owner(), pool.securityPool)
		await expect(fixture.mint(20n * unit, base.questionId, { minimumShares: 21n * unit })).rejects.toThrow('Minimum shares not met')
		expect(await getShareTokenSupplyAttoShares(owner(), pool.securityPool)).toBe(supply)
		await fixture.mint(20n * unit, base.questionId, { minimumShares: 20n * unit })
		const delivered = (await getShareTokenSupplyAttoShares(owner(), pool.securityPool)) - unit
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, other().account.address)).toEqual([delivered, delivered, delivered])
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, helper)).toEqual([unit, unit, unit])
		const premiumLedger = await owner().readContract({ abi: servicesArtifact.abi, address: helper, functionName: 'premiumLedger' })
		const reservedPremium = await owner().readContract({ abi: premiumArtifact.abi, address: premiumLedger, functionName: 'totalCash' })
		expect(await owner().getBalance({ address: helper })).toBe(reservedPremium + 7n)
	})
})

describe('Statoblast: forced ETH cannot price or fund portfolio claims', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test.each([1n, 1_000n * unit])('bootstrap and a full return isolate %s forced attoETH in each custody layer', async surplus => {
		await fixture.prepare()
		const { owner, other, base } = fixture
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const pool = fixture.poolFor(base.questionId)
		const settlement = await owner().readContract({ ...portfolio, functionName: 'settlement' })
		const services = await owner().readContract({ ...portfolio, functionName: 'services' })
		for (const address of [pool.securityPool, settlement, services]) {
			await base.mockWindow.setBalance(address, (await owner().getBalance({ address })) + surplus)
		}
		expect(await getShareTokenSupplyAttoShares(owner(), pool.securityPool)).toBe(0n)
		await fixture.mint(10n * unit, base.questionId, { minimumShares: 10n * unit })
		expect(await getShareTokenSupplyAttoShares(owner(), pool.securityPool)).toBe(10n * unit)
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, other().account.address)).toEqual([10n * unit, 10n * unit, 10n * unit])
		expect(await owner().readContract({ ...portfolio, functionName: 'quoteQuestionSettlement', args: [pool.securityPool, 10n * unit] })).toBe(10n * unit)
		await redeemCompleteSet(other(), pool.securityPool, 10n * unit)
		expect(await getShareTokenSupplyAttoShares(owner(), pool.securityPool)).toBe(0n)
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, other().account.address)).toEqual([0n, 0n, 0n])
		for (const address of [pool.securityPool, settlement, services]) expect(await owner().getBalance({ address })).toBe(surplus)
	})
})
