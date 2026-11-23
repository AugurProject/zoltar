import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { SparseNullifierTree } from './carryProofHelpers'
import { createE2E, expectedWinningClaim, INVALID, median, NO, NONE, OUTCOMES, YES, type CarryLeaf } from './auditE2EHarness'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const K = 1_000n * unit

// Scenario 3: an unrelated fork interrupts a contested game. The child continues it with new
// local reports and either settles (inherited proofs and local indexes mixed in any order) or
// forks again before finality, so the grandchildren pay claims from three generations.
describe('auditE2E: continuation games mix inherited and local claims across generations', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	const total = (values: readonly bigint[]) => values.reduce((sum, value) => sum + value, 0n)

	/** Origin game: Invalid 5k, Yes 70k, No 50k; an unrelated fork; child A continues with local reports. */
	const continueInChild = async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const q = base.questionId
		const source = fixture.poolFor(q).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		const engine = await e2e.settlement()
		const sealedCash = await e2e.cash(engine)
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
		// The 5k minimum is ordinary surplus: it left reporter custody before the fork.
		const inheritedBacking = 120n * K
		expect(await e2e.gameBalance(game0)).toBe(inheritedBacking)
		await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('auditE2E continuation: first unrelated fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const childA = await e2e.materialize(source, A)
		const gA = e2e.game(childA.game)
		const resumedAt = await e2e.activationTime(A)
		expect(await owner.readContract({ ...gA, functionName: 'forkResumedAt' })).toBe(resumedAt)
		expect(await owner.readContract({ ...gA, functionName: 'nonDecisionState' })).toBe(0n)
		expect(await owner.readContract({ ...gA, functionName: 'winnerHaircutPaidByFork' })).toBe(false)
		expect(await e2e.gameBalance(childA.game)).toBe(inheritedBacking)
		expect(await e2e.balances(childA.game)).toEqual([5n * K, 70n * K, 50n * K])
		// Reporters bring wallet REP into the child universe.
		for (const reporter of [r2, r3, r4, r5]) await e2e.migrateWalletRep(reporter, U0, 400n * K, [YES])
		await e2e.migrateWalletRep(r6, U0, 900n * K, [YES])
		const end = () => owner.readContract({ ...gA, functionName: 'getEscalationGameEndDate' })
		// No overtakes Yes, which raises the median from 50k to 70k and can only move the curve deadline later.
		const before = await end()
		expect(await e2e.deposit(r5, childA.pool, NO, 30n * K)).toBe(30n * K)
		const afterFlip = await end()
		expect(afterFlip).toBeGreaterThanOrEqual(before)
		// Yes retakes the lead, raising the median to No's 80k.
		expect(await e2e.deposit(r2, childA.pool, YES, 20n * K)).toBe(20n * K)
		const afterSecondFlip = await end()
		expect(afterSecondFlip).toBeGreaterThanOrEqual(afterFlip)
		// More support for the leader leaves the median, and so the deadline, unchanged.
		expect(await e2e.deposit(r4, childA.pool, YES, 40n * K)).toBe(40n * K)
		expect(await end()).toBe(afterSecondFlip)
		expect(await e2e.gameBalance(childA.game)).toBe(inheritedBacking + 90n * K)
		return { owner, U0, q, source, game0, A, childA, ledger, engine, sealedCash, inheritedBacking, reporters: { r2, r3, r4, r5, r6 } }
	}

	const orders = ['local-first', 'inherited-first', 'interleaved'] as const
	test.each(orders)('the child settles inherited proofs and local claims on the winning outcome (%s)', async order => {
		const { owner, source, game0, A, childA, ledger, inheritedBacking, reporters } = await continueInChild()
		const { r3, r5, r6 } = reporters
		const { base } = fixture
		const gA = e2e.game(childA.game)
		expect(await e2e.deposit(r6, childA.pool, NO, 20n * K)).toBe(20n * K)
		// This report crosses the reward cap of one and a half times binding capital (150k).
		expect(await e2e.deposit(r3, childA.pool, YES, 60n * K)).toBe(60n * K)
		const balances = await e2e.balances(childA.game)
		expect(balances).toEqual([5n * K, 190n * K, 100n * K])
		const binding = median(balances)
		const backing = inheritedBacking + 170n * K
		expect(await e2e.gameBalance(childA.game)).toBe(backing)
		const end = await owner.readContract({ ...gA, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end)
		expect(await owner.readContract({ ...gA, functionName: 'getFinalQuestionResolution' })).toBe(NONE)
		await base.mockWindow.setTime(end + 1n)
		expect(await owner.readContract({ ...gA, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		await expect(r5.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'depositWalletRepToEscalationGame', args: [NO, 150n * K] })).rejects.toThrow()

		const inherited = { [INVALID]: await e2e.lineageLeaves([game0], INVALID), [YES]: await e2e.lineageLeaves([game0], YES), [NO]: await e2e.lineageLeaves([game0], NO) }
		const local = { [INVALID]: await e2e.localLeaves(childA.game, INVALID), [YES]: await e2e.localLeaves(childA.game, YES), [NO]: await e2e.localLeaves(childA.game, NO) }
		expect(inherited[YES].length).toBe(2)
		expect(local[YES].length).toBe(3)
		// Nothing was ever payable in the forked origin.
		await expect(owner.simulateContract({ abi: poolArtifact.abi, address: source, functionName: 'withdrawFromEscalationGame', args: [YES, [0n]] })).rejects.toThrow()
		// Losers: an inherited losing proof is rejected; a sweep is blocked while losing local principal is unsettled.
		const losingLeaf = inherited[NO][0]
		if (losingLeaf === undefined) throw new Error('Missing inherited No leaf')
		await expect(e2e.simulateInheritedClaim(owner, childA.pool, NO, inherited[NO], losingLeaf, new SparseNullifierTree())).rejects.toThrow('Not winning outcome')

		type Claim = { kind: 'inherited' | 'local'; leaf: CarryLeaf }
		const inheritedClaims: Claim[] = inherited[YES].map(leaf => ({ kind: 'inherited', leaf }))
		const localClaims: Claim[] = local[YES].map(leaf => ({ kind: 'local', leaf }))
		const sequence: Claim[] = []
		if (order === 'local-first') sequence.push(...localClaims, ...inheritedClaims)
		else if (order === 'inherited-first') sequence.push(...inheritedClaims, ...localClaims)
		else for (let index = 0; index < 3; index++) for (const claim of [localClaims[2 - index], inheritedClaims[1 - index]]) if (claim !== undefined) sequence.push(claim)
		expect(sequence.length).toBe(5)
		const supplyBefore = await e2e.supply(A)
		const tree = new SparseNullifierTree()
		let paid = 0n
		let burn = 0n
		const rows: Record<string, unknown>[] = []
		for (const [step, { kind, leaf }] of sequence.entries()) {
			const expected = expectedWinningClaim(leaf.amount, leaf.cumulative, binding, balances[YES])
			const received = kind === 'inherited' ? await e2e.claimInherited(r6, childA.pool, YES, inherited[YES], [leaf], tree) : await e2e.claimLocal(r6, childA.pool, YES, [leaf.localIndex], leaf.depositor)
			expect(received).toBe(expected.payout)
			paid += received
			burn += expected.burn
			rows.push({ step, kind, depositor: leaf.depositor, amount: leaf.amount, cumulative: leaf.cumulative, payout: received, burn: expected.burn })
			// Custody always equals the remaining claims' budget.
			expect(await e2e.gameBalance(childA.game)).toBe(backing - paid - burn)
			expect(supplyBefore - (await e2e.supply(A))).toBe(burn)
			if (step === 1) {
				// A loser settles in the middle of the winners: zero payout, exactly once.
				expect(await e2e.claimLocal(r5, childA.pool, NO, [0n], r5.account.address)).toBe(0n)
				await expect(r5.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'withdrawFromEscalationGame', args: [NO, [0n]] })).rejects.toThrow('Deposit settled')
				await expect(owner.simulateContract({ ...gA, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('Principal remains')
			}
		}
		// Reward coordinates run across the inherited/local boundary: 150k of 190k is reward eligible.
		expect(paid).toBe(190n * K + 60n * K)
		// Each claim floors its share of the 40k haircut; the few attoREP of dust stay for the terminal sweep.
		expect(40n * K - burn).toBeLessThanOrEqual(5n)
		// No claim can be repeated in either form.
		for (const { kind, leaf } of sequence) {
			if (kind === 'inherited') await expect(e2e.simulateInheritedClaim(owner, childA.pool, YES, inherited[YES], leaf, tree)).rejects.toThrow()
			else await expect(owner.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'withdrawFromEscalationGame', args: [YES, [leaf.localIndex]] })).rejects.toThrow('Deposit settled')
		}
		// A local leaf cannot be replayed as an inherited proof, and an inherited leaf has no local index.
		const localLeaf = local[YES][0]
		if (localLeaf !== undefined) await expect(e2e.simulateInheritedClaim(owner, childA.pool, YES, [...inherited[YES], ...local[YES]], localLeaf, new SparseNullifierTree())).rejects.toThrow()
		await expect(owner.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'withdrawFromEscalationGame', args: [YES, [3n]] })).rejects.toThrow('Bad deposit index')
		// The last losing local deposit must settle before the terminal sweep.
		await expect(owner.simulateContract({ ...gA, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('Principal remains')
		expect(await e2e.claimLocal(r5, childA.pool, NO, [1n], r6.account.address)).toBe(0n)
		const residual = await e2e.gameBalance(childA.game)
		expect(residual).toBe(backing - paid - burn)
		expect(residual).toBe(40n * K - burn)
		await e2e.sweep(r6, childA.game)
		expect(supplyBefore - (await e2e.supply(A))).toBe(40n * K)
		await expect(owner.simulateContract({ ...gA, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow()
		expect(await e2e.gameBalance(childA.game)).toBe(0n)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(await e2e.rep(A, childA.pool)).toBe(0n)
		expect(await owner.readContract({ ...gA, functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
	})

	test('the child forks again before finality: grandchildren pay claims from the origin, the child and themselves', async () => {
		const { owner, U0, game0, A, childA, ledger, engine, sealedCash, inheritedBacking, reporters } = await continueInChild()
		const { r2, r3, r4, r5, r6 } = reporters
		const { base } = fixture
		const trader = fixture.other()
		const gA = e2e.game(childA.game)
		const backing = inheritedBacking + 90n * K
		const balancesA = await e2e.balances(childA.game)
		expect(balancesA).toEqual([5n * K, 130n * K, 80n * K])
		const endA = await owner.readContract({ ...gA, functionName: 'getEscalationGameEndDate' })
		const earliest = await owner.readContract({ ...e2e.zoltar(), functionName: 'getEarliestForkTime', args: [A] })
		expect(earliest).toBeLessThan(endA)
		await base.mockWindow.setTime(earliest)
		const forkA = await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('auditE2E continuation: second unrelated fork'))
		expect(forkA).toBeLessThan(endA)
		// The interrupted child never becomes final: no claim of either kind, no sweep, no report.
		await base.mockWindow.setTime(endA + DAY)
		expect(await owner.readContract({ ...gA, functionName: 'getFinalQuestionResolution' })).toBe(NONE)
		const snapshot = { [INVALID]: await e2e.lineageLeaves([game0, childA.game], INVALID), [YES]: await e2e.lineageLeaves([game0, childA.game], YES), [NO]: await e2e.lineageLeaves([game0, childA.game], NO) }
		const originOnly = { [YES]: await e2e.lineageLeaves([game0], YES) }
		const originYes = originOnly[YES][0]
		if (originYes === undefined) throw new Error('Missing origin leaf')
		await expect(e2e.simulateInheritedClaim(owner, childA.pool, YES, originOnly[YES], originYes, new SparseNullifierTree())).rejects.toThrow('Question not final')
		await expect(owner.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'withdrawFromEscalationGame', args: [YES, [0n]] })).rejects.toThrow('Deposits carry to child games')
		await expect(owner.simulateContract({ ...gA, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('Question not final')
		await expect(r2.simulateContract({ abi: poolArtifact.abi, address: childA.pool, functionName: 'depositWalletRepToEscalationGame', args: [YES, 10n * K] })).rejects.toThrow()
		expect(snapshot[YES].map(leaf => leaf.amount)).toEqual([30n * K, 40n * K, 20n * K, 40n * K])
		expect(snapshot[NO].map(leaf => leaf.amount)).toEqual([25n * K, 25n * K, 30n * K])

		await e2e.choose(owner, A, YES)
		const AA = await e2e.activateBranch(A, YES)
		const AB = await e2e.activateBranch(A, NO)
		expect(await e2e.rep(AA, ledger)).toBe(backing)
		expect(await e2e.rep(AB, ledger)).toBe(backing)
		const childAA = await e2e.materialize(childA.pool, AA)
		const childAB = await e2e.materialize(childA.pool, AB)
		for (const child of [childAA, childAB]) {
			expect(await e2e.balances(child.game)).toEqual(balancesA)
			expect(await e2e.gameBalance(child.game)).toBe(backing)
			expect(await owner.readContract({ ...e2e.game(child.game), functionName: 'fixedQuestionOutcome' })).toBe(NONE)
		}
		// Branch AB receives one more local report that flips the result to No.
		await e2e.migrateWalletRep(r5, A, 60n * K, [NO])
		expect(await e2e.deposit(r5, childAB.pool, NO, 60n * K)).toBe(60n * K)
		const endAA = await owner.readContract({ ...e2e.game(childAA.game), functionName: 'getEscalationGameEndDate' })
		const endAB = await owner.readContract({ ...e2e.game(childAB.game), functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime((endAA > endAB ? endAA : endAB) + 1n)
		expect(await owner.readContract({ ...e2e.game(childAA.game), functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		expect(await owner.readContract({ ...e2e.game(childAB.game), functionName: 'getFinalQuestionResolution' })).toBe(BigInt(NO))

		// ---- grandchild AA: Yes wins with claims from generation zero and one ----
		const wallets = async (universe: bigint) => new Map<Address, bigint>(await Promise.all([r2, r3, r4, r5, r6].map(async reporter => [reporter.account.address, await e2e.rep(universe, reporter.account.address)] as const)))
		const beforeAA = await wallets(AA)
		const supplyAA = await e2e.supply(AA)
		const bindingAA = median(balancesA)
		// A stale proof against the origin snapshot alone no longer verifies: the snapshot now spans both generations.
		await expect(e2e.simulateInheritedClaim(owner, childAA.pool, YES, originOnly[YES], originYes, new SparseNullifierTree())).rejects.toThrow('Bad carry peak')
		const settledAA = await e2e.claimEveryWinner(r6, childAA.pool, YES, snapshot[YES], bindingAA, balancesA[YES])
		// r2 claimed a generation-zero and a generation-one deposit in one transaction.
		const r2Claims = snapshot[YES].filter(leaf => leaf.depositor === r2.account.address)
		expect(r2Claims.map(leaf => leaf.game)).toEqual([game0, childA.game])
		expect((await e2e.rep(AA, r2.account.address)) - (beforeAA.get(r2.account.address) ?? 0n)).toBe(total(r2Claims.map(leaf => expectedWinningClaim(leaf.amount, leaf.cumulative, bindingAA, balancesA[YES]).payout)))
		// 120k of the 130k winning principal is reward eligible: 48k bonus, 32k burn.
		expect(130n * K + 48n * K - settledAA.paid).toBeLessThanOrEqual(4n)
		expect(32n * K - settledAA.burn).toBeLessThanOrEqual(4n)
		expect(supplyAA - (await e2e.supply(AA))).toBe(settledAA.burn)
		expect(await e2e.gameBalance(childAA.game)).toBe(backing - settledAA.paid - settledAA.burn)
		for (const outcome of OUTCOMES) {
			const loser = snapshot[outcome][0]
			if (outcome !== YES && loser !== undefined) await expect(e2e.simulateInheritedClaim(owner, childAA.pool, outcome, snapshot[outcome], loser, new SparseNullifierTree())).rejects.toThrow('Not winning outcome')
		}
		const residualAA = await e2e.gameBalance(childAA.game)
		if (residualAA === 0n) await expect(owner.simulateContract({ ...e2e.game(childAA.game), functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('No sweepable REP')
		else await e2e.sweep(r6, childAA.game)
		expect(await e2e.rep(AA, ledger)).toBe(0n)
		expect(supplyAA - (await e2e.supply(AA))).toBe(settledAA.burn + residualAA)

		// ---- grandchild AB: No wins with claims from generations zero, one and two ----
		const balancesAB = await e2e.balances(childAB.game)
		expect(balancesAB).toEqual([5n * K, 130n * K, 140n * K])
		const bindingAB = median(balancesAB)
		const backingAB = backing + 60n * K
		const supplyAB = await e2e.supply(AB)
		const localAB = await e2e.localLeaves(childAB.game, NO)
		const ownLeaf = localAB[0]
		if (ownLeaf === undefined) throw new Error('Missing grandchild leaf')
		// Local first, then the inherited proofs.
		const localPaid = await e2e.claimLocal(r6, childAB.pool, NO, [0n], r5.account.address)
		expect(localPaid).toBe(expectedWinningClaim(ownLeaf.amount, ownLeaf.cumulative, bindingAB, balancesAB[NO]).payout)
		const settledAB = await e2e.claimEveryWinner(r6, childAB.pool, NO, snapshot[NO], bindingAB, balancesAB[NO])
		const burnAB = settledAB.burn + expectedWinningClaim(ownLeaf.amount, ownLeaf.cumulative, bindingAB, balancesAB[NO]).burn
		expect(140n * K + 78n * K - settledAB.paid - localPaid).toBeLessThanOrEqual(4n)
		expect(52n * K - burnAB).toBeLessThanOrEqual(4n)
		expect(supplyAB - (await e2e.supply(AB))).toBe(burnAB)
		const residualAB = await e2e.gameBalance(childAB.game)
		expect(residualAB).toBe(backingAB - settledAB.paid - localPaid - burnAB)
		if (residualAB === 0n) await expect(owner.simulateContract({ ...e2e.game(childAB.game), functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('No sweepable REP')
		else await e2e.sweep(r6, childAB.game)
		expect(await e2e.rep(AB, ledger)).toBe(0n)
		expect(supplyAB - (await e2e.supply(AB))).toBe(burnAB + residualAB)
		// Nothing is left behind in the intermediate universes' reporter custody.
		expect(await e2e.rep(U0, ledger)).toBe(0n)
		expect(await e2e.rep(A, ledger)).toBe(0n)

		// ---- shares follow the same path ----
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, U0, outcome, [YES])
		for (const outcome of OUTCOMES) await e2e.migrateShares(trader, A, outcome, [YES, NO])
		const gotAA = await e2e.redeemShares(trader, childAA.pool)
		const gotAB = await e2e.redeemShares(trader, childAB.pool)
		expect(gotAA.cash).toBe(sealedCash)
		expect(gotAB.cash).toBe(0n)
		expect(await e2e.cash(engine)).toBe(0n)
		expect(await e2e.shareBalance(trader.account.address, AA, YES)).toBe(0n)
		expect(await e2e.shareBalance(trader.account.address, AB, NO)).toBe(0n)
		expect(await e2e.rep(AA, engine)).toBe(0n)
		expect(await e2e.rep(AB, engine)).toBe(0n)
	})

	test('the claim mirror caps rewards at one and a half times binding capital', () => {
		// 100 winning REP against 40 binding: the first 60 REP share a 24 REP bonus and 16 REP burn.
		expect(expectedWinningClaim(30n, 30n, 40n, 100n)).toEqual({ payout: 42n, burn: 8n })
		expect(expectedWinningClaim(40n, 70n, 40n, 100n)).toEqual({ payout: 52n, burn: 8n })
		expect(expectedWinningClaim(30n, 100n, 40n, 100n)).toEqual({ payout: 30n, burn: 0n })
		expect(median([5n, 9n, 7n])).toBe(7n)
	})
})
