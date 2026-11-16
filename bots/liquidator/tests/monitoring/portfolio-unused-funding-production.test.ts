import { describe, expect, test } from 'bun:test'
import { securityPoolCapitalLedgerAbi as capitalAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioCollateralRepairAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioCollateralRepairAuctionFixture'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioTarget } from '../../src/monitoring/portfolio-auction.ts'
import { executeUnusedPortfolioFunding, unusedPortfolioFunding } from '../../src/execution/portfolio-unused-funding.ts'
import { loadDurableState } from '../../src/state/operator-state.ts'
import { executePortfolioTakeover } from '../../src/execution/portfolio-executor.ts'
import { distressedSecondWinner, repairAuctionKeeper } from '../support/collateral-repair-auction.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

describe('portfolio abandoned funding integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('a restarted keeper returns only its journaled funding after the original target becomes healthy', async () => {
		const context = await preparePortfolioCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		// Set purchased collateral explicitly so the later price makes these
		// positions distressed, independently of the shared bidding helper default.
		await context.bid(context.owner, 2n, (35n * unit) / 10n)
		const second = await context.bid(context.other, 3n, (35n * unit) / 10n)
		await context.closingQuote()
		await context.finalize()
		const keeperOperator = repairAuctionKeeper(fixture, context)
		const { account, reader, scope, settings, wallet } = keeperOperator
		await context.mock.setBalance(account.address, 100n * unit)
		settings.portfolioPolicy.minimumNetRewardAttoEth = 0n
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope)
		try {
			const { keeper, next, winner } = await distressedSecondWinner(context, keeperOperator, second.id)
			for (let step = 0; step < 2; step++) {
				const before = state.activities.filter(activity => activity.status === 'confirmed').length
				await executePortfolioTakeover(wallet, settings, state, pool, next, portfolioTarget(winner), async () => true)
				expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(before + 1)
				const after = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [second.id] })
				expect(after.materialized).toBe(false)
			}
			const funded = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
			const journal = unusedPortfolioFunding(state, funded)
			expect(journal.amount).toBeGreaterThan(0n)
			const restored = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
			state.portfolioFunding = restored.portfolioFunding
			expect(unusedPortfolioFunding(state, funded)).toEqual(journal)
			await expect(executeUnusedPortfolioFunding(wallet, settings, state, pool, funded, async () => true)).rejects.toThrow('still viable')
			// An accepted lower REP/ETH quote heals the target before the keeper can acquire it.
			await context.report(unit)
			// Unrelated manual deposits are not part of the operator's funding journal.
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 5n * unit] }))
			await writeContractAndWait(keeper, () => keeper.writeContract({ address: context.token, abi: erc20Abi, functionName: 'approve', args: [context.capital, 5n * unit] }))
			await writeContractAndWait(keeper, () => keeper.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'depositFor', args: [account.address, 5n * unit] }))
			const walletBefore = await context.balance(account.address)
			expect(await executeUnusedPortfolioFunding(wallet, settings, state, pool, funded, async () => true)).toBe(true)
			expect(await context.balance(account.address)).toBe(walletBefore + journal.amount)
			const returned = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
			expect(unusedPortfolioFunding(state, returned).amount).toBe(0n)
			expect(returned.snapshot.ownerPrincipalAttoRep).toBe(5n * unit)
			expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [second.id] })).materialized).toBe(false)
			const persisted = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
			expect(persisted.portfolioFunding).toEqual({})
			expect(await executeUnusedPortfolioFunding(wallet, settings, state, pool, returned, async () => true)).toBe(false)
		} finally {
			await stop()
		}
	})
})
