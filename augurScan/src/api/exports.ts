import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { historicalExportRows, historicalExportSnapshot, historicalExportSnapshotCanonical, historicalExportTotal } from '../repositories/exports.ts'
import {
	ApiConflictError,
	ApiRequestError,
	type CanonicalHistoryFilter,
	canonicalHistoryFilter,
	integer,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	isPostgresIntegerString,
	normalize,
	postgresBigint,
} from './shared.ts'

export type HistoricalExportDataset = 'logs' | 'timeline' | 'reorgs'
export type HistoricalExportCursor = readonly [
	version: 1,
	dataset: HistoricalExportDataset,
	chainId: number,
	canonical: CanonicalHistoryFilter,
	fromBlock: string,
	toBlock: string,
	snapshotBlock: string,
	snapshotHash: string,
	snapshotInvalidationId: string,
	snapshotTotal: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	lastKey: readonly string[],
]

export const historicalExportKeyValid = (dataset: HistoricalExportDataset, key: readonly unknown[]): key is readonly string[] => {
	if (!key.every((item) => typeof item === 'string')) return false
	if (dataset === 'logs')
		return (
			key.length === 5 &&
			isPostgresBigint(key[0]) &&
			isPostgresIntegerString(key[1]) &&
			isPostgresIntegerString(key[2]) &&
			/^0x[0-9a-f]{64}$/.test(key[3] ?? '') &&
			/^0x[0-9a-f]{64}$/.test(key[4] ?? '')
		)
	if (dataset === 'timeline')
		return (
			key.length === 6 &&
			isPostgresBigint(key[0]) &&
			/^0x[0-9a-f]{64}$/.test(key[1] ?? '') &&
			/^0x[0-9a-f]{64}$/.test(key[2] ?? '') &&
			isPostgresIntegerString(key[3]) &&
			(key[4]?.length ?? 0) > 0 &&
			(key[5]?.length ?? 0) > 0
		)
	return key.length === 1 && isPostgresBigint(key[0])
}

export const parseHistoricalExportCursor = (value: string | null): HistoricalExportCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		const dataset = parts[1]
		const canonical = parts[3]
		const lastKey = parts[13]
		if (
			parts.length !== 14 ||
			parts[0] !== 1 ||
			(dataset !== 'logs' && dataset !== 'timeline' && dataset !== 'reorgs') ||
			!isNonNegativeSafeInteger(parts[2]) ||
			(canonical !== 'canonical' && canonical !== 'orphaned' && canonical !== 'all') ||
			!isPostgresBigint(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			BigInt(parts[4]) > BigInt(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			typeof parts[7] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[7]) ||
			!isPostgresBigint(parts[8]) ||
			!isPostgresBigint(parts[9]) ||
			typeof parts[10] !== 'string' ||
			typeof parts[11] !== 'string' ||
			typeof parts[12] !== 'string' ||
			!Array.isArray(lastKey) ||
			!historicalExportKeyValid(dataset, lastKey)
		)
			throw new Error('shape')
		return [1, dataset, parts[2], canonical, parts[4], parts[5], parts[6], parts[7], parts[8], parts[9], parts[10], parts[11], parts[12], lastKey]
	} catch (error) {
		throw new ApiRequestError('export cursor is invalid', { cause: error })
	}
}

export const historicalExportCursorFor = (snapshot: readonly unknown[], lastKey: readonly string[]): string => encodeOpaqueCursor([...snapshot, lastKey])

