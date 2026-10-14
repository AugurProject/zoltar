import { getAddress, isAddress, isHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

export type PortfolioPreferences = { watchedQuestionIds: string[]; universeIds: string[]; selectedQuestionIds: string[]; knownPositionQuestionIds: string[] }
export type PortfolioScope = { backend: string; chainId: string; portfolio: Address; owner: Address }

export function portfolioStorageKey(scope: PortfolioScope, kind: 'preferences' | 'operations') {
	return `statoblast:portfolio:${kind}:${scope.backend}:${scope.chainId}:${scope.portfolio.toLowerCase()}:${scope.owner.toLowerCase()}`
}

const isUnsignedInteger = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value) && value.length <= 78

export function parsePortfolioPreferences(serialized: string | null): PortfolioPreferences {
	const fallback = { watchedQuestionIds: [], universeIds: [], selectedQuestionIds: [], knownPositionQuestionIds: [] }
	if (serialized === null) return fallback
	try {
		const value: unknown = JSON.parse(serialized)
		if (typeof value !== 'object' || value === null || !('watchedQuestionIds' in value) || !('universeIds' in value) || !Array.isArray(value.watchedQuestionIds) || !Array.isArray(value.universeIds)) return fallback
		const questionIds = (values: unknown) =>
			Array.isArray(values)
				? [
						...new Set(
							values
								.filter(isUnsignedInteger)
								.filter(id => BigInt(id) < 1n << 256n)
								.map(id => String(BigInt(id))),
						),
					]
				: []
		return {
			watchedQuestionIds: questionIds(value.watchedQuestionIds),
			universeIds: [...new Set(value.universeIds.filter(isUnsignedInteger))].filter(id => BigInt(id) < 1n << 248n).slice(0, 16),
			selectedQuestionIds: questionIds('selectedQuestionIds' in value ? value.selectedQuestionIds : []),
			knownPositionQuestionIds: questionIds('knownPositionQuestionIds' in value ? value.knownPositionQuestionIds : []),
		}
	} catch (failure) {
		if (!(failure instanceof SyntaxError)) throw failure
		return fallback
	}
}

type TrackedPortfolioObservation = { blockNumber: string; blockHash: Hex; vault: Address; operator: Address; receiverVault: Address; targetVault: Address; queuedAt: string; validForSeconds: string }
export type TrackedPortfolioOperation = { coordinator: Address; operationId: string; operation: string; fromBlock: string; pool: Address; universeId: string; questionId: string; observation?: TrackedPortfolioObservation }

export function isVaultAuthorizedPortfolioOperation(entry: TrackedPortfolioOperation) {
	const observed = entry.observation
	return observed !== undefined && [observed.operator, observed.receiverVault].some(address => address.toLowerCase() === observed.vault.toLowerCase())
}

/** Browser history is a bounded cache; the current queue and position scope remain authoritative. */
function retainPortfolioOperations(entries: readonly TrackedPortfolioOperation[]) {
	const authorized = entries.filter(isVaultAuthorizedPortfolioOperation).slice(-256)
	const remaining = 256 - authorized.length
	const other = remaining === 0 ? [] : entries.filter(entry => !isVaultAuthorizedPortfolioOperation(entry)).slice(-remaining)
	const retained = new Set([...authorized, ...other])
	return entries.filter(entry => retained.has(entry))
}

function parseObservation(value: unknown): TrackedPortfolioObservation | undefined {
	if (typeof value !== 'object' || value === null || !('blockNumber' in value && 'blockHash' in value && 'vault' in value && 'operator' in value && 'receiverVault' in value && 'targetVault' in value && 'queuedAt' in value && 'validForSeconds' in value)) return undefined
	if (!isUnsignedInteger(value.blockNumber) || !isUnsignedInteger(value.queuedAt) || !isUnsignedInteger(value.validForSeconds) || typeof value.blockHash !== 'string' || !isHex(value.blockHash, { strict: true }) || value.blockHash.length !== 66) return undefined
	if (typeof value.vault !== 'string' || !isAddress(value.vault) || typeof value.operator !== 'string' || !isAddress(value.operator) || typeof value.receiverVault !== 'string' || !isAddress(value.receiverVault) || typeof value.targetVault !== 'string' || !isAddress(value.targetVault)) return undefined
	return { blockNumber: value.blockNumber, blockHash: `0x${value.blockHash.slice(2)}`, vault: getAddress(value.vault), operator: getAddress(value.operator), receiverVault: getAddress(value.receiverVault), targetVault: getAddress(value.targetVault), queuedAt: value.queuedAt, validForSeconds: value.validForSeconds }
}

