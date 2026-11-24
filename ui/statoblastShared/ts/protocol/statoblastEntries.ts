import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

export type StatoblastEntry = { pool: string; questionId?: bigint; universeId: bigint }
export type StatoblastEntryResult = { status: 'invalid-pool' | 'non-statoblast-contract' | 'unregistered-question' | 'unprepared-question' } | { status: 'pool'; pool: Address } | { status: 'question'; pool: Address; ledger: Address } | { status: 'failed'; error: Error }

function questionFailure(error: Error): StatoblastEntryResult {
	switch (error.message) {
		case 'Multicall contract call failed: execution reverted: Question not registered':
			return { status: 'unregistered-question' }
		case 'Multicall contract call failed: execution reverted: Question pool unavailable':
			return { status: 'unprepared-question' }
		default:
			return { status: 'failed', error }
	}
}

/** Authenticate pools with the factory before calling them to resolve questions. Invalid entries fail independently. */
async function readStatoblastEntries(client: Pick<ReadClient, 'multicall'> & Partial<Pick<ReadClient, 'getCode'>>, entries: readonly StatoblastEntry[], blockNumber: bigint): Promise<StatoblastEntryResult[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	const candidates = [...new Set(entries.flatMap(({ pool }) => (isAddress(pool) && pool.toLowerCase() !== zeroAddress ? [getAddress(pool)] : [])))]
	const poolResults =
		candidates.length === 0
			? []
			: await readOptionalMulticall(
					client,
					candidates.map(pool => ({ abi: factoryArtifact.abi, address: factory, functionName: 'isSecurityPool', args: [pool] }) as const),
					blockNumber,
				)
	const poolChecks = new Map(candidates.map((address, index) => [address, poolResults[index]]))
	const questions = entries.flatMap(({ pool, questionId, universeId }, index) => {
		if (questionId === undefined || !isAddress(pool)) return []
		const address = getAddress(pool)
		const verification = poolChecks.get(address)
		if (verification?.status !== 'success' || verification.result !== true) return []
		return [{ address, questionId, universeId, index }]
	})
	const questionResults =
		questions.length === 0
			? []
			: await readOptionalMulticall(
					client,
					questions.map(({ address, questionId, universeId }) => ({ abi: poolArtifact.abi, address, functionName: 'getQuestionLedger', args: [questionId, universeId] }) as const),
					blockNumber,
				)
	const questionChecks = new Map(questions.map(({ index }, offset) => [index, questionResults[offset]]))
	return await Promise.all(
		entries.map(async ({ pool, questionId }, index): Promise<StatoblastEntryResult> => {
			if (!isAddress(pool) || !poolChecks.has(getAddress(pool))) return { status: 'invalid-pool' }
			const address = getAddress(pool)
			const poolResult = poolChecks.get(address)
			if (poolResult?.status === 'failure') return { status: 'failed', error: poolResult.error }
			if (poolResult?.result === false) {
				try {
					const code = await client.getCode?.({ address, blockNumber })
					return { status: code === undefined || code === '0x' ? 'invalid-pool' : 'non-statoblast-contract' }
				} catch (error) {
					return { status: 'failed', error: error instanceof Error ? error : new Error('Could not check the pool address.') }
				}
			}
			if (poolResult?.result !== true) return { status: 'failed', error: new Error('Invalid security pool verification result.') }
			if (questionId === undefined) return { status: 'pool', pool: address }
			const question = questionChecks.get(index)
			if (question?.status === 'failure') return questionFailure(question.error)
			const ledger = question?.result
			if (typeof ledger !== 'string' || !isAddress(ledger) || ledger.toLowerCase() === zeroAddress) return { status: 'failed', error: new Error('Invalid question verification result.') }
			return { status: 'question', pool: address, ledger: getAddress(ledger) }
		}),
	)
}

const entryCache = new WeakMap<ReturnType<typeof getActiveBackend>, Map<string, StatoblastEntryResult>>()

export function invalidateStatoblastEntries() {
	entryCache.delete(getActiveBackend())
}

export async function checkStatoblastEntries(client: Pick<ReadClient, 'multicall'> & Partial<Pick<ReadClient, 'getCode'>>, entries: readonly StatoblastEntry[], blockNumber: bigint, useSessionCache = false): Promise<StatoblastEntryResult[]> {
	if (!useSessionCache) return await readStatoblastEntries(client, entries, blockNumber)
	const backend = getActiveBackend()
	const cache = entryCache.get(backend) ?? new Map<string, StatoblastEntryResult>()
	entryCache.set(backend, cache)
	const key = (entry: StatoblastEntry) => `${entry.pool.toLowerCase()}:${entry.questionId ?? ''}:${entry.universeId}`
	const missing = entries.filter(entry => !cache.has(key(entry)))
	const loaded = missing.length === 0 ? [] : await readStatoblastEntries(client, missing, blockNumber)
	const checked = new Map(missing.map((entry, index) => [key(entry), loaded[index]]))
	for (const [entry, result] of checked) {
		// A registration, deployment, or child preparation from another wallet can change a negative result.
		if (result?.status === 'pool' || result?.status === 'question') cache.set(entry, result)
	}
	return entries.map(entry => cache.get(key(entry)) ?? checked.get(key(entry)) ?? { status: 'failed', error: new Error('Missing entry verification result.') })
}
