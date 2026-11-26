import { getCreateAddress, TransactionLookupNotFoundError, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { loadSecurityPoolAdmission } from '../../../protocol/securityPoolAdmission.js'
import type { CuratedAdmissionMode } from './creation.js'

export async function readDeploymentNonce(client: Pick<ReadClient, 'getTransaction'>, owner: Address, hash: Hash) {
	try {
		const transaction = await client.getTransaction({ hash })
		if (transaction.hash.toLowerCase() === hash.toLowerCase() && transaction.from.toLowerCase() === owner.toLowerCase()) return transaction.nonce.toString()
	} catch (error) {
		if (!(error instanceof TransactionLookupNotFoundError) || error.kind !== 'transaction') throw error
	}
	return undefined
}

export async function matchesQuestionRules(client: Pick<ReadClient, 'getCode' | 'readContract'>, address: Address, mode: CuratedAdmissionMode, universeId: bigint, ids: readonly bigint[], blockNumber?: bigint) {
	const policy = await loadSecurityPoolAdmission(client, address, universeId, blockNumber)
	if (policy.mode !== mode) return false
	if (policy.mode !== 'fixed') return true
	if (policy.questionCount !== BigInt(ids.length) || !matchesPage(policy.questions, ids.slice(0, 64))) return false
	for (let start = policy.questions.length; start < ids.length; start += 64) {
		const page = await loadSecurityPoolAdmission(client, address, universeId, blockNumber, BigInt(start))
		if (page.mode !== 'fixed' || !matchesPage(page.questions, ids.slice(start, start + 64))) return false
	}
	return true
}

function matchesPage(actual: readonly bigint[], expected: readonly bigint[]) {
	return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}

export async function recoverQuestionRules(client: Pick<ReadClient, 'getBlock' | 'getTransactionCount' | 'getCode' | 'readContract'>, owner: Address, nonce: bigint, mode: CuratedAdmissionMode, universeId: bigint, ids: readonly bigint[]) {
	const head = await client.getBlock({ blockTag: 'finalized' })
	if (head.number === undefined || head.hash === undefined || (await client.getTransactionCount({ address: owner, blockNumber: head.number })) <= nonce) return undefined
	const address = getCreateAddress({ from: owner, nonce })
	const matches = await matchesQuestionRules(client, address, mode, universeId, ids, head.number)
	if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return undefined
	return { rules: matches ? address : undefined }
}
