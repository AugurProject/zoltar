import { describe, expect, test } from 'bun:test'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { useSecurityPoolFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, splitMigrationRep, getZoltarForkThreshold, forkUniverse, getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { SecurityPoolOpportunityExpired } from '../../src/execution/security-pool-executor.ts'
import { executeSecurityPoolInstruction } from '../../src/execution/security-pool-instructions.ts'
import { loadDurableState } from '../../src/state/operator-state.ts'
import { repairAuctionKeeper, repairAuctionTerms, prepareKeeperCollateralRepairAuction } from '../support/collateral-repair-auction.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { loadSecurityPoolAuctionSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'

describe('explicit security pool instruction lifecycle', () => {
	const fixture = useSecurityPoolFixture()
	test('bids once across restart, counts pending exposure, activates and manages the winning vault', async () => {
		const context = await prepareKeeperCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const { account, reader: client, scope, settings, wallet } = repairAuctionKeeper(fixture, context)
		await context.mock.setBalance(account.address, 100n * unit)
		settings.securityPoolPolicy.maximumPrincipalAttoRep = 1_000_000n * unit
		settings.securityPoolPolicy.maximumTotalPrincipalAttoRep = 1_000_000n * unit
		settings.securityPoolPolicy.maximumCommitmentAttoEth = 1000n * unit
		settings.strategy.maximumGasCostAttoEth = unit
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope)
		const terms = await repairAuctionTerms(context)
		const bidLots = terms.lotCount > 2n ? 2n : 1n
		const bidCollateral = terms.collateralPerLot * bidLots
		const base = { securityPool: fixture.securityPool, universeId: context.child }
		const bid = { ...base, id: 'one-bid', action: 'auction-bid' as const, lots: bidLots, minimumAttoRepPerLot: terms.minimumRepPerLot, targetHealthFactorBps: 10_000n, maximumValueAttoEth: bidCollateral }
		try {
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, bid, async () => true)).rejects.toThrow('Insufficient wallet collateral for the bid')
			expect(state.completedSecurityPoolInstructions?.[bid.id]).toBeUndefined()
			await wallet.sendTransaction({ to: settings.deployment.weth, value: 10n * unit })
			const lowBid = { ...bid, id: 'losing-bid', minimumAttoRepPerLot: terms.repPerLot * 2n }
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, { ...lowBid, maximumValueAttoEth: bidCollateral - 1n }, async () => true)).rejects.toThrow('exceeds collateral or commitment limits')
			await wallet.writeContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'approve', args: [context.auction, 1n] })
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, lowBid, async () => true)).toBe(true)
			expect(state.completedSecurityPoolInstructions?.[lowBid.id]).toBeUndefined()
			expect(await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'allowance', args: [account.address, context.auction] })).toBe(0n)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, lowBid, async () => true)).toBe(true)
			expect(state.completedSecurityPoolInstructions?.[lowBid.id]).toBeUndefined()
			expect(await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'allowance', args: [account.address, context.auction] })).toBe(bidCollateral)

			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, lowBid, async () => true)).toBe(true)
			const lowAuction = await loadSecurityPoolAuctionSnapshot({ client, securityPool: fixture.securityPool, universeId: context.child, bidder: account.address })
			const loser = lowAuction.auction?.bids[0]
			if (loser === undefined) throw new Error('Missing losing bid')
			await context.bid(context.owner, terms.lotCount, terms.repPerLot)
			const beforeRefund = await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
			const refund = { ...base, id: 'early-refund', action: 'auction-refund' as const, bidId: loser.id }
			settings.strategy.maximumGasCostAttoEth = 1n
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, refund, async () => true)).rejects.toBeInstanceOf(SecurityPoolOpportunityExpired)
			expect(state.pendingTransactions).toHaveLength(0)
			expect(state.completedSecurityPoolInstructions?.[refund.id]).toBeUndefined()
			settings.strategy.maximumGasCostAttoEth = unit
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, refund, async () => true)).toBe(true)
			const refundHash = state.activities.find(activity => activity.status === 'confirmed')?.hash
			if (refundHash === undefined) throw new Error('Missing refund transaction')
			const receipt = await client.getTransactionReceipt({ hash: refundHash })
			if (receipt.effectiveGasPrice === undefined) throw new Error('Missing refund gas price')
			expect(await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBe(beforeRefund + bidCollateral)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, refund, async () => true)).toBe(false)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, bid, async () => true)).toBe(true)
			expect(state.completedSecurityPoolInstructions?.[bid.id]).toBeUndefined()
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, bid, async () => true)).toBe(true)
			const restored = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
			state.completedSecurityPoolInstructions = restored.completedSecurityPoolInstructions
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, bid, async () => true)).toBe(false)
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, { ...bid, lots: bidLots + 1n }, async () => true)).rejects.toThrow('cannot be reused')
			const pending = await loadSecurityPoolObservation(client, settings, account.address, scope, await client.getBlockNumber())
			expect(pending.managedPrincipalAttoRep).toBeGreaterThan(pending.snapshot.ownerPrincipalAttoRep)
			expect(pending.nextScope.managedVaults).toHaveLength(2)
			state.securityPoolScopes = [pending.nextScope]
			await context.closingQuote()
			await context.finalize()
			const closedBid = { ...bid, id: 'closed-auction-bid' }
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, closedBid, async () => true)).toBe(false)
			expect((await loadDurableState(settings.runtime.stateFile, settings.network.chainId)).completedSecurityPoolInstructions?.[closedBid.id]).toBeDefined()
			expect(state.activities[0]?.message).toContain('skipped')
			const auction = await loadSecurityPoolAuctionSnapshot({ client, securityPool: fixture.securityPool, universeId: context.child, bidder: account.address })
			const winner = auction.auction?.bids.find(candidate => candidate.id !== loser.id)
			if (winner === undefined) throw new Error('Missing operator bid')
			expect(winner.fill?.filledLots).toBeGreaterThan(0n)
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'activate', action: 'auction-activate', bidId: winner.id }, async () => true)
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'health', action: 'vault-health', vault: winner.vault, targetHealthFactorBps: 10_000n }, async () => true)
			const final = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			expect(final.ownedVaults?.find(vault => vault.owner === winner.vault)?.ownerCommitmentAttoEth).toBeGreaterThan(0n)
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 11n * unit] }))
			const deposit = { ...base, id: 'deposit', action: 'vault-deposit' as const, vault: winner.vault, amountAttoRep: 10n * unit, targetHealthFactorBps: 10_000n }
			await executeSecurityPoolInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedSecurityPoolInstructions?.['deposit']).toBeUndefined()
			await executeSecurityPoolInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedSecurityPoolInstructions?.['deposit']).toBeDefined()
			const funded = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			const fundedVault = funded.ownedVaults?.find(vault => vault.owner === winner.vault)
			expect(fundedVault?.ownerPrincipalAttoRep).toBe((final.ownedVaults?.find(vault => vault.owner === winner.vault)?.ownerPrincipalAttoRep ?? 0n) + 10n * unit)
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'withdraw', action: 'vault-withdraw', vault: winner.vault, amountAttoRep: unit }, async () => true)
			expect(await client.readContract({ address: context.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBe(2n * unit)
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'invalid-child', action: 'vault-fork-choice', vault: winner.vault, outcome: 1n }, async () => true)).rejects.toThrow('Select and approve')
			await context.mock.advanceTime(2n * DAY)
			await context.report()
			const beforeEarnings = await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'earnings', action: 'vault-earnings', vault: winner.vault }, async () => true)).toBe(true)
			const earningsHash = state.activities.find(activity => activity.status === 'confirmed')?.hash
			if (earningsHash === undefined) throw new Error('Missing earnings transaction')
			const earningsReceipt = await client.getTransactionReceipt({ hash: earningsHash })
			if (earningsReceipt.effectiveGasPrice === undefined) throw new Error('Missing earnings gas price')
			expect(await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBeGreaterThan(beforeEarnings)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'retire', action: 'vault-retire', vault: winner.vault, commitmentAttoEth: unit }, async () => true)).toBe(true)
			const retired = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
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
			settings.selectedSecurityPools.push({ ...scope, universeId: descendant })
			const choose = { ...base, id: 'choose', action: 'vault-fork-choice', vault: winner.vault, outcome: 1n } as const
			const childToken = { address: getZoltarAddress(), abi: zoltarAbi, functionName: 'getRepToken', args: [descendant] } as const
			expect(await client.readContract(childToken)).toBe(zeroAddress)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, choose, async () => true)).toBe(true)
			expect(await client.readContract(childToken)).not.toBe(zeroAddress)
			expect([...(await client.readContract({ address: context.forks, abi: forkAbi, functionName: 'choices', args: [context.child, winner.vault] }))]).toEqual([1n, true])
			state.securityPoolScopes.push({ ...scope, universeId: descendant, managedVaults: [winner.vault] })
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'direct-choice', action: 'fork-choice', outcome: 1n }, async () => true)).toBe(true)
			expect([...(await client.readContract({ address: context.forks, abi: forkAbi, functionName: 'choices', args: [context.child, account.address] }))]).toEqual([1n, true])
			expect(Object.keys(state.completedSecurityPoolInstructions ?? {})).toEqual(['losing-bid', 'early-refund', 'one-bid', 'closed-auction-bid', 'activate', 'health', 'deposit', 'withdraw', 'earnings', 'retire', 'choose', 'direct-choice'])
		} finally {
			await stop()
		}
	}, 300_000)
})
