import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolioQuote_SecurityPoolPortfolioQuote as quoteArtifact, statoblast_tokens_ShareToken_ShareToken as shareArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getShareTokenSupplyAttoShares } from '../../testSupport/simulator/utils/contracts/securityPool'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: bound complete-set delivery helper', () => {
	const { fixture, deposit, mint, assets } = useAggregatePortfolioFixture()

	test('only the bound portfolio can mint and delivery excludes donated tokens and forced ETH', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		const helper = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'quoteHelper' })
		expect(await fixture.owner().readContract({ abi: quoteArtifact.abi, address: helper, functionName: 'portfolio' })).toBe(fixture.portfolio)
		const token = fixture.base.securityPoolAddresses.shareToken
		const ids = await Promise.all([0, 1, 2].map(outcome => fixture.owner().readContract({ abi: shareArtifact.abi, address: token, functionName: 'getTokenId', args: [fixture.base.genesisUniverse, outcome] })))
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: shareArtifact.abi, address: token, functionName: 'safeBatchTransferFrom', args: [fixture.other().account.address, helper, ids, [unit, unit, unit], '0x'] }))
		await fixture.base.mockWindow.setBalance(helper, 7n)
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: quoteArtifact.abi, address: helper, functionName: 'buyCompleteSets', args: [fixture.base.securityPoolAddresses.securityPool, fixture.other().account.address, 0n], value: unit }))).rejects.toThrow('Only portfolio')
		expect(await balanceOfShares(fixture.owner(), token, fixture.base.genesisUniverse, helper)).toEqual([unit, unit, unit])
		expect(await fixture.owner().getBalance({ address: helper })).toBe(7n)
		const idle = await assets()
		await expect(mint(20n * unit, fixture.base.questionId, 10n * unit, 21n * unit)).rejects.toThrow('Minimum shares not met')
		expect(await assets()).toBe(idle)
		await mint(20n * unit, fixture.base.questionId, 10n * unit, 20n * unit)
		// Native time fees change the ETH/share exchange rate between purchases.
		const delivered = (await getShareTokenSupplyAttoShares(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)) - unit
		expect(await balanceOfShares(fixture.owner(), token, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([delivered, delivered, delivered])
		expect(await balanceOfShares(fixture.owner(), token, fixture.base.genesisUniverse, helper)).toEqual([unit, unit, unit])
		expect(await fixture.owner().getBalance({ address: helper })).toBe(7n)
	})
})
