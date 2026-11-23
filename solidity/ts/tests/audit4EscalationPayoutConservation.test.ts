import { describe, expect, test } from 'bun:test'
import { statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier as verifierArtifact, statoblast_factories_EscalationGameFactory_EscalationGameFactory as factoryArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, expectedWinningClaim, INVALID, median, NO, YES } from './auditE2EHarness'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const K = 1_000n * unit

/** Mirror of `computeAllocatedWinningWithdrawal`, including the reduced-threshold scaling of the payout. */
const scaledClaim = (amount: bigint, cumulative: bigint, binding: bigint, winningBalance: bigint, forkThreshold: bigint, nonDecisionThreshold: bigint) => {
	const { payout, burn } = expectedWinningClaim(amount, cumulative, binding, winningBalance)
	return { payout: forkThreshold < nonDecisionThreshold ? (payout * forkThreshold) / nonDecisionThreshold : payout, burn }
}

// Audit pass 4, target 2: winner payouts, the two-fifths burn and the residual always add up
// to the escrow, for every way of splitting the winning side, for a three-way contest that
// Invalid wins in a continuation, and when the fork threshold has fallen below the game's
// non-decision threshold.
describe('audit4: escalation payouts conserve escrow under every threshold relation', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	test('the verifier never allocates more than winning principal plus binding capital', async () => {
		const owner = fixture.owner()
		const pool = fixture.poolFor(fixture.base.questionId).questionLedger
		const factory = await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGameFactory' })
		const verifier = { abi: verifierArtifact.abi, address: await owner.readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'proofVerifier' }) }
		let seed = 0x9e3779b9n
		const next = (bound: bigint) => {
			seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n
			return (seed >> 11n) % bound
		}
		for (let round = 0; round < 40; round++) {
			const nonDecision = 2n + next(10n ** (3n + next(24n)))
			const winning = 1n + next(nonDecision)
			// Binding capital is the median: any value up to the threshold, above or below the winner in a fixed-outcome child.
			const binding = next(nonDecision + 1n)
			// Rotate through a healthy threshold, a reduced one, and exact equality.
			const thresholds = [nonDecision * 2n - next(2n), 1n + next(nonDecision), nonDecision]
			const forkThreshold = thresholds[round % 3] ?? nonDecision
			const parts = 1 + Number(next(7n))
			const cuts = new Set<bigint>([winning])
			for (let index = 1; index < parts; index++) cuts.add(1n + next(winning))
			const ends = [...cuts].sort((left, right) => (left < right ? -1 : 1))
			let start = 0n
			let paid = 0n
			let burned = 0n
			let ordinaryPaid = 0n
			let ordinaryBurned = 0n
			for (const end of ends) {
				const amount = end - start
				const [payout, burn] = await owner.readContract({ ...verifier, functionName: 'computeAllocatedWinningWithdrawal', args: [amount, amount, end, binding, winning, forkThreshold, nonDecision] })
				expect({ payout, burn }).toEqual(scaledClaim(amount, end, binding, winning, forkThreshold, nonDecision))
				if (forkThreshold >= nonDecision) expect(payout).toBeGreaterThanOrEqual(amount)
				const [ordinaryPayout, ordinaryBurn] = await owner.readContract({ ...verifier, functionName: 'computeOrdinaryWinningWithdrawal', args: [amount, end, binding, winning, forkThreshold, nonDecision] })
				paid += payout
				burned += burn
				ordinaryPaid += ordinaryPayout
				ordinaryBurned += ordinaryBurn
				start = end
			}
			const [wholePayout, wholeBurn] = await owner.readContract({ ...verifier, functionName: 'computeAllocatedWinningWithdrawal', args: [winning, winning, winning, binding, winning, forkThreshold, nonDecision] })
			const context = `round ${round}: winning ${winning}, binding ${binding}, fork ${forkThreshold}, non-decision ${nonDecision}, parts ${ends.length}`
			// Ordinary claims telescope to the reserve exactly.
			expect(ordinaryPaid, context).toBe(wholePayout)
			expect(ordinaryBurned, context).toBe(wholeBurn)
			// Continuation claims floor individually (bonus, then scaling): never more than the whole, short by at most two units per claim.
			expect(paid, context).toBeLessThanOrEqual(wholePayout)
			expect(wholePayout - paid, context).toBeLessThanOrEqual(2n * BigInt(ends.length))
			expect(burned, context).toBeLessThanOrEqual(wholeBurn)
			expect(wholeBurn - burned, context).toBeLessThanOrEqual(BigInt(ends.length))
			expect(wholePayout + wholeBurn, context).toBeLessThanOrEqual(winning + binding)
			if (forkThreshold < nonDecision) expect(wholePayout, context).toBeLessThanOrEqual(((winning + (binding * 3n) / 5n) * forkThreshold) / nonDecision)
		}
	})

	test('Invalid wins a three-way contest in a continuation, and a threshold that falls mid-claim does not change later payouts', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const plan: readonly (readonly [WriteClient, number, bigint])[] = [
			[r2, YES, 70n * K],
			[r3, NO, 50n * K],
			[r4, INVALID, 40n * K],
		]
		for (const [sender, outcome, amount] of plan) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		// All three outcomes hold at least 40k, so 40k left custody as surplus: Invalid's whole inherited principal.
		expect(await e2e.gameBalance(game0)).toBe(120n * K)
		await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('audit4 conservation: unrelated fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const child = await e2e.materialize(source, A)
		const everyone = [fixture.owner(), fixture.other(), r2, r3, r4, r5, r6]
		for (const holder of everyone) {
			const balance = await e2e.rep(U0, holder.account.address)
			if (balance > 0n) await e2e.migrateWalletRep(holder, U0, balance, [YES])
		}
		expect(await e2e.deposit(r4, child.pool, INVALID, 50n * K)).toBe(50n * K)
		expect(await e2e.deposit(r5, child.pool, INVALID, 40n * K)).toBe(40n * K)
		expect(await e2e.deposit(r3, child.pool, NO, 15n * K)).toBe(15n * K)
		const balances = await e2e.balances(child.game)
		expect(balances).toEqual([130n * K, 70n * K, 65n * K])
		const binding = median(balances)
		const backing = 120n * K + 105n * K
		expect(await e2e.gameBalance(child.game)).toBe(backing)
		const g = e2e.game(child.game)
		const end = await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + 1n)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(INVALID))
		const nonDecision = await owner.readContract({ ...g, functionName: 'nonDecisionThresholdAttoRep' })
		const threshold = () => owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [A] })
		const burnWallet = (sender: WriteClient, amount: bigint) => writeContractAndWait(sender, () => sender.writeContract({ ...e2e.zoltar(), functionName: 'burnRep', args: [A, amount], gas: BRANCH_GAS }))
		const inherited = await e2e.lineageLeaves([game0], INVALID)
		const local = await e2e.localLeaves(child.game, INVALID)
		const [first] = inherited
		const [second, third] = local
		if (first === undefined || second === undefined || third === undefined) throw new Error('Missing Invalid leaves')
		const supplyStart = await e2e.supply(A)
		let externalBurn = 0n
		let paid = 0n
		let burned = 0n

		// 1. Healthy threshold: the inherited leaf, whose principal already left as surplus, is paid in full.
		// The last deposit recorded the threshold every claim of this game is scaled by.
		const frozen = await threshold()
		expect(frozen).toBeGreaterThanOrEqual(nonDecision)
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(frozen)
		const tree = new SparseNullifierTree()
		const firstExpected = scaledClaim(first.amount, first.cumulative, binding, balances[INVALID], await threshold(), nonDecision)
		expect(firstExpected.payout).toBe(40n * K + 16n * K)
		expect(await e2e.claimInherited(r6, child.pool, INVALID, inherited, [first], tree)).toBe(firstExpected.payout)
		paid += firstExpected.payout
		burned += firstExpected.burn
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(frozen)

		// 2. Holders burn until the universe's fork threshold is below the game's non-decision threshold.
		for (const holder of everyone) {
			if ((await threshold()) < nonDecision) break
			const balance = await e2e.rep(A, holder.account.address)
			const keep = holder.account.address === r6.account.address ? 10n * K : 0n
			if (balance <= keep) continue
			await burnWallet(holder, balance - keep)
			externalBurn += balance - keep
		}
		const reduced = await threshold()
		expect(reduced).toBeLessThan(nonDecision)
		const secondExpected = scaledClaim(second.amount, second.cumulative, binding, balances[INVALID], frozen, nonDecision)
		expect(secondExpected.payout).toBeGreaterThan(scaledClaim(second.amount, second.cumulative, binding, balances[INVALID], reduced, nonDecision).payout)
		expect(await e2e.claimLocal(r6, child.pool, INVALID, [second.localIndex], second.depositor)).toBe(secondExpected.payout)
		paid += secondExpected.payout
		burned += secondExpected.burn
		// The claim's own haircut burn lowered the live threshold, which no longer matters to this game.
		expect(await threshold()).toBeLessThan(reduced)

		// 3. A third party burns between two claims of the same game: the later claimant is paid the same.
		await burnWallet(r6, 5n * K)
		externalBurn += 5n * K
		const thirdExpected = scaledClaim(third.amount, third.cumulative, binding, balances[INVALID], frozen, nonDecision)
		expect(await e2e.claimLocal(r6, child.pool, INVALID, [third.localIndex], third.depositor)).toBe(thirdExpected.payout)
		paid += thirdExpected.payout
		burned += thirdExpected.burn

		// 4. What the winners are not owed is neither stuck nor paid twice: it burns in the terminal sweep.
		expect(await e2e.gameBalance(child.game)).toBe(backing - paid - burned)
		await expect(owner.simulateContract({ ...g, functionName: 'sweepResidualRepToQuestionLedger' })).rejects.toThrow('Principal remains')
		expect(await e2e.claimLocal(r6, child.pool, NO, [0n], r3.account.address)).toBe(0n)
		const residual = await e2e.gameBalance(child.game)
		expect(residual).toBeGreaterThanOrEqual(25n * K)
		await e2e.sweep(r6, child.game)
		expect(await e2e.gameBalance(child.game)).toBe(0n)
		expect(await e2e.rep(A, ledger)).toBe(0n)
		expect(await e2e.rep(A, child.pool)).toBe(0n)
		expect(paid + burned + residual).toBe(backing)
		expect(supplyStart - (await e2e.supply(A))).toBe(externalBurn + burned + residual)
		expect(await owner.readContract({ ...g, functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
	})
})
