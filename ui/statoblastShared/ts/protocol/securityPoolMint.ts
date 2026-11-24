import { getAddress, zeroHash, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '../contractArtifact.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { requireSecurityPoolQuestionAdmission, requireSecurityPoolQuestionEligibility, requireSecurityPoolQuestionHorizon } from './securityPoolAdmission.js'
import type { SecurityPoolAccountSnapshot } from './securityPool.js'
import { questionPoolVerificationFailed } from '../copy/securityPool.js'

/** Read exactly one question; the registry page never limits which question can be quoted. */
export async function loadSecurityPoolMintQuestion(client: ReadClient, snapshot: Pick<SecurityPoolAccountSnapshot, 'securityPool' | 'universeId' | 'blockNumber' | 'blockHash' | 'chainId'>, questionId: bigint) {
	const { securityPool, universeId, blockNumber } = snapshot
	const origin = await client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'questionOriginIds', args: [questionId], blockNumber })
	if (origin === zeroHash) {
		const [originUniverseId, admissionPolicy, block] = await Promise.all([
			client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'originUniverseId', blockNumber }),
			client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'questionAdmissionPolicy', blockNumber }),
			client.getBlock({ blockNumber }),
		])
		if (originUniverseId !== universeId) throw new Error('Register new questions in the origin universe before purchasing.')
		await Promise.all([
			requireSecurityPoolQuestionAdmission(client, admissionPolicy, securityPool, universeId, questionId, blockNumber),
			requireSecurityPoolQuestionHorizon(client, securityPool, questionId, blockNumber, block.timestamp),
			requireSecurityPoolQuestionEligibility(client, universeId, questionId, blockNumber),
		])
		const questionEndTime = await client.readContract({ address: getZoltarContractAddresses().zoltarQuestionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', args: [questionId], blockNumber })
		const [finalBlock, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
		if (finalBlock.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the question. Refresh and try again.')
		return { pool: zeroAddress, questionEndTime, escalationGame: zeroAddress, systemState: 0n }
	}
	const pool = await client.readContract({ address: securityPool, abi: securityPoolArtifact.abi, functionName: 'getQuestionLedger', args: [questionId, universeId], blockNumber })
	const [nativeQuestionId, nativeUniverseId, questionData, escalationGame, systemState] = await Promise.all([
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionData', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'systemState', blockNumber }),
	])
	if (nativeQuestionId !== questionId || nativeUniverseId !== universeId) throw new Error(questionPoolVerificationFailed)
	const questionEndTime = await client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', args: [questionId], blockNumber })
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the question. Refresh and try again.')
	return { pool: getAddress(pool), questionEndTime, escalationGame, systemState: BigInt(systemState) }
}