export function parseTrackedPortfolioOperations(serialized: string | null): TrackedPortfolioOperation[] {
	if (serialized === null) return []
	try {
		const value: unknown = JSON.parse(serialized)
		if (!Array.isArray(value)) return []
		return retainPortfolioOperations(
			value.flatMap((entry: unknown) => {
				if (typeof entry !== 'object' || entry === null || !('coordinator' in entry) || !('pool' in entry) || !('operationId' in entry) || !('operation' in entry) || !('fromBlock' in entry) || !('universeId' in entry) || !('questionId' in entry)) return []
				if (
					typeof entry.coordinator !== 'string' ||
					!isAddress(entry.coordinator) ||
					typeof entry.pool !== 'string' ||
					!isAddress(entry.pool) ||
					!isUnsignedInteger(entry.operationId) ||
					!isUnsignedInteger(entry.operation) ||
					!isUnsignedInteger(entry.fromBlock) ||
					!isUnsignedInteger(entry.universeId) ||
					!isUnsignedInteger(entry.questionId)
				)
					return []
				const observation = parseObservation('observation' in entry ? entry.observation : undefined)
				return [{ ...(observation === undefined ? {} : { observation }), coordinator: getAddress(entry.coordinator), pool: getAddress(entry.pool), operationId: entry.operationId, operation: entry.operation, fromBlock: entry.fromBlock, universeId: entry.universeId, questionId: entry.questionId }]
			}),
		)
	} catch (failure) {
		if (!(failure instanceof SyntaxError)) throw failure
		return []
	}
}

const nativeOperationKey = (operation: Pick<TrackedPortfolioOperation, 'coordinator' | 'operationId'>) => `${operation.coordinator.toLowerCase()}:${operation.operationId}`
export const portfolioOperationKey = (operation: Pick<TrackedPortfolioOperation, 'coordinator' | 'operationId' | 'observation'>) => `${nativeOperationKey(operation)}:${operation.observation?.blockHash ?? 'unanchored'}:${operation.observation?.vault.toLowerCase() ?? ''}`

/** Invalidated observations stay as unknown records; rediscovery creates a separate anchored record. */
export function mergeTrackedPortfolioOperations(previous: readonly TrackedPortfolioOperation[], discovered: readonly TrackedPortfolioOperation[], canonicalObservationKeys = new Set(previous.map(portfolioOperationKey))) {
	const byKey = new Map(previous.map(operation => [portfolioOperationKey(operation), operation]))
	for (const operation of discovered) {
		const nativeKey = nativeOperationKey(operation)
		const current = previous.some(prior => nativeOperationKey(prior) === nativeKey && canonicalObservationKeys.has(portfolioOperationKey(prior)))
		if (!current && !byKey.has(portfolioOperationKey(operation))) byKey.set(portfolioOperationKey(operation), operation)
	}
	return retainPortfolioOperations([...byKey.values()])
}

/** A watchlist cannot hide funds, debt or work that still needs attention. */
export function isPortfolioPositionVisible(watched: boolean, position: { claimableFeesAttoEth: bigint; backingUnits: bigint; backingAttoRep: bigint; commitmentAttoEth: bigint; disputeStakedAttoRep: bigint; badDebtAttoEth: bigint; pendingCount: number }) {
	return watched || position.claimableFeesAttoEth > 0n || position.backingUnits > 0n || position.backingAttoRep > 0n || position.commitmentAttoEth > 0n || position.disputeStakedAttoRep > 0n || position.badDebtAttoEth > 0n || position.pendingCount > 0
}
