import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact } from '../../types/contractArtifact'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { createE2E, BRANCH_GAS, YES, NO } from '../auditE2EHarness'
import { useSecurityPoolFixture, unit } from './securityPoolFixture'

describe('fixed fork outcome leaf encoding (#1538)', () => {
	const fixture = useSecurityPoolFixture()
	const e2e = createE2E(fixture)
	test('absence differs from Invalid and high-bit scalar outcomes survive sibling preparation', async () => {
		const client = fixture.owner()
		const source = fixture.base.genesisUniverse
		const ticks = (1n << 120n) - 1n
		const scalar = { ...makeQuestion('Scalar fixed leaf #1538'), numTicks: ticks, displayValueMax: ticks }
		await createQuestion(client, scalar, [])
		const question = getQuestionId(scalar, [])
		const address = await client.readContract({ abi: poolArtifact.abi, address: fixture.securityPool, functionName: 'forkController' })
		const target = { abi: forkArtifact.abi, address }
		await e2e.forkOn(client, source, question)
		const outcomes = [0n, (1n << 255n) | (ticks << 120n)]
		for (const outcome of outcomes) {
			const child = getChildUniverseId(source, outcome)
			expect(await client.readContract({ ...target, functionName: 'inheritedFixedOutcome', args: [child, question] })).toEqual([false, 0n])
			await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'prepareBranch', args: [source, outcome], gas: BRANCH_GAS }))
			await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'prepareBranch', args: [source, outcome], gas: BRANCH_GAS }))
		}
		for (const outcome of outcomes) expect(await client.readContract({ ...target, functionName: 'inheritedFixedOutcome', args: [getChildUniverseId(source, outcome), question] })).toEqual([true, outcome])
	})
	for (const first of [0, YES, NO])
		test('repeated forks retain the original outcome ' + first, async () => {
			const owner = fixture.owner(),
				reporter = e2e.account(6),
				base = fixture.base,
				q = base.questionId,
				source = base.genesisUniverse
			await fixture.prepare()
			await fixture.mint(10n * unit)
			await base.mockWindow.setTime(base.questionData.endTime + 1n)
			const fork0 = await e2e.forkOn(reporter, source, q)
			await e2e.choose(owner, source, first)
			await base.mockWindow.setTime(fork0 + 70n * 86400n)
			const child = await e2e.activateBranch(source, first)
			const [logic, wall] = await owner.readContract({ abi: poolArtifact.abi, address: fixture.securityPool, functionName: 'clocks', args: [child] })
			const target = {
				abi: forkArtifact.abi,
				address: await owner.readContract({ abi: poolArtifact.abi, address: fixture.securityPool, functionName: 'forkController' }),
			}
			for (const offset of [1, 0, -1, 75, 40 * 86400]) {
				const t = Number(wall) + offset
				const translated = await owner.readContract({ ...target, functionName: 'securityPoolTimeForNative', args: [child, t] })
				expect(BigInt(translated)).toBe(BigInt(logic) + BigInt(Math.max(0, offset)))
				const native = await owner.readContract({ ...target, functionName: 'nativeTimeForSecurityPoolTime', args: [child, translated] })
				expect(BigInt(native)).toBe(BigInt(wall) + BigInt(Math.max(0, offset)))
			}
			await e2e.migrateWalletRep(reporter, source, 700_000n * unit, [first])
			await base.mockWindow.setTime((await e2e.activationTime(child)) + 86400n)
			await e2e.forkOn(reporter, child, q)
			for (const next of [0, YES, NO]) {
				const grand = getChildUniverseId(child, next)
				expect(await owner.readContract({ ...target, functionName: 'inheritedFixedOutcome', args: [grand, q] })).toEqual([false, 0n])
				await writeContractAndWait(owner, () => owner.writeContract({ ...target, functionName: 'prepareBranch', args: [child, BigInt(next)], gas: BRANCH_GAS }))
				expect(await owner.readContract({ ...target, functionName: 'inheritedFixedOutcome', args: [grand, q] })).toEqual([true, BigInt(first)])
			}
			expect(await owner.readContract({ ...target, functionName: 'inheritedFixedOutcome', args: [child, q] })).toEqual([true, BigInt(first)])
		})
})
