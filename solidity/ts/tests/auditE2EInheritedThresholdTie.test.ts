import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact, statoblast_QuestionForker_QuestionForker as forkerArtifact } from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, INVALID, median, NO, NONE, OUTCOMES, WEEK, YES } from './auditE2EHarness'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

// Scenario 2: the parent game sits in local non-decision when an unrelated question forks the
// universe. Each child inherits the threshold tie, can only resolve it by forking on its own
// question once the child universe may fork, and the grandchildren pay every carried claim.
describe('auditE2E: an inherited threshold tie resolves through a second-generation own fork', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test('tie children cannot report or settle, fork only after week ten, and grandchildren conserve REP and cash', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const trader = fixture.other()
		const U0 = base.genesisUniverse
		const q = base.questionId
		const source = fixture.poolFor(q).questionLedger
		const reporters = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5)] as const
		const [r2, r3, r4, r5] = reporters
		const thirdParty = e2e.account(6)
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		const engine = await e2e.settlement()
		const coordinator = (await e2e.coordinator()).address
		const sealedCash = await e2e.cash(engine)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const N = await owner.readContract({ ...e2e.zoltar(), functionName: 'getNonDecisionThresholdAttoRep', args: [U0] })
		const burnDivisor = await owner.readContract({ ...e2e.zoltar(), functionName: 'forkBurnDivisor' })
		const plan: readonly (readonly [typeof r2, number, bigint])[] = [
			[r5, INVALID, N / 10n],
			[r2, YES, N / 4n],
			[r3, NO, N / 3n],
			[r4, INVALID, N / 20n],
			[r3, YES, N / 8n],
			[r5, NO, N / 3n],
			[r2, YES, N / 4n],
			[r4, YES, N],
			[r3, NO, N],
		]
		for (const [sender, outcome, amount] of plan) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		const balances = await e2e.balances(game0)
		const binding = median(balances)
		const live = balances[YES] + balances[NO]
		expect(await owner.readContract({ ...e2e.game(game0), functionName: 'nonDecisionState' })).toBe(1n)
		expect(await e2e.gameBalance(game0)).toBe(live)

		// ---- generation one: an unrelated question forks the universe ----
		const fork0 = await e2e.forkOn(thirdParty, U0, await e2e.unrelatedQuestion('auditE2E tie: first unrelated fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const B = await e2e.activateBranch(U0, NO)
		expect(await e2e.rep(A, ledger)).toBe(live)
		expect(await e2e.rep(B, ledger)).toBe(live)
		const childA = await e2e.materialize(source, A)
		const childB = await e2e.materialize(source, B)
		const leaves = { [INVALID]: await e2e.lineageLeaves([game0], INVALID), [YES]: await e2e.lineageLeaves([game0], YES), [NO]: await e2e.lineageLeaves([game0], NO) }
		for (const child of [childA, childB]) {
			const g = e2e.game(child.game)
			expect(await owner.readContract({ ...g, functionName: 'nonDecisionState' })).toBe(2n)
			expect(await owner.readContract({ ...g, functionName: 'fixedQuestionOutcome' })).toBe(NONE)
			expect(await owner.readContract({ ...g, functionName: 'canTriggerOwnFork' })).toBe(true)
			expect(await owner.readContract({ ...g, functionName: 'winnerHaircutPaidByFork' })).toBe(false)
			expect(await owner.readContract({ ...g, functionName: 'getOutcomeBalancesAttoRep' })).toEqual(balances)
			expect(await e2e.gameBalance(child.game)).toBe(live)
			expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(NONE)
			// A tie child accepts no report, settles no claim and sweeps nothing.
			for (const outcome of OUTCOMES) {
				await expect(r2.simulateContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'depositWalletRepToEscalationGame', args: [outcome, N / 10n] })).rejects.toThrow()
				const first = leaves[outcome]?.[0]
				if (first !== undefined) await expect(e2e.simulateInheritedClaim(owner, child.pool, outcome, leaves[outcome] ?? [], first, new SparseNullifierTree())).rejects.toThrow('Question not final')
			}
			await expect(owner.simulateContract({ ...g, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('Question not final')
		}
		// The child universe may fork only after the parent's choice, recapitalization and response periods.
		const earliest = await owner.readContract({ ...e2e.zoltar(), functionName: 'getEarliestForkTime', args: [A] })
		expect(earliest).toBe(fork0 + 10n * WEEK)
		const ownFork = { abi: forkerArtifact.abi, address: e2e.forker().address, functionName: 'forkZoltarWithOwnEscalationGame' } as const
		if ((await base.mockWindow.getTime()) < earliest - 2n) await base.mockWindow.setTime(earliest - 2n)
		await expect(thirdParty.simulateContract({ ...ownFork, args: [childA.pool] })).rejects.toThrow('Parent fork response period is still active')
		// Still unresolved long after every inherited deadline: only the own fork can end the tie.
		await base.mockWindow.setTime(earliest + 8n * WEEK)
		expect(await owner.readContract({ ...e2e.game(childA.game), functionName: 'getFinalQuestionResolution' })).toBe(NONE)
		expect(await owner.readContract({ ...e2e.forker(), functionName: 'getQuestionOutcome', args: [childA.pool] })).toBe(NONE)

		// ---- generation two: child A forks on its own question ----
		const thresholdA = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [A] })
		const supplyA = await e2e.supply(A)
		const walletA = await e2e.rep(A, thirdParty.account.address)
		await writeContractAndWait(thirdParty, () => thirdParty.writeContract({ ...ownFork, args: [childA.pool], gas: BRANCH_GAS }))
		const haircut = thresholdA / burnDivisor
		expect(await e2e.rep(A, thirdParty.account.address)).toBe(walletA)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(supplyA - (await e2e.supply(A))).toBe(live)
		expect(await owner.readContract({ ...e2e.zoltar(), functionName: 'getMigrationRepBalanceAttoRep', args: [ledger, A] })).toBe(live - haircut)
		const [stateA] = await e2e.ledgerQuestion(A, q)
		expect(stateA.balanceAttoRep).toBe(live - haircut)
		expect(stateA.winnerHaircutPaidByFork).toBe(true)
		// The sibling tie child is untouched and can still fork on its own.
		expect(await e2e.gameBalance(childB.game)).toBe(live)
		expect(await owner.readContract({ ...e2e.game(childB.game), functionName: 'canTriggerOwnFork' })).toBe(true)
		// Neither the origin nor the forked child pays anything.
		for (const pool of [source, childA.pool]) await expect(owner.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [YES, [0n]] })).rejects.toThrow()
		for (const game of [game0, childA.game]) await expect(owner.simulateContract({ ...e2e.game(game), functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow()

		await e2e.choose(owner, A, YES)
		const grandchildren = []
		for (const outcome of OUTCOMES) {
			const child = await e2e.activateBranch(A, outcome)
			expect(child).toBe(getChildUniverseId(A, outcome))
			expect(await e2e.rep(child, ledger)).toBe(live - haircut)
			grandchildren.push({ outcome, ...(await e2e.materialize(childA.pool, child)) })
		}
		const table: Record<string, unknown>[] = []
		const received = new Map<Address, bigint>()
		for (const { outcome, universe, pool, game } of grandchildren) {
			const resumedAt = await e2e.activationTime(universe)
			const g = e2e.game(game)
			expect(await owner.readContract({ ...g, functionName: 'fixedQuestionOutcome' })).toBe(BigInt(outcome))
			expect(await owner.readContract({ ...g, functionName: 'winnerHaircutPaidByFork' })).toBe(true)
			expect(await owner.readContract({ ...g, functionName: 'forkResumedAt' })).toBe(resumedAt)
			expect(await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })).toBe(resumedAt + 3n * DAY)
			if ((await base.mockWindow.getTime()) < resumedAt + 3n * DAY + 1n) {
				await base.mockWindow.setTime(resumedAt + 3n * DAY)
				expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(NONE)
				await base.mockWindow.setTime(resumedAt + 3n * DAY + 1n)
			}
			expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(outcome))
			for (const losing of OUTCOMES) {
				const loser = leaves[losing]?.[0]
				if (losing !== outcome && loser !== undefined) await expect(e2e.simulateInheritedClaim(owner, pool, losing, leaves[losing] ?? [], loser, new SparseNullifierTree())).rejects.toThrow('Not winning outcome')
			}
			const supplyBefore = await e2e.supply(universe)
			const wallets = new Map<Address, bigint>()
			for (const reporter of reporters) wallets.set(reporter.account.address, await e2e.rep(universe, reporter.account.address))
			// The proofs are the origin game's leaves: the tie child added none and consumed none.
			const { paid } = await e2e.claimEveryWinner(thirdParty, pool, outcome, leaves[outcome] ?? [], binding, balances[outcome] ?? 0n)
			for (const reporter of reporters) received.set(reporter.account.address, (received.get(reporter.account.address) ?? 0n) + (await e2e.rep(universe, reporter.account.address)) - (wallets.get(reporter.account.address) ?? 0n))
			expect(supplyBefore - (await e2e.supply(universe))).toBe(0n)
			const residual = await e2e.gameBalance(game)
			expect(residual).toBe(live - haircut - paid)
			await e2e.sweep(thirdParty, game)
			expect(await e2e.gameBalance(game)).toBe(0n)
			expect(await e2e.rep(universe, ledger)).toBe(0n)
			expect(await e2e.rep(universe, pool)).toBe(0n)
			expect(supplyBefore - (await e2e.supply(universe))).toBe(residual)
			expect(await owner.readContract({ ...g, functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
			table.push({ grandchild: ['Invalid', 'Yes', 'No'][outcome], backing: live - haircut, paid, residualBurned: residual })
		}
		// Winners on Yes and No each receive principal plus three fifths of the threshold across the two branches.
		expect([...received.values()].reduce((sum, value) => sum + value, 0n)).toBe(table.reduce((sum, row) => sum + (typeof row['paid'] === 'bigint' ? row['paid'] : 0n), 0n))

		// ---- shares: origin -> A -> grandchildren ----
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [YES])
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, A, outcome, [INVALID, YES, NO])
		let cashOut = 0n
		const cashTable: Record<string, unknown>[] = []
		for (const { outcome, universe, pool } of grandchildren) {
			const quoteCash = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionSettlement', args: [pool, 10n * unit] })
			const quoteRep = await owner.readContract({ ...e2e.securityPool(), functionName: 'quoteQuestionRecoveryRep', args: [pool, 10n * unit] })
			const got = await e2e.redeemShares(trader, pool)
			expect(got).toEqual({ cash: quoteCash, rep: quoteRep })
			expect(await e2e.shareBalance(trader.account.address, universe, outcome)).toBe(0n)
			expect(await e2e.rep(universe, engine)).toBe(0n)
			cashOut += got.cash
			cashTable.push({ grandchild: ['Invalid', 'Yes', 'No'][outcome], cash: got.cash, recoveryRep: got.rep })
		}
		expect(cashOut).toBe(sealedCash)
		expect(await e2e.cash(engine)).toBe(0n)
		expect(await e2e.cash(coordinator)).toBe(0n)
	})
})
