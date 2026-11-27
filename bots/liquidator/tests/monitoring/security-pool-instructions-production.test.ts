import { buildSecurityPoolInstructionRequest } from '../../src/execution/security-pool-instruction-request.ts'
import { describe, expect, test } from 'bun:test'
import { erc20Abi, zoltarAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { useSecurityPoolFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolFixture'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addRepToMigrationBalance, splitMigrationRep, getZoltarForkThreshold, forkUniverse, getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { loadSecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { SecurityPoolOpportunityExpired } from '../../src/execution/security-pool-executor.ts'
import { executeSecurityPoolInstruction } from '../../src/execution/security-pool-instructions.ts'
import { loadDurableState } from '../../src/state/operator-state.ts'
import { repairAuctionKeeper, repairAuctionTerms, prepareKeeperCollateralRepairAuction } from '../support/collateral-repair-auction.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'
import { loadSecurityPoolAuctionSnapshot, MAX_REPAIR_AUCTION_CLAIM_BATCH } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { securityPoolRepairAuctionAbi as auctionAbi } from '@zoltar/bot-shared/contracts/abi'

describe('explicit security pool instruction lifecycle', () => {
	const fixture = useSecurityPoolFixture()
	test('bids once across restart, counts pending exposure, claims the winning lots and manages the joined capital account', async () => {
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
		const bid = { ...base, id: 'one-bid', action: 'auction-bid' as const, lots: bidLots, minimumAttoRepPerLot: terms.minimumRepPerLot, maximumValueAttoEth: bidCollateral }
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
			// #1704 (also #1635): one auction's full inventory is already reserved, so another bid adds no REP exposure.
			const managed = pending.managedPrincipalAttoRep
			if (managed === undefined || pending.pendingAuction === undefined) throw new Error('Missing pending auction exposure')
			settings.securityPoolPolicy.maximumPrincipalAttoRep = managed
			const instructionContext = { client, settings, observation: pending, totalPrincipal: managed, blockNumber: pending.snapshot.blockNumber }
			expect(await buildSecurityPoolInstructionRequest(instructionContext, bid)).toHaveProperty('request')
			expect(await buildSecurityPoolInstructionRequest({ ...instructionContext, observation: { ...pending, pendingAuction: { ...pending.pendingAuction, address: account.address } } }, bid)).toMatchObject({ disposition: 'retry', reason: 'Auction award could exceed managed REP exposure limits' })
			settings.securityPoolPolicy.maximumPrincipalAttoRep = managed - 1n
			expect(await buildSecurityPoolInstructionRequest(instructionContext, bid)).toMatchObject({ disposition: 'retry', reason: 'Auction award could exceed managed REP exposure limits' })
			settings.securityPoolPolicy.maximumPrincipalAttoRep = 1_000_000n * unit

			expect(pending.managedPrincipalAttoRep).toBeGreaterThan(pending.snapshot.ownerPrincipalAttoRep)
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
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'claim', action: 'auction-claim', bidIds: [winner.id] }, async () => true)
			// #1709: a queued claim completed by another keeper is durably fulfilled.
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'already-claimed', action: 'auction-claim', bidIds: [winner.id] }, async () => true)).toBe(false)
			expect(state.completedSecurityPoolInstructions?.['already-claimed']).toBeDefined()
			// The winning lots joined the operator's own account; every later operation is a direct capital call.
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'health', action: 'capital-health', targetHealthFactorBps: 10_000n }, async () => true)
			const final = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			// The early-refunded losing bid stays unclaimed until someone claims it.
			expect(final.snapshot.unclaimedRepairAuctionBids).toBe(1n)
			expect(final.managedPrincipalAttoRep).toBe(final.snapshot.ownerPrincipalAttoRep)
			expect(final.snapshot.ownerCommitmentAttoEth).toBeGreaterThan(0n)
			expect(final.snapshot.ownerAccount.targetHealthFactorBps).toBe(10_000n)
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 11n * unit] }))
			const deposit = { ...base, id: 'deposit', action: 'capital-deposit' as const, amountAttoRep: 10n * unit, targetHealthFactorBps: 10_000n }
			await executeSecurityPoolInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedSecurityPoolInstructions?.['deposit']).toBeUndefined()
			expect(await client.readContract({ address: context.token, abi: erc20Abi, functionName: 'allowance', args: [account.address, context.capital] })).toBe(10n * unit)
			await executeSecurityPoolInstruction(wallet, settings, state, pool, deposit, async () => true)
			expect(state.completedSecurityPoolInstructions?.['deposit']).toBeDefined()
			const funded = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			expect(funded.snapshot.ownerPrincipalAttoRep).toBe(final.snapshot.ownerPrincipalAttoRep + 10n * unit)
			await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'withdraw', action: 'capital-withdraw', amountAttoRep: unit }, async () => true)
			expect(await client.readContract({ address: context.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBe(2n * unit)
			await expect(executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'invalid-child', action: 'fork-choice', outcome: 1n }, async () => true)).rejects.toThrow('Select and approve')
			await context.mock.advanceTime(2n * DAY)
			await context.report()
			const beforeEarnings = await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'earnings', action: 'capital-earnings' }, async () => true)).toBe(true)
			const earningsHash = state.activities.find(activity => activity.status === 'confirmed')?.hash
			if (earningsHash === undefined) throw new Error('Missing earnings transaction')
			const earningsReceipt = await client.getTransactionReceipt({ hash: earningsHash })
			if (earningsReceipt.effectiveGasPrice === undefined) throw new Error('Missing earnings gas price')
			expect(await client.readContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBeGreaterThan(beforeEarnings)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, { ...base, id: 'retire', action: 'capital-retire', commitmentAttoEth: unit }, async () => true)).toBe(true)
			const retired = await loadSecurityPoolObservation(client, settings, account.address, pending.nextScope, await client.getBlockNumber())
			expect(retired.snapshot.ownerCommitmentAttoEth).toBe(unit)
			const threshold = await getZoltarForkThreshold(context.owner, context.child)
			await addRepToMigrationBalance(context.owner, context.source, threshold)
			await splitMigrationRep(context.owner, context.source, threshold, [1])
			await context.mock.setTime(context.deadline + 8n * DAY)
			await forkUniverse(context.owner, context.child, fixture.base.questionId)
			const descendant = await context.owner.readContract({ address: getZoltarAddress(), abi: zoltarAbi, functionName: 'getChildUniverseId', args: [context.child, 1n] })
			settings.approvedUniverses.push(descendant)
			settings.selectedSecurityPools.push({ ...scope, universeId: descendant })
			const childToken = { address: getZoltarAddress(), abi: zoltarAbi, functionName: 'getRepToken', args: [descendant] } as const
			expect(await client.readContract(childToken)).toBe(zeroAddress)
			const choose = { ...base, id: 'choose', action: 'fork-choice' as const, outcome: 1n }
			// Unclaimed bids, losing ones included, block the export, so the choice first claims the remaining losing bid.
			const claimFirst = await buildSecurityPoolInstructionRequest({ client, settings, observation: retired, totalPrincipal: 0n, blockNumber: await client.getBlockNumber() }, choose)
			if (!('request' in claimFirst)) throw new Error('Fork choice did not claim the remaining bids first')
			expect(claimFirst.completes).toBe(false)
			expect(claimFirst.request.to).toBe(context.capital)
			expect(decodeFunctionData({ abi: capitalAbi, data: claimFirst.request.data })).toEqual({ functionName: 'materializeRepairAuctionBids', args: [[loser.id]] })
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, choose, async () => true)).toBe(true)
			expect(state.completedSecurityPoolInstructions?.['choose']).toBeUndefined()
			expect(await client.readContract({ address: context.capital, abi: capitalAbi, functionName: 'unclaimedRepairAuctionBids', args: [account.address] })).toBe(0n)
			expect(await client.readContract(childToken)).toBe(zeroAddress)
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, choose, async () => true)).toBe(true)
			expect(await client.readContract(childToken)).not.toBe(zeroAddress)
			expect([...(await client.readContract({ address: context.forks, abi: forkAbi, functionName: 'choices', args: [context.child, account.address] }))]).toEqual([1n, true])
			expect(Object.keys(state.completedSecurityPoolInstructions ?? {})).toEqual(['losing-bid', 'early-refund', 'one-bid', 'closed-auction-bid', 'claim', 'already-claimed', 'health', 'deposit', 'withdraw', 'earnings', 'retire', 'choose'])
		} finally {
			await stop()
		}
	}, 300_000)
	test('claims more bids than one block-sized batch over several runs and completes only with the last batch', async () => {
		const context = await prepareKeeperCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		const { account, reader: client, scope, settings, wallet } = repairAuctionKeeper(fixture, context)
		await context.mock.setBalance(account.address, 100n * unit)
		settings.strategy.maximumGasCostAttoEth = unit
		const { pool, state, stop } = await serveMockChainRpc(context.mock, settings, account.address, scope)
		const terms = await repairAuctionTerms(context)
		const count = MAX_REPAIR_AUCTION_CLAIM_BATCH + 1
		const base = { securityPool: fixture.securityPool, universeId: context.child }
		try {
			const collateral = BigInt(count) * terms.collateralPerLot
			await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: settings.deployment.weth, value: collateral }) })
			await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: settings.deployment.weth, abi: erc20Abi, functionName: 'approve', args: [context.auction, collateral] }) })
			// Each later bid asks for less REP, so earlier bids never exclude it; the book holds more bids than one claim batch.
			for (let index = 0; index < count; index++) await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: context.auction, abi: auctionAbi, functionName: 'submitBid', args: [1n, terms.repPerLot - BigInt(index) * terms.grid] }) })
			await context.closingQuote()
			await context.finalize()
			const bids = (await loadSecurityPoolAuctionSnapshot({ client, securityPool: fixture.securityPool, universeId: context.child, bidder: account.address, bidCount: 64 })).auction?.bids ?? []
			expect(bids).toHaveLength(count)
			const capital = (await loadSecurityPoolObservation(client, settings, account.address, scope, await client.getBlockNumber())).snapshot.capitalLedger
			const unclaimed = () => client.readContract({ address: capital, abi: capitalAbi, functionName: 'unclaimedRepairAuctionBids', args: [account.address] })
			const claim = { ...base, id: 'claim-many', action: 'auction-claim' as const, bidIds: bids.map(bid => bid.id) }
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, claim, async () => true)).toBe(true)
			// The first transaction carried one batch; the instruction stays open for the rest.
			expect(await unclaimed()).toBe(BigInt(count - MAX_REPAIR_AUCTION_CLAIM_BATCH))
			expect(state.completedSecurityPoolInstructions?.[claim.id]).toBeUndefined()
			expect(await executeSecurityPoolInstruction(wallet, settings, state, pool, claim, async () => true)).toBe(true)
			expect(await unclaimed()).toBe(0n)
			expect(state.completedSecurityPoolInstructions?.[claim.id]).toBeDefined()
		} finally {
			await stop()
		}
	})
})
