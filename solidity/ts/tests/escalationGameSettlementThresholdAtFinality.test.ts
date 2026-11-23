import { describe, expect, test } from 'bun:test'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { getRepTokenAddress, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, expectedWinningClaim, INVALID, median, NO, YES } from './auditE2EHarness'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const K = 1_000n * unit

// Winning claims scale by the fork threshold recorded when the game last changed. REP burned
// after that, while the game is final but before anyone claims, cannot lower any payout.
describe('escalation game: the settlement fork threshold is fixed before finality', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)

	const burnUntilBelow = async (universe: bigint, holders: readonly WriteClient[], nonDecision: bigint, keepFor?: WriteClient) => {
		const owner = fixture.owner()
		const threshold = () => owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [universe] })
		for (const holder of holders) {
			if ((await threshold()) < nonDecision) break
			const balance = await e2e.rep(universe, holder.account.address)
			const keep = holder.account.address === keepFor?.account.address ? 10n * K : 0n
			if (balance <= keep) continue
			await approveToken(holder, getRepTokenAddress(universe), getZoltarAddress())
			await writeContractAndWait(holder, () => holder.writeContract({ ...e2e.zoltar(), functionName: 'burnRep', args: [universe, balance - keep], gas: BRANCH_GAS }))
		}
		const reduced = await threshold()
		expect(reduced).toBeLessThan(nonDecision)
		return reduced
	}

	test('#1439: delayed materialization after a second fork preserves final winner entitlement', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		for (const [sender, outcome, amount] of [
			[r2, YES, 70n * K],
			[r3, NO, 50n * K],
			[r4, INVALID, 40n * K],
		] as const)
			await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		const end0 = await owner.readContract({ ...e2e.game(game0), functionName: 'getEscalationGameEndDate' })
		const fork0 = await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('delayed settlement threshold origin fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const everyone = [owner, fixture.other(), r2, r3, r4, r5, r6]
		for (const holder of everyone) {
			const balance = await e2e.rep(U0, holder.account.address)
			if (balance > 0n) await e2e.migrateWalletRep(holder, U0, balance, [YES])
		}
		await base.mockWindow.setTime(fork0 + 9n * 7n * 24n * 3600n + (end0 - fork0) + 1n)
		await e2e.forkOn(r6, A, await e2e.unrelatedQuestion('delayed settlement threshold second fork'))
		for (const holder of everyone) {
			const balance = await e2e.rep(A, holder.account.address)
			if (balance === 0n) continue
			await approveToken(holder, getRepTokenAddress(A), getZoltarAddress())
			await writeContractAndWait(holder, () => holder.writeContract({ ...e2e.zoltar(), functionName: 'addRepToMigrationBalance', args: [A, balance], gas: BRANCH_GAS }))
		}
		const child = await e2e.materialize(source, A)
		const game = e2e.game(child.game)
		const threshold = await owner.readContract({ ...game, functionName: 'nonDecisionThresholdAttoRep' })
		expect(await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [A] })).toBeLessThan(threshold)
		expect(await owner.readContract({ ...game, functionName: 'settlementForkThresholdAttoRep' })).toBeGreaterThanOrEqual(threshold)
		const inherited = await e2e.lineageLeaves([game0], YES)
		const first = inherited[0]
		if (first === undefined) throw new Error('Missing winner leaf')
		const expected = expectedWinningClaim(first.amount, first.cumulative, 50n * K, 70n * K).payout
		expect(await e2e.claimInherited(r5, child.pool, YES, inherited, [first], new SparseNullifierTree())).toBe(expected)
	})

	test('a continued game pays its entitlement at finality when REP is burned before the first claim', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const plan: readonly (readonly [WriteClient, number, bigint])[] = [
			[r2, YES, 70n * K],
			[r3, NO, 50n * K],
			[r4, INVALID, 40n * K],
		]
		for (const [sender, outcome, amount] of plan) await e2e.deposit(sender, source, outcome, amount)
		const game0 = await e2e.gameOf(source)
		await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('settlement threshold: unrelated fork'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const child = await e2e.materialize(source, A)
		const everyone = [fixture.owner(), fixture.other(), r2, r3, r4, r5, r6]
		for (const holder of everyone) {
			const balance = await e2e.rep(U0, holder.account.address)
			if (balance > 0n) await e2e.migrateWalletRep(holder, U0, balance, [YES])
		}
		const g = e2e.game(child.game)
		const healthy = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [A] })
		// Resuming the continuation already recorded the child's threshold.
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)
		expect(await e2e.deposit(r4, child.pool, INVALID, 50n * K)).toBe(50n * K)
		expect(await e2e.deposit(r5, child.pool, INVALID, 40n * K)).toBe(40n * K)
		expect(await e2e.deposit(r3, child.pool, NO, 15n * K)).toBe(15n * K)
		const balances = await e2e.balances(child.game)
		expect(balances).toEqual([130n * K, 70n * K, 65n * K])
		const binding = median(balances)
		const end = await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + 1n)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(INVALID))
		const nonDecision = await owner.readContract({ ...g, functionName: 'nonDecisionThresholdAttoRep' })
		expect(healthy).toBeGreaterThanOrEqual(nonDecision)
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)
		const inherited = await e2e.lineageLeaves([game0], INVALID)
		const [first] = inherited
		const [second] = await e2e.localLeaves(child.game, INVALID)
		if (first === undefined || second === undefined) throw new Error('Missing Invalid leaves')

		// The game is final and nobody has claimed: holders burn child REP until the live threshold is below non-decision.
		const reduced = await burnUntilBelow(A, everyone, nonDecision, r6)
		expect(reduced).toBeLessThan(healthy)
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)

		const firstEntitlement = expectedWinningClaim(first.amount, first.cumulative, binding, balances[INVALID]).payout
		expect(firstEntitlement).toBe(56n * K)
		expect(await e2e.claimInherited(r6, child.pool, INVALID, inherited, [first], new SparseNullifierTree())).toBe(firstEntitlement)
		const secondEntitlement = expectedWinningClaim(second.amount, second.cumulative, binding, balances[INVALID]).payout
		expect(secondEntitlement).toBe(70n * K)
		expect(await e2e.claimLocal(r6, child.pool, INVALID, [second.localIndex], second.depositor)).toBe(secondEntitlement)
	})

	test('a direct game deposit records the settlement fork threshold like a pool deposit', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r5] = [e2e.account(2), e2e.account(3), e2e.account(5)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await e2e.deposit(r2, source, YES, 70n * K)
		await e2e.deposit(r3, source, NO, 50n * K)
		const g = e2e.game(await e2e.gameOf(source))
		const threshold = () => owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		const healthy = await threshold()
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)

		// Burning REP while the game is open lowers the live threshold; the next accepted deposit must record it.
		const burned = (await e2e.rep(U0, r5.account.address)) / 2n
		await approveToken(r5, getRepTokenAddress(U0), getZoltarAddress())
		await writeContractAndWait(r5, () => r5.writeContract({ ...e2e.zoltar(), functionName: 'burnRep', args: [U0, burned], gas: BRANCH_GAS }))
		const reduced = await threshold()
		expect(reduced).toBeLessThan(healthy)
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)

		await approveToken(r3, getRepTokenAddress(U0), g.address)
		await writeContractAndWait(r3, () => r3.writeContract({ ...g, functionName: 'depositRepOnOutcome', args: [NO, 30n * K], gas: BRANCH_GAS }))
		expect(await e2e.balances(g.address)).toEqual([0n, 70n * K, 80n * K])
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(reduced)
	})

	test('an ordinary game pays its entitlement at finality when REP is burned before settlement', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await e2e.deposit(r2, source, YES, 70n * K)
		await e2e.deposit(r3, source, NO, 50n * K)
		const g = e2e.game(await e2e.gameOf(source))
		const healthy = await owner.readContract({ ...e2e.zoltar(), functionName: 'getForkThresholdAttoRep', args: [U0] })
		expect(await owner.readContract({ ...g, functionName: 'settlementForkThresholdAttoRep' })).toBe(healthy)
		const balances = await e2e.balances(g.address)
		const end = await owner.readContract({ ...g, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + 1n)
		expect(await owner.readContract({ ...g, functionName: 'getFinalQuestionResolution' })).toBe(BigInt(YES))
		const nonDecision = await owner.readContract({ ...g, functionName: 'nonDecisionThresholdAttoRep' })

		await burnUntilBelow(U0, [fixture.owner(), fixture.other(), r4, r5, r6, r3], nonDecision)
		await writeContractAndWait(owner, () => owner.writeContract({ ...g, functionName: 'settleOrdinaryGame', gas: BRANCH_GAS }))
		const [winner] = await e2e.localLeaves(g.address, YES)
		if (winner === undefined) throw new Error('Missing Yes leaf')
		const entitlement = expectedWinningClaim(winner.amount, winner.cumulative, median(balances), balances[YES]).payout
		expect(entitlement).toBeGreaterThan(winner.amount)
		expect(await e2e.claimLocal(r2, source, YES, [winner.localIndex], winner.depositor)).toBe(entitlement)
	})
})
