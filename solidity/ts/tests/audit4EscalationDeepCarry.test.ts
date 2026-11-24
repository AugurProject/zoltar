import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { SparseNullifierTree } from './carryProofHelpers'
import { BRANCH_GAS, createE2E, expectedWinningClaim, INVALID, median, NO, NONE, OUTCOMES, YES, type CarryLeaf } from './auditE2EHarness'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const K = 1_000n * unit

// Audit pass 4, target 1: carry proofs three fork generations deep, with nine and six carried
// leaves (multi-peak mountain ranges), forged proof variants, replays, and exact REP conservation
// in both great-grandchildren.
describe('audit4: carry proofs three generations deep with multi-peak mountain ranges', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const e2e = createE2E(fixture)
	type Plan = readonly (readonly [WriteClient, number, bigint])[]

	test('nine carried leaves from three ancestor games settle exactly once and conserve REP', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const U0 = base.genesisUniverse
		const source = fixture.poolFor(base.questionId).questionLedger
		const [r2, r3, r4, r5, r6] = [e2e.account(2), e2e.account(3), e2e.account(4), e2e.account(5), e2e.account(6)]
		const reporters = [r2, r3, r4, r5]
		await fixture.prepare()
		await fixture.mint(10n * unit)
		const ledger = await e2e.reporterLedger(U0)
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		const run = async (pool: Address, plan: Plan) => {
			let total = 0n
			for (const [sender, outcome, amount] of plan) {
				expect(await e2e.deposit(sender, pool, outcome, amount)).toBe(amount)
				total += amount
			}
			return total
		}
		/** Moves the whole wallet into the chosen branches of a forked universe. */
		const migrateAll = async (sender: WriteClient, universe: bigint, outcomes: number[]) => {
			const balance = await e2e.rep(universe, sender.account.address)
			if (balance > 0n) await e2e.migrateWalletRep(sender, universe, balance, outcomes)
		}
		const final = (game: Address) => owner.readContract({ ...e2e.game(game), functionName: 'getFinalQuestionResolution' })
		const endOf = (game: Address) => owner.readContract({ ...e2e.game(game), functionName: 'getEscalationGameEndDate' })
		/** Fork `universe` on an unrelated question at its earliest fork time, while `game` is still undecided. */
		const forkEarly = async (sender: WriteClient, universe: bigint, game: Address, title: string) => {
			const earliest = await owner.readContract({ ...e2e.zoltar(), functionName: 'getEarliestForkTime', args: [universe] })
			expect(earliest).toBeLessThan(await endOf(game))
			if ((await base.mockWindow.getTime()) < earliest) await base.mockWindow.setTime(earliest)
			await e2e.forkOn(sender, universe, await e2e.unrelatedQuestion(title))
			expect(await final(game)).toBe(NONE)
		}

		// ---- generation 0: nine local deposits ----
		let backing = await run(source, [
			[r2, YES, 30n * K],
			[r3, NO, 25n * K],
			[r3, YES, 40n * K],
			[r5, NO, 25n * K],
			[r4, INVALID, 5n * K],
			[r4, YES, 10n * K],
			[r6, NO, 12n * K],
			[r5, INVALID, 6n * K],
			[r2, YES, 15n * K],
		])
		const game0 = await e2e.gameOf(source)
		// The 11k minimum balance already left reporter custody as ordinary surplus.
		backing -= 11n * K
		expect(await e2e.gameBalance(game0)).toBe(backing)
		await e2e.forkOn(r6, U0, await e2e.unrelatedQuestion('audit4 deep carry: fork zero'))
		await e2e.choose(owner, U0, YES)
		const A = await e2e.activateBranch(U0, YES)
		const childA = await e2e.materialize(source, A)
		for (const reporter of [...reporters, r6]) await migrateAll(reporter, U0, [YES])

		// ---- generation 1 ----
		backing += await run(childA.pool, [
			[r5, NO, 40n * K],
			[r6, NO, 13n * K],
			[r2, YES, 30n * K],
			[r4, YES, 20n * K],
			[r3, YES, 11n * K],
			[r4, INVALID, 7n * K],
		])
		expect(await e2e.gameBalance(childA.game)).toBe(backing)
		await forkEarly(r2, A, childA.game, 'audit4 deep carry: fork one')
		await e2e.choose(owner, A, YES)
		const AA = await e2e.activateBranch(A, YES)
		const childAA = await e2e.materialize(childA.pool, AA)
		for (const reporter of [...reporters, r6]) await migrateAll(reporter, A, [YES])

		// ---- generation 2 ----
		backing += await run(childAA.pool, [
			[r2, YES, 14n * K],
			[r5, NO, 21n * K],
			[r3, YES, 16n * K],
		])
		expect(await e2e.balances(childAA.game)).toEqual([18n * K, 186n * K, 136n * K])
		expect(await e2e.gameBalance(childAA.game)).toBe(backing)
		await forkEarly(r3, AA, childAA.game, 'audit4 deep carry: fork two')
		await e2e.choose(owner, AA, YES)
		const AAA = await e2e.activateBranch(AA, YES)
		const AAB = await e2e.activateBranch(AA, NO)
		const childAAA = await e2e.materialize(childAA.pool, AAA)
		const childAAB = await e2e.materialize(childAA.pool, AAB)
		for (const child of [childAAA, childAAB]) {
			expect(await e2e.gameBalance(child.game)).toBe(backing)
			expect(await e2e.balances(child.game)).toEqual([18n * K, 186n * K, 136n * K])
		}
		expect(await e2e.rep(AAA, ledger)).toBe(backing)
		expect(await e2e.rep(AAB, ledger)).toBe(backing)

		// ---- generation 3: one more Yes report in AAA, a flip to No in AAB ----
		await e2e.migrateWalletRep(r4, AA, 17n * K, [YES])
		await e2e.migrateWalletRep(r5, AA, 60n * K, [NO])
		const backingAAA = backing + (await run(childAAA.pool, [[r4, YES, 17n * K]]))
		const backingAAB = backing + (await run(childAAB.pool, [[r5, NO, 60n * K]]))
		const endAAA = await endOf(childAAA.game)
		const endAAB = await endOf(childAAB.game)
		await base.mockWindow.setTime((endAAA > endAAB ? endAAA : endAAB) + 1n)
		expect(await final(childAAA.game)).toBe(BigInt(YES))
		expect(await final(childAAB.game)).toBe(BigInt(NO))

		const lineage = [game0, childA.game, childAA.game]
		const snapshot = { [INVALID]: await e2e.lineageLeaves(lineage, INVALID), [YES]: await e2e.lineageLeaves(lineage, YES), [NO]: await e2e.lineageLeaves(lineage, NO) }
		expect(snapshot[YES].map(leaf => leaf.game)).toEqual([game0, game0, game0, game0, childA.game, childA.game, childA.game, childAA.game, childAA.game])
		expect(snapshot[NO].length).toBe(6)
		expect(snapshot[INVALID].length).toBe(3)
		// The installed commitment is the lineage's nine-leaf range: one eight-leaf peak and one single leaf.
		const stateYes = await owner.readContract({ ...e2e.game(childAAA.game), functionName: 'getOutcomeState', args: [YES] })
		expect(stateYes.snapshotLeafCount).toBe(9n)
		expect(stateYes.currentLeafCount).toBe(10n)

		// ---- forged and misplaced proofs in AAA ----
		const yes = snapshot[YES]
		const leafAt = (leaves: readonly CarryLeaf[], index: number) => {
			const leaf = leaves[index]
			if (leaf === undefined) throw new Error(`Missing leaf ${index}`)
			return leaf
		}
		const simulate = (pool: Address, outcome: number, proofs: readonly ReturnType<typeof e2e.proofFor>[]) => owner.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [...proofs]], gas: BRANCH_GAS })
		const empty = () => new SparseNullifierTree()
		const honest = e2e.proofFor(yes, leafAt(yes, 5), empty())
		const lone = e2e.proofFor(yes, leafAt(yes, 8), empty())
		await simulate(childAAA.pool, YES, [honest])
		await simulate(childAAA.pool, YES, [lone])
		const forgeries: readonly (readonly [string, ReturnType<typeof e2e.proofFor>, string])[] = [
			['inflated amount', { ...honest, amountAttoRep: honest.amountAttoRep + 1n }, 'Bad carry proof'],
			['earlier reward coordinate', { ...honest, cumulativeAmountAttoRep: honest.cumulativeAmountAttoRep - 1n }, 'Bad carry proof'],
			['another beneficiary', { ...honest, depositor: r6.account.address }, 'Bad carry proof'],
			['another nullifier key', { ...honest, parentDepositIndex: honest.parentDepositIndex + 1n }, 'Bad carry proof'],
			['another source node', { ...honest, sourceNodeId: honest.sourceNodeId + 1n }, 'Bad carry proof'],
			['neighbouring position', { ...honest, leafIndex: 4n }, 'Bad carry proof'],
			['position in the other peak', { ...honest, leafIndex: 8n }, 'Bad carry peak'],
			['position past the range', { ...honest, leafIndex: 9n }, 'Bad carry leaf'],
			['local leaf position', { ...lone, leafIndex: 9n }, 'Bad carry leaf'],
			['wrong peak height', { ...honest, merkleMountainRangePeakIndex: 0n }, 'Bad carry peak'],
			['truncated path', { ...honest, merkleMountainRangeSiblings: honest.merkleMountainRangeSiblings.slice(0, 3) }, 'Bad MMR proof length'],
			['padded path', { ...honest, merkleMountainRangeSiblings: [...honest.merkleMountainRangeSiblings, honest.leafIndex === 5n ? leafAt(yes, 4).hash : leafAt(yes, 5).hash] }, 'Bad MMR proof length'],
			['swapped siblings', { ...honest, merkleMountainRangeSiblings: [...honest.merkleMountainRangeSiblings.slice(0, 2).reverse(), ...honest.merkleMountainRangeSiblings.slice(2)] }, 'Bad carry proof'],
			['short nullifier path', { ...honest, nullifierSiblings: honest.nullifierSiblings.slice(1) }, 'Bad nullifier length'],
			['zero amount', { ...honest, amountAttoRep: 0n }, 'Proof amount zero'],
		]
		for (const [label, proof, reason] of forgeries) await expect(simulate(childAAA.pool, YES, [proof]), label).rejects.toThrow(reason)
		// A leaf of another outcome, and a proof against the two-generation or one-generation commitment, fail.
		await expect(simulate(childAAA.pool, YES, [e2e.proofFor(snapshot[NO], leafAt(snapshot[NO], 0), empty())])).rejects.toThrow('Bad carry')
		const twoGenerations = await e2e.lineageLeaves([game0, childA.game], YES)
		await expect(simulate(childAAA.pool, YES, [e2e.proofFor(twoGenerations, leafAt(twoGenerations, 0), empty())])).rejects.toThrow('Bad carry')
		// AAA's own local deposit is not part of the inherited commitment.
		const localYes = await e2e.localLeaves(childAAA.game, YES)
		await expect(simulate(childAAA.pool, YES, [e2e.proofFor([...yes, ...localYes], leafAt(localYes, 0), empty())])).rejects.toThrow('Bad carry')
		// The same deposit twice in one transaction: the second proof meets a consumed nullifier, whichever path it brings.
		await expect(simulate(childAAA.pool, YES, [honest, honest])).rejects.toThrow('Bad nullifier proof')
		const advanced = empty()
		advanced.consume(honest.leafIndex)
		await expect(simulate(childAAA.pool, YES, [honest, { ...honest, nullifierSiblings: advanced.getProof(honest.leafIndex) }])).rejects.toThrow('Bad nullifier proof')
		// Losing outcomes never pay, here or in the sibling.
		for (const outcome of OUTCOMES) {
			if (outcome !== YES) await expect(simulate(childAAA.pool, outcome, [e2e.proofFor(snapshot[outcome], leafAt(snapshot[outcome], 0), empty())])).rejects.toThrow('Not winning outcome')
			if (outcome !== NO) await expect(simulate(childAAB.pool, outcome, [e2e.proofFor(snapshot[outcome], leafAt(snapshot[outcome], 0), empty())])).rejects.toThrow('Not winning outcome')
		}
		// Nothing is payable in any interrupted ancestor.
		for (const pool of [source, childA.pool, childAA.pool]) {
			await expect(owner.simulateContract({ abi: poolArtifact.abi, address: pool, functionName: 'withdrawFromEscalationGame', args: [YES, [0n]] })).rejects.toThrow()
			await expect(simulate(pool, YES, [honest])).rejects.toThrow()
		}

		// ---- settle AAA: nine proofs, one local claim, exact conservation ----
		const gas: bigint[] = []
		const settle = async (child: { pool: Address; game: Address; universe: bigint }, outcome: (typeof OUTCOMES)[number], startingBacking: bigint) => {
			const balances = await e2e.balances(child.game)
			const binding = median(balances)
			const winning = balances[outcome]
			if (winning === undefined) throw new Error('Missing balance')
			const supplyBefore = await e2e.supply(child.universe)
			const tree = new SparseNullifierTree()
			let paid = 0n
			let burn = 0n
			const leaves = snapshot[outcome]
			if (leaves === undefined) throw new Error('Missing leaves')
			// Newest first, one transaction per proof, so every nullifier path is rebuilt against a changed root.
			for (const leaf of [...leaves].reverse()) {
				const expected = expectedWinningClaim(leaf.amount, leaf.cumulative, binding, winning)
				const before = await e2e.rep(child.universe, leaf.depositor)
				const proof = e2e.proofFor(leaves, leaf, tree)
				const hash = await writeContractAndWait(r6, () => r6.writeContract({ abi: poolArtifact.abi, address: child.pool, functionName: 'withdrawForkedEscalationDeposits', args: [outcome, [proof]], gas: BRANCH_GAS }))
				gas.push((await r6.getTransactionReceipt({ hash })).gasUsed)
				tree.consume(leaf.leafIndex)
				expect((await e2e.rep(child.universe, leaf.depositor)) - before).toBe(expected.payout)
				paid += expected.payout
				burn += expected.burn
				expect(await e2e.gameBalance(child.game)).toBe(startingBacking - paid - burn)
				// Replays: the stale path, a fresh empty path, and the current path.
				await expect(simulate(child.pool, outcome, [proof])).rejects.toThrow('Bad nullifier proof')
				await expect(simulate(child.pool, outcome, [e2e.proofFor(leaves, leaf, empty())])).rejects.toThrow('Bad nullifier proof')
				await expect(simulate(child.pool, outcome, [e2e.proofFor(leaves, leaf, tree)])).rejects.toThrow('Bad nullifier proof')
			}
			for (const leaf of await e2e.localLeaves(child.game, outcome)) {
				const expected = expectedWinningClaim(leaf.amount, leaf.cumulative, binding, winning)
				expect(await e2e.claimLocal(r6, child.pool, outcome, [leaf.localIndex], leaf.depositor)).toBe(expected.payout)
				paid += expected.payout
				burn += expected.burn
			}
			// Losing local principal settles for nothing before the terminal sweep.
			for (const losing of OUTCOMES) {
				if (losing === outcome) continue
				for (const leaf of await e2e.localLeaves(child.game, losing)) expect(await e2e.claimLocal(r6, child.pool, losing, [leaf.localIndex], leaf.depositor)).toBe(0n)
			}
			const residual = await e2e.gameBalance(child.game)
			expect(residual).toBe(startingBacking - paid - burn)
			expect(supplyBefore - (await e2e.supply(child.universe))).toBe(burn)
			// Winners receive principal plus at most three fifths of binding capital; two fifths burn.
			expect(paid).toBeLessThanOrEqual(winning + (binding * 3n) / 5n)
			expect(winning + (binding * 3n) / 5n - paid).toBeLessThanOrEqual(BigInt(leaves.length) + 1n)
			expect(burn).toBeLessThanOrEqual((binding * 2n) / 5n)
			// The residual is exactly the losing-minimum growth since the origin (18k - 11k) plus rounding dust.
			expect(residual - 7n * K).toBeLessThanOrEqual(2n * (BigInt(leaves.length) + 1n))
			expect(residual).toBeGreaterThanOrEqual(7n * K)
			await e2e.sweep(r6, child.game)
			expect(await e2e.gameBalance(child.game)).toBe(0n)
			expect(await e2e.rep(child.universe, ledger)).toBe(0n)
			expect(await e2e.rep(child.universe, child.pool)).toBe(0n)
			expect(supplyBefore - (await e2e.supply(child.universe))).toBe(burn + residual)
			expect(await owner.readContract({ ...e2e.game(child.game), functionName: 'totalDisputeStakedAttoRep' })).toBe(0n)
			return { paid, burn, residual }
		}
		const settledAAA = await settle(childAAA, YES, backingAAA)
		const settledAAB = await settle(childAAB, NO, backingAAB)
		expect(settledAAA.paid + settledAAA.burn + settledAAA.residual).toBe(backingAAA)
		expect(settledAAB.paid + settledAAB.burn + settledAAB.residual).toBe(backingAAB)
		// One carried claim costs about two million gas wherever its leaf sits; depth adds one hash per level.
		const highest = gas.reduce((max, used) => (used > max ? used : max), 0n)
		console.log(`audit4 three-generation carried claim gas: ${gas.join(', ')}`)
		expect(highest).toBeLessThan(2_500_000n)
		// No ancestor universe retains reporter REP.
		for (const universe of [U0, A, AA]) expect(await e2e.rep(universe, ledger)).toBe(0n)
	})
})
