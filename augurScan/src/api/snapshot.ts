import type { SQL } from 'bun'
import type { JsonValue } from '../ethereum.ts'
import { operationsAsOf } from '../repositories/operations.ts'
import { ApiConflictError, ApiRequestError, postgresBigint } from './shared.ts'

export const snapshotBoundaryMatches = (parts: readonly JsonValue[], offset: number, asOf: Record<string, unknown>): boolean =>
	parts[offset] === String(asOf['blockNumber']) &&
	parts[offset + 1] === String(asOf['blockHash']) &&
	parts[offset + 2] === String(asOf['invalidationId']) &&
	parts[offset + 3] === String(asOf['abiSourceHash']) &&
	parts[offset + 4] === String(asOf['applicationSourceHash']) &&
	parts[offset + 5] === String(asOf['projectionSourceHash'])

export const operationsAsOfFromUrl = async (sql: SQL, chainId: number, url: URL): Promise<Record<string, unknown>> =>
	await operationsAsOf(sql, chainId, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))

export type SnapshotCursorReference = { readonly parts: readonly JsonValue[]; readonly offset: number }

export const operationsAsOfForContinuations = async (
	sql: SQL,
	chainId: number,
	cursors: readonly SnapshotCursorReference[],
	requestedAtBlock?: string,
): Promise<Record<string, unknown>> => {
	const first = cursors[0]
	const cursorBlock = first === undefined ? undefined : first.parts[first.offset]
	if (cursorBlock !== undefined && typeof cursorBlock !== 'string') throw new ApiRequestError('cursor snapshot block is invalid')
	if (requestedAtBlock !== undefined && cursorBlock !== undefined && requestedAtBlock !== cursorBlock)
		throw new ApiRequestError('cursor does not match the requested snapshot block')
	let asOf: Record<string, unknown>
	try {
		asOf = await operationsAsOf(sql, chainId, requestedAtBlock ?? cursorBlock)
	} catch (error) {
		if (cursorBlock !== undefined && error instanceof ApiRequestError && error.message === 'atBlock is outside retained canonical coverage')
			throw new ApiConflictError('Indexed state changed; restart pagination')
		throw error
	}
	for (const cursor of cursors)
		if (!snapshotBoundaryMatches(cursor.parts, cursor.offset, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return asOf
}
