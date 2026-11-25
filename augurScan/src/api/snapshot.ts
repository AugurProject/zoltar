import type { SQL } from 'bun'
import type { JsonValue } from '../ethereum.ts'
import { operationsAsOf, unavailableOperationsBlockHash } from '../repositories/operations.ts'
import { ApiConflictError, ApiRequestError, postgresBigint } from './shared.ts'

export function cursorSnapshot(parts: readonly JsonValue[], offset: number) {
	const [blockNumber, blockHash, invalidationId, abiSourceHash, applicationSourceHash, projectionSourceHash] = parts.slice(offset, offset + 6)
	if (typeof blockNumber !== 'string' || typeof blockHash !== 'string' || typeof invalidationId !== 'string' || typeof abiSourceHash !== 'string' || typeof applicationSourceHash !== 'string' || typeof projectionSourceHash !== 'string') throw new ApiRequestError('cursor snapshot is invalid')
	return { blockNumber, blockHash, invalidationId, abiSourceHash, applicationSourceHash, projectionSourceHash }
}

export const snapshotMatches = (snapshot: ReturnType<typeof cursorSnapshot>, asOf: Record<string, unknown>): boolean => Object.entries(snapshot).every(([key, value]) => value === String(asOf[key]))

export const operationsAsOfFromUrl = async (sql: SQL, chainId: number, url: URL): Promise<Record<string, unknown>> => await operationsAsOf(sql, chainId, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))

export type SnapshotCursorReference = { readonly parts: readonly JsonValue[]; readonly offset: number }

export const operationsAsOfForContinuations = async (sql: SQL, chainId: number, cursors: readonly (SnapshotCursorReference | ReturnType<typeof cursorSnapshot>)[], requestedAtBlock?: string): Promise<Record<string, unknown>> => {
	const snapshots = cursors.map(cursor => ('parts' in cursor ? cursorSnapshot(cursor.parts, cursor.offset) : cursor))
	const first = snapshots[0]
	const cursorBlock = first?.blockNumber
	if (requestedAtBlock !== undefined && cursorBlock !== undefined && requestedAtBlock !== cursorBlock) throw new ApiRequestError('cursor does not match the requested snapshot block')
	// An empty canonical checkpoint can still anchor retained orphan evidence.
	const emptyCheckpoint = first !== undefined && cursorBlock === '0' && first.blockHash === unavailableOperationsBlockHash
	const snapshotBlock = requestedAtBlock ?? (emptyCheckpoint ? undefined : cursorBlock)
	let asOf: Record<string, unknown>
	try {
		asOf = await operationsAsOf(sql, chainId, snapshotBlock)
	} catch (error) {
		if (cursorBlock !== undefined && error instanceof ApiRequestError && error.message === 'atBlock is outside retained canonical coverage') throw new ApiConflictError('Indexed state changed; restart pagination')
		throw error
	}
	for (const snapshot of snapshots) if (!snapshotMatches(snapshot, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return asOf
}
