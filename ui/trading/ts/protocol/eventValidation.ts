import { assertQuestionCreatedEvent, type QuestionIdentityData } from '@zoltar/shared/questionId'
import { getChildUniverseId } from '@zoltar/shared/universeId'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'

export function assertQuestionCreatedId(questionData: QuestionIdentityData, outcomeOptions: readonly string[], questionId: bigint, createdTimestamp: bigint) {
	assertQuestionCreatedEvent(questionData, outcomeOptions, questionId, createdTimestamp)
}

export function assertDeployChildId(universeId: bigint, outcomeIndex: bigint, childUniverseId: bigint) {
	if (getChildUniverseId(universeId, outcomeIndex) !== childUniverseId) throw new Error('DeployChild event has a mismatched deterministic child universe ID')
}

export function assertDeployChildRoute(parentUniverseId: bigint, forkingOutcomeIndex: bigint, reputationToken: Address, eventUniverseId: bigint, eventOutcomeIndex: bigint, eventReputationToken: Address) {
	if (parentUniverseId !== eventUniverseId || forkingOutcomeIndex !== eventOutcomeIndex) throw new Error('Deployed child universe does not match its DeployChild route')
	if (reputationToken === zeroAddress || eventReputationToken === zeroAddress || getAddress(reputationToken) !== getAddress(eventReputationToken)) throw new Error('Deployed child universe does not match its DeployChild reputation token')
}