export const historicalExport = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const dataset = url.searchParams.get('dataset') ?? 'timeline'
	if (dataset !== 'logs' && dataset !== 'timeline' && dataset !== 'reorgs') throw new ApiRequestError('dataset must be logs, timeline, or reorgs')
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? '9223372036854775807'
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 5_000
	const limit = Math.min(Math.max(requestedLimit, 1), 50_000)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset pagination is unavailable for exports; follow x-augurscan-next-cursor')
	const canonical = dataset === 'reorgs' ? 'all' : canonicalHistoryFilter(url)
	const cursor = parseHistoricalExportCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined && (cursor[1] !== dataset || cursor[2] !== chainId || cursor[3] !== canonical || cursor[4] !== fromBlock || cursor[5] !== toBlock))
		throw new ApiRequestError('export cursor does not match the requested dataset, chain, canonical scope, or block range')
	const snapshotRows = await historicalExportSnapshot(sql, chainId)
	const snapshotRow = snapshotRows[0]
	if (snapshotRow === undefined) throw new ApiRequestError('chainId is not configured')
	const currentSnapshotBlock = String(snapshotRow['snapshot_block'])
	const currentSnapshotHash = String(snapshotRow['snapshot_hash'])
	const currentInvalidationId = String(snapshotRow['invalidation_id'])
	const currentAbiHash = String(snapshotRow['abi_source_hash'])
	const currentApplicationHash = String(snapshotRow['application_source_hash'])
	const currentProjectionHash = String(snapshotRow['projection_source_hash'])
	if (cursor !== undefined) {
		const snapshotCanonicalRows = await historicalExportSnapshotCanonical(sql, chainId, cursor[6], cursor[7])
		if (
			snapshotCanonicalRows[0]?.['snapshot_canonical'] !== true ||
			currentInvalidationId !== cursor[8] ||
			currentAbiHash !== cursor[10] ||
			currentApplicationHash !== cursor[11] ||
			currentProjectionHash !== cursor[12]
		)
			throw new ApiConflictError('Export snapshot changed; restart pagination')
	}
	const snapshotBlock = cursor?.[6] ?? currentSnapshotBlock
	const snapshotHash = cursor?.[7] ?? currentSnapshotHash
	const snapshotInvalidationId = cursor?.[8] ?? currentInvalidationId
	const abiHash = cursor?.[10] ?? currentAbiHash
	const applicationHash = cursor?.[11] ?? currentApplicationHash
	const projectionHash = cursor?.[12] ?? currentProjectionHash
	const lastKey = cursor?.[13]
	const totalRows =
		cursor === undefined ? await historicalExportTotal(sql, { dataset, chainId, canonical, fromBlock, toBlock, snapshotBlock, snapshotInvalidationId }) : []
	const snapshotTotal = cursor?.[9] ?? String(totalRows[0]?.['total'] ?? '0')
	const rows = await historicalExportRows(sql, {
		dataset,
		chainId,
		canonical,
		fromBlock,
		toBlock,
		snapshotBlock,
		snapshotInvalidationId,
		limit,
		lastKey,
	})
	const truncated = rows.length > limit
	const exported = rows.slice(0, limit)
	const finalRow = exported[exported.length - 1] as Record<string, unknown> | undefined
	const exportedLastKey =
		finalRow === undefined
			? undefined
			: dataset === 'logs'
				? [
						String(finalRow['block_number']),
						String(finalRow['transaction_index']),
						String(finalRow['log_index']),
						String(finalRow['block_hash']),
						String(finalRow['tx_hash']),
					]
				: dataset === 'timeline'
					? [
							String(finalRow['block_number']),
							String(finalRow['block_hash']),
							String(finalRow['tx_hash']),
							String(finalRow['log_index']),
							String(finalRow['entity_type']),
							String(finalRow['entity_identity']),
						]
					: [String(finalRow['id'])]
	const snapshotPrefix = [
		1,
		dataset,
		chainId,
		canonical,
		fromBlock,
		toBlock,
		snapshotBlock,
		snapshotHash,
		snapshotInvalidationId,
		snapshotTotal,
		abiHash,
		applicationHash,
		projectionHash,
	] as const
	const nextCursor = truncated && exportedLastKey !== undefined ? historicalExportCursorFor(snapshotPrefix, exportedLastKey) : undefined
	const body = `${exported.map((row: Record<string, unknown>) => JSON.stringify(normalize(row))).join('\n')}${exported.length === 0 ? '' : '\n'}`
	return new Response(body, {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/x-ndjson; charset=utf-8',
			'content-disposition': `attachment; filename="augurscan-${dataset}-${chainId}-${fromBlock}-${toBlock}.ndjson"`,
			'x-augurscan-returned': String(exported.length),
			'x-augurscan-truncated': String(truncated),
			'x-augurscan-snapshot-block': snapshotBlock,
			'x-augurscan-snapshot-hash': snapshotHash,
			'x-augurscan-snapshot-invalidation-id': snapshotInvalidationId,
			'x-augurscan-snapshot-total': snapshotTotal,
			'x-augurscan-abi-source-hash': abiHash,
			'x-augurscan-application-source-hash': applicationHash,
			'x-augurscan-projection-source-hash': projectionHash,
			...(nextCursor === undefined ? {} : { 'x-augurscan-next-cursor': nextCursor }),
		},
	})
}
