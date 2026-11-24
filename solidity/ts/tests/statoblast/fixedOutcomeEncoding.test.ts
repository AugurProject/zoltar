import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact } from '../../types/contractArtifact'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { createE2E, BRANCH_GAS } from '../auditE2EHarness'
import { useSecurityPoolFixture } from './securityPoolFixture'

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
})
