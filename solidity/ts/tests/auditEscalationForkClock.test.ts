import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { approveToken, sortStringArrayByKeccak } from '../testSupport/simulator/utils/utilities'
import { readIterativeAttritionCost } from '../testSupport/simulator/utils/contracts/escalationGame'
import { createQuestion, makeQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'
import { useEscalationGameFixture } from './escalationGame/fixture'

const DAY = 24n * 60n * 60n

describe('Audit regression: escalation fork clock', () => {
	const fixture = useEscalationGameFixture()

	test.each([{ inheritedElapsed: 0n }, { inheritedElapsed: DAY }])('resuming after the universe fork preserves inherited elapsed time $inheritedElapsed', async ({ inheritedElapsed }) => {
		const { client, mockWindow, reportBond, nonDecisionThresholdAttoRep } = fixture
		const { escalationGameAddress } = await fixture.deployEscalationGameWithProofPool()
		await fixture.startEscalationFromFork(escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, inheritedElapsed)
		const expectedCost = inheritedElapsed === 0n ? 0n : await readIterativeAttritionCost(client, escalationGameAddress, inheritedElapsed)
		const readCost = () => client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'totalCostAttoRep' })

		const question = makeQuestion('fork before escalation continuation resumes')
		const outcomes = sortStringArrayByKeccak(['Yes', 'No'])
		await createQuestion(client, question, outcomes)
		await approveToken(client, getRepTokenAddress(0n), getZoltarAddress())
		await forkUniverse(client, 0n, getQuestionId(question, outcomes))
		const forkTime = (await getUniverseData(client, 0n)).forkTime
		assert.strictEqual(await readCost(), expectedCost, 'a pending continuation must retain its inherited cost')

		await mockWindow.setTime(forkTime + DAY)
		await fixture.resumeEscalationFromFork(escalationGameAddress)
		const resumedAt = await client.readContract({ abi: statoblast_EscalationGame_EscalationGame.abi, address: escalationGameAddress, functionName: 'forkResumedAt' })
		assert.ok(resumedAt > forkTime, 'the continuation must resume after its universe already forked')
		assert.strictEqual(await readCost(), expectedCost, 'a fork before resume must add no elapsed time and must not underflow')

		await mockWindow.setTime(resumedAt + DAY)
		assert.strictEqual(await readCost(), expectedCost, 'later wall-clock time must not restart the interrupted escalation clock')
	})
})
