import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_QuestionLedger_QuestionLedger as poolArtifact,
	statoblast_SecurityPoolRepairAuctionVault_SecurityPoolRepairAuctionVault as vaultArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { wrapWeth } from '../testSupport/simulator/utils/contracts/statoblast'
import { getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { BRANCH_GAS, createE2E, NO, OUTCOMES, WEEK, YES } from './auditE2EHarness'
import { prepareSecurityPoolCollateralRepairAuction } from './statoblast/securityPoolCollateralRepairAuctionFixture'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Scenario 4: a branch that not every provider chose is repaired by the collateral repair
// auction, its winners materialize their vaults lazily, and then that child universe forks.
describe('auditE2E: an auction-repaired child keeps winner rights and conserves assets across a second fork', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test('tie at the margin, higher closing price, lazy winners, second fork', async () => {
		const { base } = fixture
		const U0 = base.genesisUniverse
		const q1 = base.questionId
		const q2 = fixture.secondQuestionId
		const trader = fixture.other()
		// A second, still trading question keeps live claims through both forks.
		await fixture.prepare()
		await fixture.mint(10n * unit, q2)
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		const owner = context.owner
		const C = context.child
		const [loser, b3, b4, b5, forker] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		const coordinator = { abi: coordinatorArtifact.abi, address: context.forks }
		const capitalC = { abi: capitalArtifact.abi, address: context.capital }
		const engine = { abi: engineArtifact.abi, address: context.engine }
		const settlement = await e2e.settlement()
		const services = await e2e.services()
		const fork0 = await e2e.forkTime(U0)
		const cashOf = async (holders: Record<string, Address>) => Object.fromEntries(await Promise.all(Object.entries(holders).map(async ([name, holder]) => [name, await e2e.cash(holder)] as const)))
		const repOf = async (universe: bigint, holders: Record<string, Address>) => Object.fromEntries(await Promise.all(Object.entries(holders).map(async ([name, holder]) => [name, await e2e.rep(universe, holder)] as const)))
		const sum = (values: Record<string, bigint>) => Object.values(values).reduce((total, value) => total + value, 0n)

		const targetLots = await owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'targetLots' })
		const inventory = await owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'inventoryAttoRep' })
		expect(targetLots).toBe(10n)
		expect(inventory).toBe(1_000n * unit)
		expect(await e2e.rep(C, context.auction)).toBe(inventory)

		// ---- the auction ----
		await context.report(unit)
		await context.open()
		const opening = await owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'openingConservativePrice' })
		for (const bidder of [loser, b3, b4, b5]) await wrapWeth(bidder, 20n * unit)
		const wallets = { loser: loser.account.address, b3: b3.account.address, b4: b4.account.address, b5: b5.account.address }
		const cashBeforeBids = await cashOf(wallets)
		// The expensive bid arrives first; the three better bids then exclude it.
		const losing = await context.bid(loser, 2n, 100n * unit)
		const best = await context.bid(b3, 4n, 4n * unit)
		const tieA = await context.bid(b4, 3n, 6n * unit)
		const tieB = await context.bid(b5, 5n, 6n * unit)
		expect(await e2e.cash(context.engine)).toBe(14n * unit)
		// The excluded bid is refundable before the close; no better bid can be displaced by a worse one.
		expect(await owner.readContract({ ...engine, functionName: 'earlyRefundAttoEth', args: [losing.id] })).toBe(2n * unit)
		await writeContractAndWait(loser, () => loser.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [losing.id, loser.account.address] }))
		expect(await e2e.cash(loser.account.address)).toBe(cashBeforeBids['loser'] ?? 0n)
		await expect(loser.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'submitBid', args: [1n, 100n * unit, 12_000n] })).rejects.toThrow('Better bids already exclude this bid')

		// The closing report is three times the opening price: the REP floor per lot now exceeds every bid.
		await context.closingQuote(3n * unit)
		const closing = await owner.readContract({ abi: feedArtifact.abi, address: context.feed, functionName: 'conservativePrice' })
		expect(closing).toBeGreaterThan(opening)
		const supplyBeforeClose = await e2e.supply(C)
		await context.finalize()
		const clearing = await owner.readContract({ ...engine, functionName: 'clearing' })
		const [repPerLot, filledLots, raised, sold] = clearing
		const grid = await owner.readContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'repGrid' })
		const required = await owner.readContract({ ...capitalC, functionName: 'requiredRep', args: [unit, 10_000n] })
		expect(filledLots).toBe(10n)
		expect(raised).toBe(10n * unit)
		expect(repPerLot).toBeGreaterThan(6n * unit)
		expect(repPerLot).toBeGreaterThanOrEqual(required)
		expect(repPerLot - required).toBeLessThan(grid)
		expect(sold).toBe(10n * repPerLot)
		const fills = await Promise.all([losing, best, tieA, tieB].map(bid => owner.readContract({ ...engine, functionName: 'previewBid', args: [bid.id] })))
		// Four lots at the best price; equal limits fill in submission order, so the earlier tied bid fills first.
		expect(fills.map(fill => fill.filledLots)).toEqual([0n, 4n, 3n, 3n])
		expect(fills.map(fill => fill.refundAttoEth)).toEqual([2n * unit, 0n, 0n, 2n * unit])
		// The early refund was final: the excluded bid cannot be credited a second time after the close.
		await expect(loser.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [losing.id, loser.account.address] })).rejects.toThrow('Auction has no refund credit for this bidder')
		await expect(loser.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleRefund', args: [losing.id] })).rejects.toThrow('Auction bid has already been settled')
		for (const fill of fills) expect(fill.principalAttoRep).toBe(fill.filledLots * repPerLot)
		await expect(b4.simulateContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tieA.id, b4.account.address] })).rejects.toThrow('Auction has no refund credit for this bidder')
		await writeContractAndWait(b5, () => b5.writeContract({ abi: auctionArtifact.abi, address: context.auction, functionName: 'settleAndWithdrawRefund', args: [tieB.id, b5.account.address] }))
		const cashAfterAuction = await cashOf(wallets)
		expect([cashAfterAuction['loser'], cashAfterAuction['b3'], cashAfterAuction['b4'], cashAfterAuction['b5']]).toEqual([cashBeforeBids['loser'], (cashBeforeBids['b3'] ?? 0n) - 4n * unit, (cashBeforeBids['b4'] ?? 0n) - 3n * unit, (cashBeforeBids['b5'] ?? 0n) - 3n * unit])
		// Custody after the close: the engine and auction are empty, sold REP is in capital, the rest backs old claims.
		expect(await e2e.cash(context.engine)).toBe(0n)
		expect(await e2e.cash(context.forks)).toBe(0n)
		expect(await e2e.rep(C, context.auction)).toBe(0n)
		expect(await e2e.rep(C, context.engine)).toBe(0n)
		expect(await e2e.rep(C, context.forks)).toBe(0n)
		expect(await e2e.rep(C, context.capital)).toBe(2_000n * unit + sold)
		expect(await e2e.rep(C, settlement)).toBe(inventory - sold)
		expect(await e2e.supply(C)).toBe(supplyBeforeClose)
		// One settlement engine holds every universe: 20 sealed in the origin (10 assigned here, 10 still neutral) plus 10 raised.
		expect(await e2e.cash(settlement)).toBe(30n * unit)
		expect((await e2e.bookTotals(C))[0]).toBe(20n * unit)

		// ---- lazy materialization: a keeper materializes b3; b4 and b5 stay in the shared cohort ----
		await writeContractAndWait(forker, () => forker.writeContract({ ...capitalC, functionName: 'materializeRepairAuctionBid', args: [best.id] }))
		const position = (bidId: bigint) => owner.readContract({ ...capitalC, functionName: 'repairAuctionPosition', args: [bidId] })
		expect((await position(best.id)).materialized).toBe(true)
		expect((await position(tieA.id)).materialized).toBe(false)
		expect((await position(tieB.id)).materialized).toBe(false)
		const totalsC = await owner.readContract({ ...capitalC, functionName: 'totals' })
		expect(totalsC[0]).toBe(2_000n * unit + sold)
		expect(totalsC[1]).toBe(210n * unit)

		// The fork question itself is final in this child three days after activation; its holders redeem here.
		const pool1C = (await e2e.materialize(fixture.poolFor(q1).questionLedger, C)).pool
		await base.mockWindow.setTime(context.deadline + 3n * DAY + 1n)
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [YES], q1)
		const q1Quote = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionSettlement', args: [pool1C, 10n * unit] })

		// ---- the repaired child forks on an unrelated question ----
		await e2e.migrateWalletRep(forker, U0, 700_000n * unit, [YES])
		await base.mockWindow.setTime(fork0 + 10n * WEEK)
		await e2e.forkOn(forker, C, await e2e.unrelatedQuestion('auditE2E auction child: second fork'))
		await e2e.freeze(C, forker)
		const forkState = await owner.readContract({ ...coordinator, functionName: 'forks', args: [C] })
		const [backing, commitment, cash, , recoveryRep] = forkState
		// The snapshot counts the whole cohort, materialized or not.
		expect(backing).toBe(2_000n * unit + sold)
		expect(commitment).toBe(210n * unit)
		// Half of the unsold recovery REP belongs to the already final fork question and stays here.
		const q1RecoveryQuote = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionRecoveryRep', args: [pool1C, 10n * unit] })
		expect(recoveryRep + q1RecoveryQuote).toBeLessThanOrEqual(inventory - sold)
		expect(inventory - sold - recoveryRep - q1RecoveryQuote).toBeLessThanOrEqual(2n)

		// The finalized fork question pays in the forked child, with its share of the recovery REP.
		const q1Redeemed = await e2e.redeemShares(trader, pool1C)
		expect(q1Redeemed).toEqual({ cash: q1Quote, rep: q1RecoveryQuote })

		// ---- choices: owner and the unmaterialized b4 follow Yes, the materialized b3 follows No, b5 never acts ----
		await e2e.choose(owner, C, YES)
		const viaVault = (bidder: WriteClient, vault: Address, outcome: number) =>
			writeContractAndWait(bidder, () => bidder.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'execute', args: [coordinator.address, 0n, encodeFunctionData({ abi: coordinatorArtifact.abi, functionName: 'choose', args: [C, BigInt(outcome)] })], gas: BRANCH_GAS }))
		// The bidder's wallet holds nothing; only its vault owns the position.
		await expect(b4.simulateContract({ ...coordinator, functionName: 'choose', args: [C, BigInt(YES)] })).rejects.toThrow('No pledged fork principal')
		await viaVault(b4, tieA.vault, YES)
		expect((await position(tieA.id)).materialized).toBe(true)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'prepareBranch', args: [C, BigInt(NO)], gas: BRANCH_GAS }))
		await viaVault(b3, best.vault, NO)
		await expect(viaVault(b3, best.vault, YES)).rejects.toThrow()
		const G1 = getChildUniverseId(C, YES)
		const G2 = getChildUniverseId(C, NO)
		const branch = async (universe: bigint) => {
			const [, , chosenBacking, chosenCommitment, parentCash, branchRecovery] = await owner.readContract({ ...coordinator, functionName: 'branches', args: [universe] })
			return { chosenBacking, chosenCommitment, parentCash, branchRecovery }
		}
		expect(await branch(G1)).toMatchObject({ chosenBacking: 2_000n * unit + 3n * repPerLot, chosenCommitment: 203n * unit })
		expect(await branch(G2)).toMatchObject({ chosenBacking: 4n * repPerLot, chosenCommitment: 4n * unit })
		// After the choice window the idle winner can no longer choose.
		await e2e.startBranch(C, YES)
		await e2e.startBranch(C, NO)
		await expect(viaVault(b5, tieB.vault, YES)).rejects.toThrow('Fork choice window closed')
		await e2e.finalizeBranch(C, YES)
		await e2e.finalizeBranch(C, NO)
		const capitalG1 = await e2e.capital(G1)
		const capitalG2 = await e2e.capital(G2)
		const auctionG1 = await owner.readContract({ ...coordinator, functionName: 'repairAuctions', args: [G1] })
		const auctionG2 = await owner.readContract({ ...coordinator, functionName: 'repairAuctions', args: [G2] })
		const g1 = await branch(G1)
		const g2 = await branch(G2)
		// Every vault's principal arrived in the branch it chose, under the vault's own address.
		const collateralOf = async (capital: Address, holder: Address) => owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerCollateral', args: [holder] })
		expect((await collateralOf(capitalG1, tieA.vault)).slice(0, 2)).toEqual([3n * repPerLot, 3n * unit])
		expect((await collateralOf(capitalG2, best.vault)).slice(0, 2)).toEqual([4n * repPerLot, 4n * unit])
		expect((await collateralOf(capitalG1, owner.account.address)).slice(0, 2)).toEqual([2_000n * unit, 200n * unit])
		expect((await collateralOf(capitalG1, tieB.vault))[0]).toBe(0n)
		expect((await collateralOf(capitalG2, tieB.vault))[0]).toBe(0n)

		// ---- REP conservation per grandchild: chosen principal + recovery/auction inventory = snapshot backing + old recovery ----
		const repTable: Record<string, unknown>[] = []
		for (const [name, universe, capital, auction, state] of [
			['G1 (Yes)', G1, capitalG1, auctionG1, g1],
			['G2 (No)', G2, capitalG2, auctionG2, g2],
		] as const) {
			const held = await repOf(universe, { capital, settlement, coordinator: coordinator.address, auction, services })
			repTable.push({ branch: name, ...held, chosenBacking: state.chosenBacking, branchRecovery: state.branchRecovery })
			expect(held['capital']).toBe(state.chosenBacking)
			expect(held['coordinator']).toBe(0n)
			expect(sum(held)).toBe(backing + recoveryRep)
		}
		// The forked child keeps no pledged REP; its unvested or unclaimed REP fees stay claimable there.

		// ---- q2 claims follow origin -> C -> grandchildren ----
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [YES], q2)
		const pool2C = await e2e.poolOf(q2, C)
		// Migrating to several branches at once needs their question ledgers; anyone can prepare and activate them.
		const pools = { G1: (await e2e.materialize(pool2C, G1, trader)).pool, G2: (await e2e.materialize(pool2C, G2, trader)).pool }
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, C, outcome, [YES, NO], q2)
		const cashTable: Record<string, unknown>[] = []
		let q2Cash = 0n
		for (const [name, universe, pool] of [
			['G1 (Yes)', G1, pools.G1],
			['G2 (No)', G2, pools.G2],
		] as const) {
			for (const outcome of OUTCOMES) expect(await e2e.shareBalance(trader.account.address, universe, outcome, q2)).toBe(10n * unit)
			const quoteCash = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionSettlement', args: [pool, 10n * unit] })
			const quoteRep = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionRecoveryRep', args: [pool, 10n * unit] })
			const before = { cash: await e2e.cash(trader.account.address), rep: await e2e.rep(universe, trader.account.address) }
			await writeContractAndWait(trader, () => trader.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [10n * unit, 0n, 0n], gas: BRANCH_GAS }))
			const got = { cash: (await e2e.cash(trader.account.address)) - before.cash, rep: (await e2e.rep(universe, trader.account.address)) - before.rep }
			expect(got).toEqual({ cash: quoteCash, rep: quoteRep })
			q2Cash += got.cash
			cashTable.push({ branch: name, ...got, settlementRepLeft: await e2e.rep(universe, settlement) })
		}
		// Cash no provider carried into a branch is recovered at the source with complete sets.
		const before = await e2e.cash(trader.account.address)
		await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [C, q2, 10n * unit], gas: BRANCH_GAS }))
		const neutralC = (await e2e.cash(trader.account.address)) - before
		expect(g1.parentCash + g2.parentCash + neutralC).toBeLessThanOrEqual(cash)
		expect(cash - (g1.parentCash + g2.parentCash + neutralC)).toBeLessThanOrEqual(4n)
		expect(await e2e.shareBalance(trader.account.address, G1, YES, q2)).toBe(0n)
		expect(q2Cash).toBe(g1.parentCash + g2.parentCash)

		// ---- origin: the provider who never chose left half of the sealed cash neutral ----
		const capital0 = await e2e.capital(U0)
		const neutral: bigint[] = []
		for (const questionId of [q1, q2]) {
			const start = await e2e.cash(trader.account.address)
			await writeContractAndWait(trader, () => trader.writeContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [U0, questionId, 10n * unit], gas: BRANCH_GAS }))
			neutral.push((await e2e.cash(trader.account.address)) - start)
			await expect(trader.simulateContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [U0, questionId, 1n] })).rejects.toThrow()
		}
		expect(neutral).toEqual([5n * unit, 5n * unit])
		await expect(trader.simulateContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [C, q2, 1n] })).rejects.toThrow()
		// The finalized fork question had no live recovery right in the forked child.
		await expect(trader.simulateContract({ ...coordinator, functionName: 'recoverUnchosenCash', args: [C, q1, 1n] })).rejects.toThrow()
		const custody = await cashOf({ settlement, coordinator: coordinator.address, services, engine: context.engine, capitalC: context.capital, capitalG1, capitalG2 })
		// Settlement custody ends at the rounding dust of the three-way split.
		expect(custody['settlement']).toBe(cash - g1.parentCash - g2.parentCash - neutralC)
		expect(sum(custody)).toBeLessThanOrEqual(4n)

		// The origin's purchase-fee stream kept vesting for the providers who earned it and pays out completely.
		for (const claimant of [owner, trader]) await writeContractAndWait(claimant, () => claimant.writeContract({ abi: capitalArtifact.abi, address: capital0, functionName: 'claimEarnings', args: [claimant.account.address] }))
		expect(await e2e.cash(capital0)).toBe(0n)
		expect(await e2e.rep(U0, capital0)).toBe(0n)

		// ---- the winner who never acted: its lots stayed in the snapshot and now back the branches' claims ----
		expect((await position(tieB.id)).materialized).toBe(false)
		await writeContractAndWait(forker, () => forker.writeContract({ ...capitalC, functionName: 'materializeRepairAuctionBid', args: [tieB.id] }))
		expect((await position(tieB.id)).materialized).toBe(true)
		const idle = await collateralOf(context.capital, tieB.vault)
		expect(idle.slice(0, 2)).toEqual([3n * repPerLot, 3n * unit])
		const withdraw = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [1n, tieB.vault] })
		await expect(b5.simulateContract({ abi: vaultArtifact.abi, address: tieB.vault, functionName: 'execute', args: [context.capital, 0n, withdraw] })).rejects.toThrow()
		expect(await e2e.rep(C, context.capital)).toBe(0n)
	})

	test('an undersubscribed auction retains unpriced inventory while funded winners survive a second fork', async () => {
		const { base } = fixture
		const U0 = base.genesisUniverse
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		const owner = context.owner
		const C = context.child
		const [b3, b4, forker] = [e2e.account(3), e2e.account(4), e2e.account(6)]
		const coordinator = { abi: coordinatorArtifact.abi, address: context.forks }
		const capitalC = { abi: capitalArtifact.abi, address: context.capital }
		const engine = { abi: engineArtifact.abi, address: context.engine }
		const settlement = await e2e.settlement()
		const fork0 = await e2e.forkTime(U0)
		await context.report(unit)
		await context.open()
		for (const bidder of [b3, b4]) await wrapWeth(bidder, 20n * unit)
		// Three of five lots are funded: each buys the marginal price and the rest remains with claims.
		const first = await context.bid(b3, 1n, 4n * unit)
		const second = await context.bid(b4, 2n, 6n * unit)
		await context.closingQuote(unit)
		await context.finalize()
		const [repPerLot, filledLots, , sold] = await owner.readContract({ ...engine, functionName: 'clearing' })
		expect(filledLots).toBe(3n)
		expect(sold).toBe(3n * repPerLot)
		expect(await e2e.rep(C, context.capital)).toBe(1_000n * unit + sold)
		expect(await e2e.rep(C, settlement)).toBe(1_000n * unit - sold)
		// b3 materializes before the fork, b4 only afterwards.
		await writeContractAndWait(forker, () => forker.writeContract({ ...capitalC, functionName: 'materializeRepairAuctionBid', args: [first.id] }))
		await e2e.migrateWalletRep(forker, U0, 700_000n * unit, [YES])
		await base.mockWindow.setTime(fork0 + 10n * WEEK)
		await e2e.forkOn(forker, C, await e2e.unrelatedQuestion('auditE2E auction child: undersubscribed second fork'))
		await e2e.freeze(C, forker)
		const [backing] = await owner.readContract({ ...coordinator, functionName: 'forks', args: [C] })
		expect(backing).toBe(1_000n * unit + 3n * repPerLot)
		await e2e.choose(owner, C, YES)
		const execute = (bidder: WriteClient, vault: Address, target: Address, data: `0x${string}`) => writeContractAndWait(bidder, () => bidder.writeContract({ abi: vaultArtifact.abi, address: vault, functionName: 'executeAndSweep', args: [target, 0n, data, context.token, bidder.account.address], gas: BRANCH_GAS }))
		const choice = encodeFunctionData({ abi: coordinatorArtifact.abi, functionName: 'choose', args: [C, BigInt(YES)] })
		await execute(b4, second.vault, coordinator.address, choice)
		await execute(b3, first.vault, coordinator.address, choice)
		const G1 = await e2e.activateBranch(C, YES)
		const capitalG1 = await e2e.capital(G1)
		// Every purchased lot moved to the chosen branch; unsold REP remains reserved for claims.
		expect(await e2e.rep(G1, capitalG1)).toBe(backing)
		expect(await e2e.rep(C, context.capital)).toBe(0n)
		const claim = (vault: Address) => encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [vault] })
		const earned: bigint[] = []
		for (const [bidder, bid] of [
			[b3, first],
			[b4, second],
		] as const) {
			const before = await e2e.rep(C, bidder.account.address)
			await execute(bidder, bid.vault, context.capital, claim(bid.vault))
			earned.push((await e2e.rep(C, bidder.account.address)) - before)
		}
		// Retained inventory creates no winner earning, and no winner REP is stranded.
		expect((earned[0] ?? 0n) + (earned[1] ?? 0n) + (await e2e.rep(C, context.capital))).toBe(0n)
		expect(await e2e.rep(C, context.capital)).toBeLessThanOrEqual(1n)
	})
})
