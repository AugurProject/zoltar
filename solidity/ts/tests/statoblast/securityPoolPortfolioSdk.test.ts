import { describe, expect, test } from 'bun:test'
import {
	buildPortfolioCapitalDepositRequest,
	buildPortfolioCapitalAuthorizeRequest,
	buildPortfolioCapitalFundExecutionReserveRequest,
	buildPortfolioCapitalRequestRetirementRequest,
	buildPortfolioCapitalWithdrawPrincipalRequest,
	buildPortfolioMintRequest,
	loadPortfolioCapitalSnapshot,
	loadPortfolioMintQuote,
	requiredPortfolioExecutionReserve,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: central capital SDK against production contracts', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('snapshot and request builders preserve individual principal through authorize, mint, return and retirement', async () => {
		const client = fixture.owner()
		const owner = client.account.address
		const base = { owner, capitalLedger: fixture.capitalLedger }
		await approveToken(client, getRepTokenAddress(fixture.base.genesisUniverse), fixture.capitalLedger)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalDepositRequest({ ...base, amountAttoRep: 1_000n * unit })))
		await fixture.refreshPrice()
		const reserve = requiredPortfolioExecutionReserve({ ...portfolioEconomics, commitment: 100n * unit })
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalFundExecutionReserveRequest({ ...base, amountAttoEth: reserve })))
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalAuthorizeRequest({ ...base, commitment: 100n * unit })))
		const snapshot = await loadPortfolioCapitalSnapshot({ client, owner, portfolio: fixture.portfolio })
		expect(snapshot).toMatchObject({
			universeId: fixture.base.genesisUniverse,
			totalPledgedAttoRep: 1_000n * unit,
			totalCommitmentAttoEth: 100n * unit,
			ownerPrincipalAttoRep: 1_000n * unit,
			ownerCommitmentAttoEth: 100n * unit,
			withdrawableAttoRep: 789_473_684_210_526_315_600n,
			ownerConservativePrice: 1_052_631_578_947_368_422n,
			priceValid: true,
			economics: { auctionReserveFactorBps: portfolioEconomics.auctionReserveFactorBps },
		})
		await expect(writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: snapshot.withdrawableAttoRep + 1n })))).rejects.toThrow('Owner collateral too low')
		expect(snapshot.positions).toHaveLength(1)
		const position = snapshot.positions[0]
		if (position === undefined) throw new Error('SDK position missing')
		expect(position).toMatchObject({ owner, rep: 1_000n * unit, commitment: 100n * unit, executionReserveAttoEth: reserve })
		const quote = await loadPortfolioMintQuote({ client, portfolio: fixture.portfolio, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId, mintAttoEth: 10n * unit })
		expect(quote.availableCommitmentAttoEth).toBe(100n * unit)
		await writeContractAndWait(client, () =>
			client.sendTransaction(buildPortfolioMintRequest({ trader: owner, portfolio: fixture.portfolio, universeId: fixture.base.genesisUniverse, questionId: fixture.base.questionId, mintAttoEth: 10n * unit, recipient: owner, minimumShares: quote.shares, maximumPurchaseFeeAttoEth: quote.maximumPurchaseFeeAttoEth })),
		)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalRequestRetirementRequest({ ...base, positionId: position.id, remainingCommitment: 0n })))
		const pool = fixture.poolFor(fixture.base.questionId)
		const balances = await balanceOfShares(client, pool.shareToken, fixture.base.genesisUniverse, owner)
		await redeemCompleteSet(client, pool.securityPool, balances[0])
		const completed = await loadPortfolioCapitalSnapshot({ client, owner, portfolio: fixture.portfolio })
		expect(completed.withdrawableAttoRep).toBe(1_000n * unit)
		await writeContractAndWait(client, () => client.sendTransaction(buildPortfolioCapitalWithdrawPrincipalRequest({ ...base, amountAttoRep: completed.withdrawableAttoRep })))
		expect((await loadPortfolioCapitalSnapshot({ client, owner, portfolio: fixture.portfolio })).withdrawableAttoRep).toBe(0n)
	})
})
