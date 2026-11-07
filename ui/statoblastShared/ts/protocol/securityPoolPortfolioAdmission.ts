import { encodeDeployData, parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openArtifact, statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact } from '../contractArtifact.js'
import { verifyRuntimeCode, type PortfolioTransaction } from './securityPoolPortfolio.js'

const admissionAbi = parseAbi(['function universeId() view returns (uint248)', 'function isQuestionAllowed(address portfolio,uint248 universeId,uint256 questionId) view returns (bool)', 'function questionCount() view returns (uint256)', 'function getQuestions(uint256 start,uint256 count) view returns (uint256[])'])
export type PortfolioAdmission = { address: Address; mode: 'open' | 'custom' } | { address: Address; mode: 'fixed'; questions: readonly bigint[]; questionCount: bigint; questionStart: bigint }

/** Curation is based on deployed bytecode, never an untrusted policy's self-description. */
export async function loadPortfolioAdmission(client: Pick<ReadClient, 'getCode' | 'readContract'>, address: Address, universeId: bigint, blockNumber?: bigint, questionStart = 0n): Promise<PortfolioAdmission> {
	const code = await client.getCode({ address, blockNumber })
	if (code === `0x${openArtifact.evm.deployedBytecode.object}`) return { address, mode: 'open' }
	try {
		verifyRuntimeCode(code, `0x${fixedArtifact.evm.deployedBytecode.object}`, fixedArtifact.evm.deployedBytecode.immutableReferences, 'fixed question policy')
	} catch (failure) {
		if (!(failure instanceof Error) || (failure.message !== 'Unrecognized fixed question policy runtime code.' && failure.message !== 'Inconsistent fixed question policy immutable values.')) throw failure
		return { address, mode: 'custom' }
	}
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

export function portfolioAdmissionCreationRequest(owner: Address, mode: 'open' | 'fixed', universeId: bigint, questionIds: readonly bigint[]): PortfolioTransaction {
	if (mode === 'open') return { account: owner, value: 0n, data: encodeDeployData({ abi: openArtifact.abi, bytecode: `0x${openArtifact.evm.bytecode.object}` }), reviewDescription: 'Deploy an immutable open admission policy. Anyone may add eligible questions to portfolios using this policy.' }
	if (questionIds.length === 0) throw new Error('Choose at least one approved question.')
	if (questionIds.some((id, index) => id < 0n || id >= 1n << 256n || (index > 0 && id <= (questionIds[index - 1] ?? id)))) throw new Error('Choose increasing unique question IDs.')
	return {
		account: owner,
		value: 0n,
		data: encodeDeployData({ abi: fixedArtifact.abi, bytecode: `0x${fixedArtifact.evm.bytecode.object}`, args: [universeId, questionIds] }),
		reviewDescription: `Deploy a permanently fixed admission policy for universe ${universeId}. Only these question IDs may be backed: ${questionIds.map(id => `0x${id.toString(16)}`).join(', ')}. Nobody can change the list.`,
	}
}

export async function requirePortfolioQuestionAdmission(client: Pick<ReadClient, 'readContract'>, policy: Address, portfolio: Address, universeId: bigint, questionId: bigint, blockNumber?: bigint) {
	if ((await client.readContract({ address: policy, abi: admissionAbi, functionName: 'isQuestionAllowed', args: [portfolio, universeId, questionId], blockNumber })) !== true) throw new Error('This question is not allowed by the portfolio admission policy.')
}
