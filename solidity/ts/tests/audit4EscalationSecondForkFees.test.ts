import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { BRANCH_GAS, createE2E, INVALID, median, NO, NONE, OUTCOMES, WEEK, YES } from './auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const K = 1_000n * unit

// Audit pass 4, target 3: with annual holding fees on, a continued game is interrupted by a
// second fork of its child universe. The escalation clock, the frozen cost curve, the response
// period and reporter custody must all survive, whether the grandchild is materialized
// promptly, late, or after the intermediate continuation was left half installed.
describe('audit4: a second fork interrupts a continued game while holding fees accrue', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const e2e = createE2E(fixture)

	const start = async () => {
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
		const read = <Name extends 'forkResumedAt' | 'forkElapsedAtStart' | 'totalCostAttoRep' | 'getEscalationGameEndDate' | 'getFinalQuestionResolution' | 'activationTime' | 'getQuestionResolution'>(game: Address, functionName: Name) => owner.readContract({ ...e2e.game(game), functionName })
		const activation = await read(game0, 'activationTime')
		const end0 = await read(game0, 'getEscalationGameEndDate')
		// Run the origin game five days past activation so the cost curve has started to rise.
		const fork0Target = activation + 5n * DAY
		expect(fork0Target).toBeLessThan(end0)
		await base.mockWindow.setTime(fork0Target)
		const fork0 = await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('audit4 fees: first unrelated fork'))
		const cost0 = await read(game0, 'totalCostAttoRep')
		expect(cost0).toBeGreaterThan(0n)
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		for (const reporter of [r2, r3, r4, r5, r6]) await e2e.migrateWalletRep(reporter, U0, await e2e.rep(U0, reporter.account.address), [YES])
		return { owner, U0, q, source, game0, activation, end0, fork0, cost0, A, ledger, read, reporters: { r2, r3, r4, r5, r6 } }
	}
	const step = (sender: WriteClient, source: Address, universe: bigint) => writeContractAndWait(sender, () => sender.writeContract({ ...e2e.forker(), functionName: 'materializePortfolioQuestion', args: [source, universe], gas: BRANCH_GAS }))
	const accrue = (sender: WriteClient, pool: Address) => writeContractAndWait(sender, () => sender.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'updateSettlementCollateral', gas: BRANCH_GAS }))

	test('prompt and late grandchildren inherit the exact clock, cost and custody', async () => {
		const { owner, U0, q, source, game0, activation, end0, fork0, cost0, A, ledger, read, reporters } = await start()
		const { r2, r3, r5, r6 } = reporters
		const { base } = fixture
		const trader = fixture.other()
		const childA = await e2e.materialize(source, A)
		const anchorA = fork0 + 9n * WEEK
		// The continuation resumes at the recapitalization deadline with the origin's elapsed time and cost.
		expect(await read(childA.game, 'forkResumedAt')).toBe(anchorA)
		expect(await read(childA.game, 'forkElapsedAtStart')).toBe(fork0 - activation)
		expect(await base.mockWindow.getTime()).toBeLessThan(anchorA + DAY)
		const remaining0 = end0 - fork0
		const endA0 = await read(childA.game, 'getEscalationGameEndDate')
		expect(endA0).toBe(anchorA + (remaining0 > 3n * DAY ? remaining0 : 3n * DAY))
		expect(await read(childA.game, 'getFinalQuestionResolution')).toBe(NONE)
		// The curve only moved by the seconds since the anchor.
		expect(await read(childA.game, 'totalCostAttoRep')).toBeGreaterThanOrEqual(cost0)
		await accrue(r6, childA.pool)
		// Reports in the child while fees accrue: No takes the lead, Yes retakes it.
		expect(await e2e.deposit(r5, childA.pool, NO, 30n * K)).toBe(30n * K)
		await base.mockWindow.advanceTime(DAY)
		await accrue(r6, childA.pool)
		expect(await e2e.deposit(r2, childA.pool, YES, 20n * K)).toBe(20n * K)
		const balancesA = await e2e.balances(childA.game)
		expect(balancesA).toEqual([5n * K, 90n * K, 80n * K])
		const backing = 120n * K + 50n * K
		expect(await e2e.gameBalance(childA.game)).toBe(backing)
		const endA = await read(childA.game, 'getEscalationGameEndDate')
		const earliest = await owner.readContract({ ...e2e.zoltar(), functionName: 'getEarliestForkTime', args: [A] })
		expect(earliest).toBe(anchorA + WEEK)
		expect(earliest).toBeLessThan(endA)
		await base.mockWindow.setTime(earliest + DAY)
		await accrue(r6, childA.pool)
		const forkA = await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('audit4 fees: second unrelated fork'))
		const costA = await read(childA.game, 'totalCostAttoRep')
		const provisionalA = await read(childA.game, 'getQuestionResolution')
		const elapsedA = fork0 - activation + (forkA - anchorA)
		// The interrupted child stays frozen however much wall time passes.
		await base.mockWindow.setTime(endA + 3n * DAY)
		expect(await read(childA.game, 'getFinalQuestionResolution')).toBe(NONE)
		expect(await read(childA.game, 'totalCostAttoRep')).toBe(costA)
		await expect(r2.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 10n * K] })).rejects.toThrow()
		await e2e.choose(owner, A, YES)
		const AA = await e2e.activateBranch(A, YES)
		const anchorAA = forkA + 9n * WEEK
		for (const reporter of [r2, r3, r5, r6]) await e2e.migrateWalletRep(reporter, A, 100n * K, [YES, NO])

		// ---- prompt grandchild AA ----
		const childAA = await e2e.materialize(childA.pool, AA)
		expect(await read(childAA.game, 'forkResumedAt')).toBe(anchorAA)
		expect(await read(childAA.game, 'forkElapsedAtStart')).toBe(elapsedA)
		expect(await e2e.balances(childAA.game)).toEqual(balancesA)
		expect(await e2e.gameBalance(childAA.game)).toBe(backing)
		expect(await read(childAA.game, 'getFinalQuestionResolution')).toBe(NONE)
		const remainingA = endA - forkA
		// The interrupted child's remaining curve time is rebased onto the grandchild, which also gets its own three days.
		const curveEndA = remainingA
		const endAA = await read(childAA.game, 'getEscalationGameEndDate')
		expect(endAA).toBeGreaterThanOrEqual(anchorAA + 3n * DAY)
		if (curveEndA > 3n * DAY) expect(endAA).toBe(anchorAA + curveEndA)
		// The cost resumes from the frozen value and the provisional leader is unchanged.
		const costAA = await read(childAA.game, 'totalCostAttoRep')
		expect(costAA).toBeGreaterThanOrEqual(costA)
		expect(await read(childAA.game, 'getQuestionResolution')).toBe(provisionalA)
		// Any start-bond response is accepted throughout the three days, and a change of leader restarts nothing.
		await base.mockWindow.setTime(anchorAA + 3n * DAY - 60n)
		await accrue(r6, childAA.pool)
		expect(await e2e.deposit(r5, childAA.pool, NO, 25n * K)).toBe(25n * K)
		expect(await read(childAA.game, 'getEscalationGameEndDate')).toBeGreaterThanOrEqual(anchorAA + 3n * DAY)
		const balancesAA = await e2e.balances(childAA.game)
		expect(balancesAA).toEqual([5n * K, 90n * K, 105n * K])
		const finalEndAA = await read(childAA.game, 'getEscalationGameEndDate')
		await base.mockWindow.setTime(finalEndAA)
		expect(await read(childAA.game, 'getFinalQuestionResolution')).toBe(NONE)
		await base.mockWindow.setTime(finalEndAA + 1n)
		expect(await read(childAA.game, 'getFinalQuestionResolution')).toBe(BigInt(NO))
		await accrue(r6, childAA.pool)
		const lineage = [game0, childA.game]
		const leavesNo = await e2e.lineageLeaves(lineage, NO)
		const supplyAA = await e2e.supply(AA)
		const settled = await e2e.claimEveryWinner(r6, childAA.pool, NO, leavesNo, median(balancesAA), balancesAA[NO])
		const local = await e2e.claimLocal(r6, childAA.pool, NO, [0n], r5.account.address)
		// 105k principal, 54k bonus, 36k burn spend the whole 195k.
		expect(105n * K + 54n * K - settled.paid - local).toBeLessThanOrEqual(5n)
		const residualAA = await e2e.gameBalance(childAA.game)
		if (residualAA !== 0n) await e2e.sweep(r6, childAA.game)
		expect(await e2e.rep(AA, ledger)).toBe(0n)
		expect(supplyAA - (await e2e.supply(AA))).toBe(backing + 25n * K - settled.paid - local)

		// ---- late grandchild AB: materialized long after its response period elapsed ----
		const AB = await e2e.activateBranch(A, NO)
		const anchorAB = anchorAA
		expect(await base.mockWindow.getTime()).toBeGreaterThan(anchorAB + 3n * DAY)
		const childAB = await e2e.materialize(childA.pool, AB)
		expect(await read(childAB.game, 'forkResumedAt')).toBe(anchorAB)
		expect(await read(childAB.game, 'forkElapsedAtStart')).toBe(elapsedA)
		const endAB = await read(childAB.game, 'getEscalationGameEndDate')
		expect(endAB).toBe(endAA)
		const now = await base.mockWindow.getTime()
		const finalAB = await read(childAB.game, 'getFinalQuestionResolution')
		// Game finality and reporter custody finality agree whichever side of the deadline we are on.
		const [stateAB, finalClaimAB] = await e2e.ledgerQuestion(AB, q)
		expect(finalClaimAB).toBe(finalAB !== NONE)
		expect(stateAB.balanceAttoRep).toBe(backing)
		if (now <= endAB) {
			await base.mockWindow.setTime(endAB + 1n)
		} else {
			expect(finalAB).toBe(BigInt(YES))
			await expect(r5.simulateContract({ abi: poolArtifact.abi, address: childAB.pool, functionName: 'depositWalletRepToEscalationGame', args: [NO, 25n * K] })).rejects.toThrow()
		}
		expect(await read(childAB.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
		await accrue(r6, childAB.pool)
		const leavesYes = await e2e.lineageLeaves(lineage, YES)
		const supplyAB = await e2e.supply(AB)
		const settledAB = await e2e.claimEveryWinner(r6, childAB.pool, YES, leavesYes, median(balancesA), balancesA[YES])
		expect(90n * K + 48n * K - settledAB.paid).toBeLessThanOrEqual(5n)
		if ((await e2e.gameBalance(childAB.game)) !== 0n) await e2e.sweep(r6, childAB.game)
		expect(await e2e.rep(AB, ledger)).toBe(0n)
		expect(supplyAB - (await e2e.supply(AB))).toBe(backing - settledAB.paid)
		for (const universe of [U0, A]) expect(await e2e.rep(universe, ledger)).toBe(0n)

		// ---- shares still redeem in both grandchildren, and only the winning side is paid ----
		const engine = await e2e.settlement()
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [YES])
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, A, outcome, [YES, NO])
		const engineBefore = await e2e.cash(engine)
		const gotAA = await e2e.redeemShares(trader, childAA.pool)
		const gotAB = await e2e.redeemShares(trader, childAB.pool)
		console.log(`audit4 fees: redeemed AA ${gotAA.cash}, AB ${gotAB.cash}, engine before ${engineBefore}, after ${await e2e.cash(engine)}`)
		expect(gotAA.cash + gotAB.cash).toBeGreaterThan(0n)
		expect(engineBefore - (await e2e.cash(engine))).toBe(gotAA.cash + gotAB.cash)
		expect(await e2e.shareBalance(trader.account.address, AA, NO)).toBe(0n)
		expect(await e2e.shareBalance(trader.account.address, AB, YES)).toBe(0n)
	})

	test('a continuation left half installed when its universe forks does not strand the grandchild', async () => {
		const { owner, q, source, game0, activation, fork0, A, ledger, read, reporters } = await start()
		const { r6 } = reporters
		const { base } = fixture
		const anchorA = fork0 + 9n * WEEK
		// Two of the three installation steps run in A; the third never does before A forks.
		await step(r6, source, A)
		await step(r6, source, A)
		const poolA = await e2e.poolOf(q, A)
		const gameA = await e2e.gameOf(poolA)
		expect(BigInt(await owner.readContract({ ...e2e.game(gameA), functionName: 'forkCarrySnapshotOutcomesInitialized' }))).toBe(2n)
		expect(await read(gameA, 'forkResumedAt')).toBe(0n)
		expect(await read(gameA, 'getEscalationGameEndDate')).toBe(2n ** 256n - 1n)
		const earliest = await owner.readContract({ ...e2e.zoltar(), functionName: 'getEarliestForkTime', args: [A] })
		await base.mockWindow.setTime(earliest)
		const forkA = await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('audit4 fees: fork over a half installed continuation'))
		// The stranded continuation can never finish in the forked universe, move REP, or accept reports.
		await expect(r6.simulateContract({ ...e2e.forker(), functionName: 'materializePortfolioQuestion', args: [source, A], gas: BRANCH_GAS })).rejects.toThrow('Only finalized questions can activate in a forked universe')
		await expect(r6.simulateContract({ abi: poolArtifact.abi, address: poolA, functionName: 'resumeForkedEscalationGame' })).rejects.toThrow('Fork continuation unavailable')
		await expect(r6.simulateContract({ abi: poolArtifact.abi, address: poolA, functionName: 'depositWalletRepToEscalationGame', args: [YES, 10n * K] })).rejects.toThrow()
		expect(await read(gameA, 'getFinalQuestionResolution')).toBe(NONE)
		await e2e.choose(owner, A, YES)
		const AA = await e2e.activateBranch(A, YES)
		const anchorAA = forkA + 9n * WEEK
		// The half installed pool is not the last live reporter source; the origin still is.
		await expect(r6.simulateContract({ ...e2e.forker(), functionName: 'materializePortfolioQuestion', args: [poolA, AA], gas: BRANCH_GAS })).rejects.toThrow('Use last live reporter source')
		const childAA = await e2e.materialize(source, AA)
		expect(await read(childAA.game, 'forkResumedAt')).toBe(anchorAA)
		// The clock kept running through A's live week even though nobody could report there.
		expect(await read(childAA.game, 'forkElapsedAtStart')).toBe(fork0 - activation + (forkA - anchorA))
		expect(await e2e.gameBalance(childAA.game)).toBe(120n * K)
		expect(await e2e.balances(childAA.game)).toEqual([5n * K, 70n * K, 50n * K])
		expect(await read(childAA.game, 'getFinalQuestionResolution')).toBe(NONE)
		const endAA = await read(childAA.game, 'getEscalationGameEndDate')
		expect(endAA).toBeGreaterThanOrEqual(anchorAA + 3n * DAY)
		await base.mockWindow.setTime(endAA + 1n)
		expect(await read(childAA.game, 'getFinalQuestionResolution')).toBe(BigInt(YES))
		const leaves = await e2e.lineageLeaves([game0], YES)
		const settled = await e2e.claimEveryWinner(r6, childAA.pool, YES, leaves, 50n * K, 70n * K)
		expect(100n * K - settled.paid).toBeLessThanOrEqual(2n)
		if ((await e2e.gameBalance(childAA.game)) !== 0n) await e2e.sweep(r6, childAA.game)
		expect(await e2e.rep(AA, ledger)).toBe(0n)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(await e2e.rep(A, gameA)).toBe(0n)
	})
})
