import { encodeDeployData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openArtifact, statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact, statoblast_SecurityPool_SecurityPool as securityPoolArtifact } from '../contractArtifact.js'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { verifyRuntimeCode, type SecurityPoolTransaction } from './securityPool.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { requireBigintValue } from './decoders.js'

const admissionAbi = parseAbi(['function universeId() view returns (uint248)', 'function isQuestionAllowed(address securityPool,uint248 universeId,uint256 questionId) view returns (bool)', 'function questionCount() view returns (uint256)', 'function getQuestions(uint256 start,uint256 count) view returns (uint256[])'])
export type SecurityPoolAdmission = { address: Address; mode: 'open' | 'custom' } | { address: Address; mode: 'fixed'; questions: readonly bigint[]; questionCount: bigint; questionStart: bigint }

// Leave headroom under the per-transaction gas cap even when all IDs use 32 bytes.
const maxFixedAdmissionQuestions = 700

export function requireFixedAdmissionQuestionLimit(count: number) {
	if (count > maxFixedAdmissionQuestions) throw new Error(`A fixed admission policy supports up to ${maxFixedAdmissionQuestions} approved questions per deployment.`)
}

/** Classify known open and fixed-list policies from runtime code. */
export function identifySecurityPoolAdmission(code: Awaited<ReturnType<ReadClient['getCode']>>) {
	if (code === `0x${openArtifact.evm.deployedBytecode.object}`) return 'open'
	try {
		verifyRuntimeCode(code, `0x${fixedArtifact.evm.deployedBytecode.object}`, fixedArtifact.evm.deployedBytecode.immutableReferences, 'fixed question policy')
		return 'fixed'
	} catch (failure) {
		if (!(failure instanceof Error) || (failure.message !== 'Unrecognized fixed question policy runtime code.' && failure.message !== 'Inconsistent fixed question policy immutable values.')) throw failure
		return 'custom'
	}
}

/** Curation is based on deployed bytecode, never an untrusted policy's self-description. */
export async function loadSecurityPoolAdmission(client: Pick<ReadClient, 'getCode' | 'readContract'>, address: Address, universeId: bigint, blockNumber?: bigint, questionStart = 0n): Promise<SecurityPoolAdmission> {
	const mode = identifySecurityPoolAdmission(await client.getCode({ address, blockNumber }))
	if (mode !== 'fixed') return { address, mode }
	const policyUniverse = await client.readContract({ address, abi: admissionAbi, functionName: 'universeId', blockNumber })
	if (policyUniverse !== universeId) return { address, mode: 'custom' }
	const questionCount = await client.readContract({ address, abi: admissionAbi, functionName: 'questionCount', blockNumber })
	if (typeof questionCount !== 'bigint' || questionCount < 0n) throw new Error('Invalid approved question count.')
	const start = questionStart > questionCount ? 0n : questionStart
	const remaining = questionCount - start
	const questions = await client.readContract({ address, abi: admissionAbi, functionName: 'getQuestions', args: [start, remaining < 64n ? remaining : 64n], blockNumber })
	if (!Array.isArray(questions) || questions.some(id => typeof id !== 'bigint')) throw new Error('Invalid approved question page.')
	const approved = questions.map(id => {
		if (typeof id !== 'bigint') throw new Error('Invalid approved question ID.')
		return id
	})
	return { address, mode: 'fixed', questions: approved, questionCount, questionStart: start }
}

