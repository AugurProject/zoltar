import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolPortfolioForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioTruthAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioTruthAuctionFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, splitMigrationRep, getZoltarForkThreshold, forkUniverse, getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { executePortfolioInstruction } from '../../src/execution/portfolio-instructions.ts'
import { loadDurableState } from '../../src/state/operator-state.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { loadPortfolioAuctionSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

describe('explicit portfolio instruction lifecycle', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('bids once across restart, counts pending exposure, activates and manages the winning vault', async () => {
		const context = await preparePortfolioTruthAuction(fixture)
		await context.report()
		await context.open()
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		await context.mock.setBalance(account.address, 100n * unit)
		const client = createPublicClient({ chain: mainnet, transport: custom(context.mock) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(context.mock) })
		const settings = portfolioSettings()
		const scope = { address: fixture.portfolio, universeId: context.child, nextPositionId: 1n, sweepEnd: 0n }
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		settings.deployment.multicall3 = getInfraContractAddresses().multicall3
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [context.child]
		settings.portfolioPolicy.maximumPrincipalAttoRep = 1_000_000n * unit
		settings.portfolioPolicy.maximumTotalPrincipalAttoRep = 1_000_000n * unit
		settings.portfolioPolicy.maximumCommitmentAttoEth = 1000n * unit
		settings.strategy.maximumGasCostAttoEth = unit
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope)
		const base = { portfolio: fixture.portfolio, universeId: context.child }
		const bid = { ...base, id: 'one-bid', action: 'auction-bid' as const, lots: 2n, minimumAttoRepPerLot: 5n * unit, targetHealthFactorBps: 10_000n, maximumValueAttoEth: 10n * unit }
		try {
			const lowBid = { ...bid, id: 'losing-bid', minimumAttoRepPerLot: 100n * unit }
			expect(await executePortfolioInstruction(wallet, settings, state, pool, lowBid, async () => true)).toBe(true)
			const lowAuction = await loadPortfolioAuctionSnapshot({ client, portfolio: fixture.portfolio, universeId: context.child, bidder: account.address })
			const loser = lowAuction.auction?.bids[0]
			if (loser === undefined) throw new Error('Missing losing bid')
			await context.bid(context.owner, 5n, 10n * unit)
			const beforeRefund = await client.getBalance({ address: account.address })
			const refund = { ...base, id: 'early-refund', action: 'auction-refund' as const, bidId: loser.id }
			expect(await executePortfolioInstruction(wallet, settings, state, pool, refund, async () => true)).toBe(true)
			const refundHash = state.activities.find(activity => activity.status === 'confirmed')?.hash
			if (refundHash === undefined) throw new Error('Missing refund transaction')
			const receipt = await client.getTransactionReceipt({ hash: refundHash })
			if (receipt.effectiveGasPrice === undefined) throw new Error('Missing refund gas price')
			expect(await client.getBalance({ address: account.address })).toBe(beforeRefund + 2n * unit - receipt.gasUsed * receipt.effectiveGasPrice)
			expect(await executePortfolioInstruction(wallet, settings, state, pool, refund, async () => true)).toBe(false)
			expect(await executePortfolioInstruction(wallet, settings, state, pool, bid, async () => true)).toBe(true)
			const restored = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
			state.completedPortfolioInstructions = restored.completedPortfolioInstructions
			expect(await executePortfolioInstruction(wallet, settings, state, pool, bid, async () => true)).toBe(false)
			await expect(executePortfolioInstruction(wallet, settings, state, pool, { ...bid, lots: 3n }, async () => true)).rejects.toThrow('cannot be reused')
			const pending = await loadPortfolioObservation(client, settings, account.address, scope, await client.getBlockNumber())
			expect(pending.managedPrincipalAttoRep).toBeGreaterThan(pending.snapshot.ownerPrincipalAttoRep)
			expect(pending.nextScope.managedVaults).toHaveLength(2)
			state.portfolioScopes = [pending.nextScope]
			await context.closingQuote()
			await context.finalize()
			const auction = await loadPortfolioAuctionSnapshot({ client, portfolio: fixture.portfolio, universeId: context.child, bidder: account.address })
			const winner = auction.auction?.bids.find(candidate => candidate.id !== loser.id)
			if (winner === undefined) throw new Error('Missing operator bid')
			expect(winner.fill?.filledLots).toBeGreaterThan(0n)
			await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'activate', action: 'auction-activate', bidId: winner.id }, async () => true)
			await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'health', action: 'vault-health', vault: winner.vault, targetHealthFactorBps: 10_000n }, async () => true)
			const final = await loadPortfolioObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			expect(final.ownedVaults?.find(vault => vault.owner === winner.vault)?.ownerCommitmentAttoEth).toBeGreaterThan(0n)
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 11n * unit] }))
			const deposit = { ...base, id: 'deposit', action: 'vault-deposit' as const, vault: winner.vault, amountAttoRep: 10n * unit, targetHealthFactorBps: 10_000n }
			await executePortfolioInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedPortfolioInstructions?.['deposit']).toBeUndefined()
			await executePortfolioInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedPortfolioInstructions?.['deposit']).toBeDefined()
			const funded = await loadPortfolioObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			const fundedVault = funded.ownedVaults?.find(vault => vault.owner === winner.vault)
			expect(fundedVault?.ownerPrincipalAttoRep).toBe((final.ownedVaults?.find(vault => vault.owner === winner.vault)?.ownerPrincipalAttoRep ?? 0n) + 10n * unit)
			await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'withdraw', action: 'vault-withdraw', vault: winner.vault, amountAttoRep: unit }, async () => true)
			expect(await client.readContract({ address: context.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBe(2n * unit)
			await expect(executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'invalid-child', action: 'vault-fork-choice', vault: winner.vault, outcome: 1n }, async () => true)).rejects.toThrow('Select and approve')
			await context.mock.advanceTime(2n * DAY)
			await context.report()
			const beforeEarnings = await client.getBalance({ address: account.address })
			expect(await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'earnings', action: 'vault-earnings', vault: winner.vault }, async () => true)).toBe(true)
			const earningsHash = state.activities.find(activity => activity.status === 'confirmed')?.hash
			if (earningsHash === undefined) throw new Error('Missing earnings transaction')
			const earningsReceipt = await client.getTransactionReceipt({ hash: earningsHash })
			if (earningsReceipt.effectiveGasPrice === undefined) throw new Error('Missing earnings gas price')
			expect((await client.getBalance({ address: account.address })) + earningsReceipt.gasUsed * earningsReceipt.effectiveGasPrice).toBeGreaterThan(beforeEarnings)
			expect(await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'retire', action: 'vault-retire', vault: winner.vault, commitmentAttoEth: unit }, async () => true)).toBe(true)
			const retired = await loadPortfolioObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			expect(retired.ownedVaults?.find(vault => vault.owner === winner.vault)?.ownerCommitmentAttoEth).toBe(unit)
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 10n * unit] }))
			await context.mock.impersonateAccount(account.address)
			const direct = createWriteClient(context.mock, BigInt(account.address))
			await writeContractAndWait(direct, () => direct.writeContract({ address: context.token, abi: erc20Abi, functionName: 'approve', args: [context.capital, 10n * unit] }))
			await writeContractAndWait(direct, () => direct.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'depositAndSetHealthTarget', args: [10n * unit, 10_000n] }))
			await writeContractAndWait(direct, () => direct.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'setCommitment', args: [unit] }))
			const threshold = await getZoltarForkThreshold(context.owner, context.child)
			await addRepToMigrationBalance(context.owner, context.source, threshold)
			await splitMigrationRep(context.owner, context.source, threshold, [1])
			await context.mock.setTime(context.deadline + 8n * DAY)
			await forkUniverse(context.owner, context.child, fixture.base.questionId)
			const descendant = await context.owner.readContract({ address: getZoltarAddress(), abi: zoltarAbi, functionName: 'getChildUniverseId', args: [context.child, 1n] })
			settings.approvedUniverses.push(descendant)
			settings.selectedPortfolios.push({ ...scope, universeId: descendant })
			expect(await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'choose', action: 'vault-fork-choice', vault: winner.vault, outcome: 1n }, async () => true)).toBe(true)
			expect([...(await client.readContract({ address: context.forks, abi: forkAbi, functionName: 'choices', args: [context.child, winner.vault] }))]).toEqual([1n, true])
			state.portfolioScopes.push({ ...scope, universeId: descendant, managedVaults: [winner.vault] })
			expect(await executePortfolioInstruction(wallet, settings, state, pool, { ...base, id: 'direct-choice', action: 'fork-choice', outcome: 1n }, async () => true)).toBe(true)
			expect([...(await client.readContract({ address: context.forks, abi: forkAbi, functionName: 'choices', args: [context.child, account.address] }))]).toEqual([1n, true])
			expect(Object.keys(state.completedPortfolioInstructions ?? {})).toEqual(['losing-bid', 'early-refund', 'one-bid', 'activate', 'health', 'deposit', 'withdraw', 'earnings', 'retire', 'choose', 'direct-choice'])
		} finally {
			await stop()
		}
	}, 300_000)
})
