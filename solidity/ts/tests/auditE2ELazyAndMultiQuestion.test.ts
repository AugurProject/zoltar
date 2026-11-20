import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, INVALID, median, NO, NONE, WEEK, YES } from './auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const K = 1_000n * unit

// Reporter claims on the paths nobody is forced to walk promptly: a question that is only
// materialized in a child after that child universe forked again, and a second escalated
// question that rides through another question's own fork.
describe('auditE2E: lazy materialization and a second escalated question keep reporter claims payable', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	const thresholdPlan = (N: bigint, [r2, r3, r4, r5]: readonly [WriteClient, WriteClient, WriteClient, WriteClient]): readonly (readonly [WriteClient, number, bigint])[] => [
		[r5, INVALID, N / 10n],
		[r2, YES, N / 4n],
		[r3, NO, N / 3n],
		[r3, YES, N / 8n],
		[r5, NO, N / 3n],
		[r4, YES, N],
		[r3, NO, N],
	]

	test('own fork: the fixed-outcome child is materialized only after that child forked again', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const q = base.questionId
		const source = fixture.poolFor(q).securityPool
		const reporters = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5)] as const
		const r6 = e2e.account(6)
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const N = await owner.readContract({ ...e2e.zoltar(), functionName: 'getNonDecisionThresholdAttoRep', args: [U0] })
		const burnDivisor = await owner.readContract({ ...e2e.zoltar(), functionName: 'forkBurnDivisor' })
		for (const [sender, outcome, amount] of thresholdPlan(N, reporters)) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		const balances = await e2e.balances(game0)
		const live = await e2e.gameBalance(game0)
		const threshold = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		await writeContractAndWait(r6, () => r6.writeContract({ abi: forkerArtifact.abi, address: e2e.forker().address, functionName: 'forkZoltarWithOwnEscalationGame', args: [source], gas: BRANCH_GAS }))
		const backing = live - threshold / burnDivisor
		const fork0 = await e2e.forkTime(U0)
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		expect(await e2e.rep(A, ledger)).toBe(backing)
		// Nobody materializes the question in the Yes child. That child forks on an unrelated question in week ten.
		await e2e.migrateWalletRep(r6, U0, 700n * K, [YES])
		await base.mockWindow.setTime(fork0 + 10n * WEEK)
		await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('auditE2E lazy: fork of the fixed-outcome child'))
		await e2e.freeze(A, r6)
		// The fixed outcome became final three days after activation, before this fork: the escrow stays in A.
		const [stateA, finalInA] = await e2e.ledgerQuestion(A, q)
		expect(finalInA).toBe(true)
		expect(stateA.balanceAttoRep).toBe(backing)
		expect(await e2e.rep(A, ledger)).toBe(backing)
		const bookA = await e2e.ledgerBook(A)
		expect(bookA.finalAttoRep).toBe(backing)
		expect(bookA.liveAttoRep).toBe(0n)
		const child = await e2e.materialize(source, A)
		const g = e2e.game(child.game)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		expect(await owner.readContract({ ...g, functionName: 'winnerHaircutPaidByFork' })).toBe(true)
		const leaves = await e2e.lineageLeaves([game0], YES)
		const supplyA = await e2e.supply(A)
		const { paid } = await e2e.claimEveryWinner(r6, child.pool, YES, leaves, median(balances), balances[YES])
		expect(supplyA - (await e2e.supply(A))).toBe(0n)
		const residual = await e2e.gameBalance(child.game)
		expect(residual).toBe(backing - paid)
		if (residual === 0n) await expect(e2e.sweep(r6, child.game)).rejects.toThrow('No sweepable REP')
		else await e2e.sweep(r6, child.game)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(supplyA - (await e2e.supply(A))).toBe(residual)
		// The grandchildren inherit no reporter escrow for the already final question.
		const AA = await e2e.activateBranch(A, YES)
		expect(await e2e.rep(AA, ledger)).toBe(0n)
		const [stateAA] = await e2e.ledgerQuestion(AA, q)
		expect(stateAA.balanceAttoRep).toBe(0n)
	})

	test('unrelated fork: a contested game finalizes by its inherited clock in a never-materialized child that then forks', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const q = base.questionId
		const source = fixture.poolFor(q).securityPool
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const plan: readonly (readonly [WriteClient, number, bigint])[] = [
			[r2, YES, 30n * K],
			[r3, NO, 25n * K],
			[r3, YES, 40n * K],
			[r5, NO, 25n * K],
			[r4, INVALID, 5n * K],
		]
		for (const [sender, outcome, amount] of plan) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		const end0 = await owner.readContract({ ...e2e.game(game0), functionName: 'getEscalationGameEndDate' })
		const backing = 120n * K
		const fork0 = await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('auditE2E lazy: first unrelated fork'))
		expect(fork0).toBeLessThan(end0)
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		// The child clock resumes at the recapitalization deadline with the origin's remaining time.
		const inheritedEnd = fork0 + 9n * WEEK + (end0 - fork0)
		await e2e.migrateWalletRep(r6, U0, 700n * K, [YES])
		await base.mockWindow.setTime(inheritedEnd + DAY)
		await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('auditE2E lazy: second unrelated fork'))
		await e2e.freeze(A, r6)
		const [stateA, finalInA] = await e2e.ledgerQuestion(A, q)
		expect(finalInA).toBe(true)
		expect(stateA.balanceAttoRep).toBe(backing)
		const child = await e2e.materialize(source, A)
		const g = e2e.game(child.game)
		expect(await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })).toBe(inheritedEnd)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		const balances = await e2e.balances(child.game)
		const leaves = await e2e.lineageLeaves([game0], YES)
		const losing = await e2e.lineageLeaves([game0], NO)
		const loser = losing[0]
		if (loser !== undefined) await expect(e2e.simulateInheritedClaim(owner, child.pool, NO, losing, loser, new SparseNullifierTree())).rejects.toThrow('Not winning outcome')
		const supplyA = await e2e.supply(A)
		const { paid, burn } = await e2e.claimEveryWinner(r6, child.pool, YES, leaves, median(balances), balances[YES])
		// 70k principal, 30k bonus and 20k burn spend the whole 120k that survived the origin's surplus release.
		expect(100n * K - paid).toBeLessThanOrEqual(2n)
		expect(supplyA - (await e2e.supply(A))).toBe(burn)
		const residual = await e2e.gameBalance(child.game)
		expect(residual).toBe(backing - paid - burn)
		if (residual !== 0n) await e2e.sweep(r6, child.game)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(supplyA - (await e2e.supply(A))).toBe(backing - paid)
		// No reporter escrow reaches the grandchildren, and the origin never paid.
		const AA = await e2e.activateBranch(A, YES)
		expect(await e2e.rep(AA, ledger)).toBe(0n)
		expect(await e2e.rep(U0, ledger)).toBe(0n)
		await expect(owner.simulateContract({ abi: poolArtifact.abi, address: source, functionName: 'withdrawFromEscalationGame', args: [YES, [0n]] })).rejects.toThrow()
	})

	test('two escalated questions: one forks the universe through its own game, the other continues and settles in a child', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const q1 = base.questionId
		const q2 = fixture.secondQuestionId
		const source1 = fixture.poolFor(q1).securityPool
		const source2 = fixture.poolFor(q2).securityPool
		const reporters = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5)] as const
		const [r2, r3, , r5] = reporters
		const r6 = e2e.account(6)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		const N = await owner.readContract({ ...e2e.zoltar(), functionName: 'getNonDecisionThresholdAttoRep', args: [U0] })
		const burnDivisor = await owner.readContract({ ...e2e.zoltar(), functionName: 'forkBurnDivisor' })
		// The second question is contested first: Yes 60k against No 40k.
		await e2e.deposit(r2, source2, YES, 60n * K)
		await e2e.deposit(r5, source2, NO, 40n * K)
		const game2 = await e2e.gameOf(source2)
		const live2 = await e2e.gameBalance(game2)
		expect(live2).toBe(100n * K)
		for (const [sender, outcome, amount] of thresholdPlan(N, reporters)) await e2e.deposit(sender, source1, outcome, amount)
		const game1 = await e2e.gameOf(source1)
		const balances1 = await e2e.balances(game1)
		const live1 = await e2e.gameBalance(game1)
		expect(await e2e.rep(U0, ledger)).toBe(live1 + live2)
		const threshold = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		const end2 = await owner.readContract({ ...e2e.game(game2), functionName: 'getEscalationGameEndDate' })
		await writeContractAndWait(r6, () => r6.writeContract({ abi: forkerArtifact.abi, address: e2e.forker().address, functionName: 'forkZoltarWithOwnEscalationGame', args: [source1], gas: BRANCH_GAS }))
		const fork0 = await e2e.forkTime(U0)
		expect(fork0).toBeLessThan(end2)
		const haircut = threshold / burnDivisor
		// Only the triggering question pays the admission haircut; the other question's escrow migrates whole.
		expect(await e2e.rep(U0, ledger)).toBe(0n)
		expect(await owner.readContract({ ...e2e.zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [ledger, U0] })).toBe(live1 + live2 - haircut)
		const [state1] = await e2e.ledgerQuestion(U0, q1)
		const [state2] = await e2e.ledgerQuestion(U0, q2)
		expect([state1.balanceAttoRep, state1.winnerHaircutPaidByFork]).toEqual([live1 - haircut, true])
		expect([state2.balanceAttoRep, state2.winnerHaircutPaidByFork]).toEqual([live2, false])
		const A = await e2e.activateBranch(U0, YES)
		expect(await e2e.rep(A, ledger)).toBe(live1 + live2 - haircut)
		const child1 = await e2e.materialize(source1, A)
		const child2 = await e2e.materialize(source2, A)
		const g1 = e2e.game(child1.game)
		const g2 = e2e.game(child2.game)
		expect(await owner.readContract({ ...g1, functionName: 'fixedQuestionOutcome' })).toBe(BigInt(YES))
		expect(await owner.readContract({ ...g2, functionName: 'fixedQuestionOutcome' })).toBe(NONE)
		expect(await owner.readContract({ ...g2, functionName: 'winnerHaircutPaidByFork' })).toBe(false)
		expect(await e2e.gameBalance(child1.game)).toBe(live1 - haircut)
		expect(await e2e.gameBalance(child2.game)).toBe(live2)
		// The continued question still takes reports in the child: No overtakes Yes.
		await e2e.migrateWalletRep(r3, U0, 100n * K, [YES])
		expect(await e2e.deposit(r3, child2.pool, NO, 50n * K)).toBe(50n * K)
		const balances2 = await e2e.balances(child2.game)
		expect(balances2).toEqual([0n, 60n * K, 90n * K])
		const end1 = await owner.readContract({ ...g1, functionName: 'getEscalationGameEndDate' })
		const endChild2 = await owner.readContract({ ...g2, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime((end1 > endChild2 ? end1 : endChild2) + 1n)
		expect(await owner.readContract({ ...g1, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		expect(await owner.readContract({ ...g2, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(NO))
		const supplyA = await e2e.supply(A)
		// Question one: haircut already paid, no burn.
		const first = await e2e.claimEveryWinner(r6, child1.pool, YES, await e2e.lineageLeaves([game1], YES), median(balances1), balances1[YES])
		expect(supplyA - (await e2e.supply(A))).toBe(0n)
		const residual1 = await e2e.gameBalance(child1.game)
		expect(residual1).toBe(live1 - haircut - first.paid)
		// Question two: an inherited and a local winner, with the ordinary burn.
		const second = await e2e.claimEveryWinner(r6, child2.pool, NO, await e2e.lineageLeaves([game2], NO), median(balances2), balances2[NO])
		const localPaid = await e2e.claimLocal(r6, child2.pool, NO, [0n], r3.account.address)
		expect(second.paid + localPaid).toBe(90n * K + 36n * K)
		const burn2 = supplyA - (await e2e.supply(A))
		expect(24n * K - burn2).toBeLessThanOrEqual(2n)
		// Each game holds exactly its own remainder: neither question's claims touched the other's escrow.
		expect(await e2e.gameBalance(child1.game)).toBe(residual1)
		expect(await e2e.gameBalance(child2.game)).toBe(live2 + 50n * K - second.paid - localPaid - burn2)
		await e2e.sweep(r6, child1.game)
		if ((await e2e.gameBalance(child2.game)) !== 0n) await e2e.sweep(r6, child2.game)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(supplyA - (await e2e.supply(A))).toBe(residual1 + 24n * K)
	})
})
