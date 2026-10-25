import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolioPurchase_SecurityPoolPortfolioPurchase as purchaseArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_tokens_ShareToken_ShareToken as shareArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getShareTokenSupplyAttoShares } from '../../testSupport/simulator/utils/contracts/securityPool'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: bound complete-set delivery', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('new purchases exclude donated outcomes and forced ETH, and minimum delivery failures revert all accounting', async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const { owner, other, base } = fixture
		const pool = fixture.poolFor(base.questionId)
		const helper = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'quoteHelper' })
		const ids = await Promise.all([0, 1, 2].map(outcome => owner().readContract({ abi: shareArtifact.abi, address: pool.shareToken, functionName: 'getTokenId', args: [base.genesisUniverse, outcome] })))
		await writeContractAndWait(other(), () => other().writeContract({ abi: shareArtifact.abi, address: pool.shareToken, functionName: 'safeBatchTransferFrom', args: [other().account.address, helper, ids, [unit, unit, unit], '0x'] }))
		await base.mockWindow.setBalance(helper, 7n)
		await expect(other().writeContract({ abi: purchaseArtifact.abi, address: helper, functionName: 'mintCompleteSets', args: [pool.securityPool, other().account.address, 0n], value: unit })).rejects.toThrow('Only portfolio')
		await expect(other().writeContract({ abi: purchaseArtifact.abi, address: helper, functionName: 'deliverCompleteSets', args: [pool.securityPool, other().account.address, unit] })).rejects.toThrow('Only portfolio')
		const supply = await getShareTokenSupplyAttoShares(owner(), pool.securityPool)
		await expect(fixture.mint(20n * unit, base.questionId, { minimumShares: 21n * unit })).rejects.toThrow('Minimum shares not met')
		expect(await getShareTokenSupplyAttoShares(owner(), pool.securityPool)).toBe(supply)
		await fixture.mint(20n * unit, base.questionId, { minimumShares: 20n * unit })
		const delivered = (await getShareTokenSupplyAttoShares(owner(), pool.securityPool)) - unit
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, other().account.address)).toEqual([delivered, delivered, delivered])
		expect(await balanceOfShares(owner(), pool.shareToken, base.genesisUniverse, helper)).toEqual([unit, unit, unit])
		expect(await owner().getBalance({ address: helper })).toBe(7n)
	})
})
