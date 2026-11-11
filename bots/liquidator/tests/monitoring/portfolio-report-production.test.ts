import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, privateKeyToAccount, encodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolCapitalLedgerAbi, erc20Abi, openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { TEST_ADDRESSES } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { executePortfolioTakeover } from '../../src/execution/portfolio-executor.ts'
import { executePendingPortfolioReport } from '../../src/execution/portfolio-report.ts'
import { reconcileSponsoredReports } from '../../src/execution/sponsored-report-recovery.ts'
import { unusedPortfolioFunding } from '../../src/execution/portfolio-unused-funding.ts'
import { loadDurableState } from '../../src/state/operator-state.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

describe('liquidator sponsored report integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test.each([
		{ targets: 1, healFirst: false, external: false, expire: false, callbackFailure: false },
		{ targets: 2, healFirst: false, external: false, expire: false, callbackFailure: false },
		{ targets: 2, healFirst: true, external: false, expire: false, callbackFailure: false },
		{ targets: 2, healFirst: false, external: true, expire: false, callbackFailure: false },
		{ targets: 2, healFirst: true, external: true, expire: false, callbackFailure: false },
		{ targets: 2, healFirst: false, external: true, expire: true, callbackFailure: false },
		{ targets: 2, healFirst: false, external: true, expire: false, callbackFailure: true },
	])('settles a batch with %s, preserving later funding after failure', async ({ targets, healFirst, external, expire, callbackFailure }) => {
		await fixture.prepare(700n * unit, 100n * unit)
		if (targets === 2) {
			const third = createWriteClient(fixture.base.mockWindow, TEST_ADDRESSES[2])
			const rep = await fixture.owner().readContract({ address: fixture.capitalLedger, abi: securityPoolCapitalLedgerAbi, functionName: 'repToken' })
			await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: erc20Abi, address: rep, functionName: 'transfer', args: [third.account.address, 700n * unit] }))
			await fixture.deposit(700n * unit, third)
			await fixture.authorize(100n * unit, third)
		}
		await fixture.mint(BigInt(targets) * 100n * unit)
		await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		await fixture.base.mockWindow.setBalance(account.address, 100n * unit)
		const reader = createPublicClient({ chain: mainnet, transport: custom(fixture.base.mockWindow) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(fixture.base.mockWindow) })
		await fixture.base.mockWindow.impersonateAccount(account.address)
		const keeper = createWriteClient(fixture.base.mockWindow, BigInt(account.address))
		const capital = { address: fixture.capitalLedger, abi: securityPoolCapitalLedgerAbi }
		const rep = await reader.readContract({ ...capital, functionName: 'repToken' })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ address: rep, abi: erc20Abi, functionName: 'transfer', args: [account.address, 10_000n * unit] }))
		await writeContractAndWait(keeper, () => keeper.writeContract({ ...capital, functionName: 'setHealthTarget', args: [15_000n] }))
		const settings = portfolioSettings()
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		const scope = { address: fixture.portfolio, universeId: fixture.base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [scope.universeId]
		settings.portfolioPolicy.maximumReportFundingAttoEth = 10n * unit
		settings.portfolioPolicy.reportOperationsGasLimit = targets * 3_100_000
		settings.portfolioPolicy.maximumOwnFundingAttoRep = 2000n * unit
		settings.portfolioPolicy.maximumPrincipalAttoRep = 20_000n * unit
		settings.portfolioPolicy.maximumTotalPrincipalAttoRep = 30_000n * unit
		settings.strategy.maximumGasCostAttoEth = unit / 10n
		const { pool, state, stop } = await serveMockChainRpc(fixture.base.mockWindow, settings, account.address, scope)
		const observe = async () => loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		try {
			const beforeFunding = await observe()
			const firstTarget = beforeFunding.positions.find(position => position.owner === fixture.owner().account.address)
			if (firstTarget === undefined) throw new Error('Source missing')
			settings.portfolioPolicy.maximumReportFundingAttoEth = unit / 100n
			await expect(executePortfolioTakeover(wallet, settings, state, pool, beforeFunding, firstTarget.id, async () => true)).rejects.toThrow('loss budget')
			expect(state.pendingTransactions).toHaveLength(0)
			expect((await observe()).snapshot.ownerPrincipalAttoRep).toBe(0n)
			settings.portfolioPolicy.maximumReportFundingAttoEth = 10n * unit
			settings.strategy.maximumGasCostAttoEth = 1n
			await expect(executePortfolioTakeover(wallet, settings, state, pool, beforeFunding, firstTarget.id, async () => true)).rejects.toThrow('settlement exceeds')
			expect((await observe()).snapshot.ownerPrincipalAttoRep).toBe(0n)
			settings.strategy.maximumGasCostAttoEth = unit / 10n
			for (let step = 0; step < 7; step++) {
				const observation = await observe()
				if (observation.pendingOperationReport !== undefined) break
				const source = observation.positions.find(position => position.owner === fixture.owner().account.address)
				if (source === undefined) throw new Error('Source missing')
				await executePortfolioTakeover(wallet, settings, state, pool, observation, source.id, async () => true)
			}
			const restarted = await observe()
			expect(restarted.pendingOperationReport).toBeDefined()
			expect(state.sponsoredReports).toHaveLength(1)
			expect(restarted.snapshot.priceValid).toBe(false)
			const transactions = state.activities.filter(activity => activity.status === 'confirmed').length
			expect(await executePendingPortfolioReport(wallet, settings, state, pool, restarted)).toBe('waiting')
			expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(transactions)
			settings.selectedPortfolios = []
			expect(await executePendingPortfolioReport(wallet, settings, state, pool, restarted)).toBe('waiting')
			expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(transactions)
			settings.selectedPortfolios = [scope]
			if (healFirst) await fixture.deposit(1000n * unit)
			await fixture.base.mockWindow.advanceTime(expire ? 900n : 481n)
			if (external) {
				const pending = restarted.pendingOperationReport
				if (pending === undefined) throw new Error('Missing sponsored report')
				await writeContractAndWait(fixture.owner(), () => fixture.owner().sendTransaction({ ...(callbackFailure ? { gas: 1_500_000n } : {}), to: pending.oracle, data: encodeFunctionData({ abi: openOracleAbi, functionName: 'settle', args: [pending.id, pending.game, [pending.id, ...pending.helper]] }) }))
				await reconcileSponsoredReports(wallet, settings, state, pool)
				expect(state.sponsoredReports).toHaveLength(1)
				expect(state.activities.some(activity => activity.message.startsWith('Settle sponsored takeover report:'))).toBe(false)
				const durable = await loadDurableState(settings.runtime.stateFile, 1)
				state.sponsoredReports = durable.sponsoredReports
				state.portfolioFunding = durable.portfolioFunding
				state.activities = durable.activities
				await fixture.base.mockWindow.request({ method: 'anvil_mine', params: ['0xc'] })
				await reconcileSponsoredReports(wallet, settings, state, pool)
				if (callbackFailure) {
					expect(state.sponsoredReports).toHaveLength(1)
					await executePendingPortfolioReport(wallet, settings, state, pool, await observe())
				}
				const count = state.activities.length
				await reconcileSponsoredReports(wallet, settings, state, pool)
				expect(state.activities).toHaveLength(count)
			} else await executePendingPortfolioReport(wallet, settings, state, pool, await observe())
			const completed = await observe()
			expect(completed.pendingOperationReport).toBeUndefined()
			expect(completed.snapshot.priceValid).toBe(!callbackFailure)
			const expectedSucceeded = expire || callbackFailure ? 0 : targets - Number(healFirst)
			expect(completed.snapshot.ownerCommitmentAttoEth).toBe(BigInt(expectedSucceeded) * 100n * unit)
			const outcome = state.activities.find(activity => activity.message.startsWith(callbackFailure ? 'Recover sponsored report after failed callback:' : 'Settle sponsored takeover report:') && activity.status !== 'pending')
			if (callbackFailure) expect(outcome?.message).toContain('no operation outcomes reported')
			else {
				expect(outcome?.message).toContain(`${expectedSucceeded} succeeded, ${targets - expectedSucceeded} failed`)
			}
			if (healFirst) expect(outcome?.message).toContain('1 failed; 2 succeeded')
			expect(state.sponsoredReports).toHaveLength(0)
			if (expire || callbackFailure) {
				expect(Object.values(state.portfolioFunding ?? {})[0]?.amount).toBeGreaterThan(0n)
				expect(unusedPortfolioFunding(state, completed).amount).toBeGreaterThan(0n)
			} else {
				expect(state.portfolioFunding).toEqual({})
				await fixture.deposit(10n * unit, keeper)
				expect(unusedPortfolioFunding(state, await observe()).amount).toBe(0n)
			}
		} finally {
			await stop()
		}
	})
})
