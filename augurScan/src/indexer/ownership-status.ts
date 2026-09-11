import { DatabaseConsistencyError, databaseConsistencyDiagnosticMessage } from '../database.ts'
import { safeIndexerFailureReason } from './runtime-diagnostics.ts'

export type OwnershipStage = 'acquire' | 'verify' | 'seed' | 'record-ownership' | 'owned-run' | 'record-failure' | 'release'

export class IndexerOwnershipStageError extends Error {
	override name = 'IndexerOwnershipStageError'

	constructor(
		readonly stage: OwnershipStage,
		cause: unknown,
	) {
		super(`Indexer ownership stage failed: ${stage}`, { cause })
	}
}

export type IndexerOwnershipEvent =
	| {
			readonly type: 'failure'
			readonly stage: OwnershipStage
			readonly consecutiveFailures: number
			readonly retryDelayMs: number
			readonly backendPid?: number
	  }
	| { readonly type: 'acquired'; readonly backendPid?: number; readonly recoveredAfterFailures: number; readonly acquiredAfterStandby: boolean }
	| { readonly type: 'released'; readonly backendPid?: number }
	| { readonly type: 'release-failed'; readonly backendPid?: number }
	| { readonly type: 'standby' }

type IndexerOwnershipStatus = {
	readonly networkId: string
	readonly active: boolean
	readonly backendPid?: number
	readonly failuresTotal: number
	readonly reacquisitionsTotal: number
	readonly consecutiveFailures: number
	readonly lastFailureAt?: string
	readonly lastFailureStage?: OwnershipStage
}

const ownershipStatuses = new Map<string, IndexerOwnershipStatus>()

const nextIndexerOwnershipStatus = (networkId: string, current: IndexerOwnershipStatus | undefined, event: IndexerOwnershipEvent, now = new Date()): IndexerOwnershipStatus => {
	const previous = current ?? {
		networkId,
		active: false,
		failuresTotal: 0,
		reacquisitionsTotal: 0,
		consecutiveFailures: 0,
	}
	if (event.type === 'failure') {
		return {
			...previous,
			active: false,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			failuresTotal: previous.failuresTotal + 1,
			consecutiveFailures: event.consecutiveFailures,
			lastFailureAt: now.toISOString(),
			lastFailureStage: event.stage,
		}
	}
	if (event.type === 'acquired') {
		return {
			...previous,
			active: true,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			reacquisitionsTotal: previous.reacquisitionsTotal + (event.recoveredAfterFailures > 0 || event.acquiredAfterStandby ? 1 : 0),
			consecutiveFailures: 0,
		}
	}
	return event.type === 'release-failed'
		? {
				...previous,
				active: false,
				...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			}
		: {
				...previous,
				active: false,
				backendPid: undefined,
				consecutiveFailures: event.type === 'standby' ? 0 : previous.consecutiveFailures,
			}
}

export const recordOwnershipEvent = (networkId: string, event: IndexerOwnershipEvent): void => {
	ownershipStatuses.set(networkId, nextIndexerOwnershipStatus(networkId, ownershipStatuses.get(networkId), event))
}

export const ownershipFailureReason = (error: unknown): string => {
	const reason = safeIndexerFailureReason(error)
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof DatabaseConsistencyError) {
			const detail = databaseConsistencyDiagnosticMessage(current)
			if (detail !== undefined) return `${reason}: ${detail}`
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return reason
}

export const ownershipFailureLogMessage = (networkId: string, stage: OwnershipStage, error: unknown, consecutiveFailures: number, retryDelay: number, backendPid?: number): string =>
	`[${networkId}] indexer ownership failed; stage: ${stage}; consecutive failures: ${consecutiveFailures}; retry delay: ${retryDelay}ms; backend PID: ${backendPid ?? 'unavailable'}; reason: ${ownershipFailureReason(error)}`
