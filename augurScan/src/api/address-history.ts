import type { SQL } from 'bun'
import {
	addressContractIdentity,
	addressInteractionHistory,
	addressTransactionHistory,
	interactionHistoryAnchor,
	interactionHistorySnapshot,
	transactionHistoryAnchor,
	transactionHistorySnapshot,
} from '../repositories/address-history.ts'
import { operationsAsOf } from '../repositories/operations.ts'
import {
	ApiConflictError,
	ApiRequestError,
	actionJsonColumns,
	addressHistoryCursorFor,
	decodedJsonColumns,
	evmAddress,
	integer,
	json,
	parseAddressHistoryCursor,
} from './shared.ts'

export const addressTransactions = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), 'sent')
	if (cursor !== undefined && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOf(sql, chainId)
	if (
		cursor !== undefined &&
		(cursor[6] !== String(asOf['invalidationId']) ||
			cursor[7] !== String(asOf['abiSourceHash']) ||
			cursor[8] !== String(asOf['applicationSourceHash']) ||
			cursor[9] !== String(asOf['projectionSourceHash']))
	)
		throw new ApiConflictError('Indexed state changed; restart pagination')
	const anchorRows = cursor === undefined ? await transactionHistoryAnchor(sql, chainId, address) : []
	const snapshotBlock = cursor?.[4] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[5] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await transactionHistorySnapshot(sql, chainId, address, snapshotBlock, snapshotHash)
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[10])
			throw new ApiConflictError('Transaction history changed; restart pagination')
	}
	const rows = await addressTransactionHistory(sql, {
		chainId,
		address,
		snapshotBlock,
		limit,
		cursorBlock: cursor?.[11],
		cursorIndex: cursor?.[12],
	})
	const total = cursor?.[10] ?? Number(rows[0]?.['snapshot_total'] ?? 0)
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) =>
		decodedJsonColumns(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')), actionJsonColumns),
	)
	return json({
		items,
		total,
		limit,
		snapshotBlock,
		nextCursor:
			hasMore && pageRows.length > 0
				? addressHistoryCursorFor('sent', chainId, address, snapshotBlock, snapshotHash, asOf, total, pageRows[pageRows.length - 1] as Record<string, unknown>)
				: undefined,
	})
}

export const addressInteractions = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 20
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), 'referenced')
	if (cursor !== undefined && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOf(sql, chainId)
	if (
		cursor !== undefined &&
		(cursor[6] !== String(asOf['invalidationId']) ||
			cursor[7] !== String(asOf['abiSourceHash']) ||
			cursor[8] !== String(asOf['applicationSourceHash']) ||
			cursor[9] !== String(asOf['projectionSourceHash']))
	)
		throw new ApiConflictError('Indexed state changed; restart pagination')
	const anchorRows = cursor === undefined ? await interactionHistoryAnchor(sql, chainId, address) : []
	const snapshotBlock = cursor?.[4] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[5] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await interactionHistorySnapshot(sql, chainId, address, snapshotBlock, snapshotHash)
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[10])
			throw new ApiConflictError('Interaction history changed; restart pagination')
	}
	const rows = await addressInteractionHistory(sql, {
		chainId,
		address,
		snapshotBlock,
		limit,
		cursorBlock: cursor?.[11],
		cursorIndex: cursor?.[12],
	})
	const total = cursor?.[10] ?? Number(rows[0]?.['snapshot_total'] ?? 0)
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	return json({
		items: pageRows.map((row: Record<string, unknown>) =>
			decodedJsonColumns(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')), actionJsonColumns),
		),
		total,
		limit,
		snapshotBlock,
		nextCursor:
			hasMore && pageRows.length > 0
				? addressHistoryCursorFor(
						'referenced',
						chainId,
						address,
						snapshotBlock,
						snapshotHash,
						asOf,
						total,
						pageRows[pageRows.length - 1] as Record<string, unknown>,
					)
				: undefined,
	})
}

export const addressIdentity = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const rows = await addressContractIdentity(sql, chainId, address)
	return json({ chainId, address, ...(rows[0] ?? {}) })
}