export function securityPoolAdmissionCreationRequest(owner: Address, mode: 'open' | 'fixed', universeId: bigint, questionIds: readonly bigint[]): SecurityPoolTransaction {
	if (mode === 'open') return { account: owner, value: 0n, data: encodeDeployData({ abi: openArtifact.abi, bytecode: `0x${openArtifact.evm.bytecode.object}` }), reviewDescription: 'Deploy an immutable open admission policy. Anyone may add eligible questions to security pools using this policy.' }
	requireFixedAdmissionQuestionLimit(questionIds.length)
	if (questionIds.length === 0) throw new Error('Choose at least one approved question.')
	if (questionIds.some((id, index) => id < 0n || id >= 1n << 256n || (index > 0 && id <= (questionIds[index - 1] ?? id)))) throw new Error('Choose increasing unique question IDs.')
	return {
		account: owner,
		value: 0n,
		data: encodeDeployData({ abi: fixedArtifact.abi, bytecode: `0x${fixedArtifact.evm.bytecode.object}`, args: [universeId, questionIds] }),
		reviewDescription: `Deploy a permanently fixed admission policy for universe ${universeId}. Only these question IDs may be backed: ${questionIds.map(id => `0x${id.toString(16)}`).join(', ')}. Nobody can change the list.`,
	}
}

/**
 * Mirrors the security pool's registration window: the question must still be open and end within the security pool horizon at `inclusionTimestamp`, reading state at `blockNumber`.
 * The contract reads end dates from the factory's immutable ZoltarQuestionData, which is the deterministic Zoltar deployment's.
 */
export async function requireSecurityPoolQuestionHorizon(client: Pick<ReadClient, 'readContract'>, securityPool: Address, questionId: bigint, blockNumber: bigint | undefined, inclusionTimestamp: bigint) {
	const [horizonValue, endValue] = await Promise.all([
		client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'maximumQuestionHorizonSeconds', blockNumber }),
		client.readContract({ address: getZoltarContractAddresses().zoltarQuestionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', args: [questionId], blockNumber }),
	])
	const horizon = requireBigintValue(horizonValue, 'security pool question horizon')
	const end = requireBigintValue(endValue, 'question end time')
	if (end === 0n) throw new Error('This question does not exist.')
	if (end <= inclusionTimestamp) throw new Error('This question has ended and can no longer be registered.')
	if (end - inclusionTimestamp > horizon) throw new Error(`This question ends after the security pool's ${horizon % 86_400n === 0n ? `${horizon / 86_400n}-day` : `${horizon}-second`} question horizon.`)
}

export async function requireSecurityPoolQuestionAdmission(client: Pick<ReadClient, 'readContract'>, policy: Address, securityPool: Address, universeId: bigint, questionId: bigint, blockNumber?: bigint) {
	if ((await client.readContract({ address: policy, abi: admissionAbi, functionName: 'isQuestionAllowed', args: [securityPool, universeId, questionId], blockNumber })) !== true) throw new Error('This question is not allowed by the security pool admission policy.')
}

/** Checks the factory's binary question shape and minimum escalation headroom at one block. */
export async function requireSecurityPoolQuestionEligibility(client: Pick<ReadClient, 'readContract'>, universeId: bigint, questionId: bigint, blockNumber?: bigint) {
	const addresses = getZoltarContractAddresses()
	const [labels, thresholdValue, supplyValue] = await Promise.all([
		client.readContract({ address: addresses.zoltarQuestionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getOutcomeLabels', args: [questionId, 0n, 3n], blockNumber }),
		client.readContract({ address: addresses.zoltar, abi: Zoltar_Zoltar.abi, functionName: 'getNonDecisionThresholdAttoRep', args: [universeId], blockNumber }),
		client.readContract({ address: addresses.zoltar, abi: Zoltar_Zoltar.abi, functionName: 'getUniverseTheoreticalSupplyAttoRep', args: [universeId], blockNumber }),
	])
	if (!Array.isArray(labels) || labels.length !== 2 || labels[0] !== 'Yes' || labels[1] !== 'No') throw new Error('Registration supports only Yes/No binary questions.')
	const threshold = requireBigintValue(thresholdValue, 'non-decision threshold')
	const supply = requireBigintValue(supplyValue, 'universe theoretical REP supply')
	const supplyBasedDeposit = supply / 10_000_000n
	const initialDeposit = supplyBasedDeposit < 10n ** 18n ? 10n ** 18n : supplyBasedDeposit
	if (threshold <= initialDeposit) throw new Error('The universe escalation threshold is too low to register a question.')
}
