import type { SQL } from 'bun'
import { type AddressHistoryQuery, addressContractIdentity, addressInteractionHistory, addressTransactionHistory, interactionHistoryAnchor, interactionHistorySnapshot, transactionHistoryAnchor, transactionHistorySnapshot } from '../repositories/address-history.ts'
import { operationsAsOf } from '../repositories/operations.ts'
import { type AddressHistoryKind, ApiConflictError, ApiRequestError, actionJsonColumns, addressHistoryCursorFor, decodedJsonColumns, evmAddress, integer, json, parseAddressHistoryCursor } from './shared.ts'

type AddressHistoryPagination = {
	readonly kind: AddressHistoryKind
	readonly defaultLimit: number
	readonly anchor: (sql: SQL, chainId: number, address: string) => Promise<Array<Record<string, unknown>>>
	readonly snapshot: (sql: SQL, chainId: number, address: string, snapshotBlock: string, snapshotHash: string) => Promise<Array<Record<string, unknown>>>
	readonly history: (sql: SQL, query: AddressHistoryQuery) => Promise<Array<Record<string, unknown>>>
	readonly changedMessage: string
}

const addressHistoryPage = async (sql: SQL, url: URL, pagination: AddressHistoryPagination): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? pagination.defaultLimit
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), pagination.kind)
	if (cursor !== undefined && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOf(sql, chainId)
	if (cursor !== undefined && (cursor[6] !== String(asOf['invalidationId']) || cursor[7] !== String(asOf['abiSourceHash']) || cursor[8] !== String(asOf['applicationSourceHash']) || cursor[9] !== String(asOf['projectionSourceHash']))) throw new ApiConflictError('Indexed state changed; restart pagination')
	const anchorRows = cursor === undefined ? await pagination.anchor(sql, chainId, address) : []
	const snapshotBlock = cursor?.[4] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[5] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await pagination.snapshot(sql, chainId, address, snapshotBlock, snapshotHash)
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[10]) throw new ApiConflictError(pagination.changedMessage)
	}
	const rows = await pagination.history(sql, {
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
	const lastRow = pageRows[pageRows.length - 1]
	return json({
		items: pageRows.map(row => decodedJsonColumns(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')), actionJsonColumns)),
		total,
		limit,
		snapshotBlock,
		nextCursor: hasMore && lastRow !== undefined ? addressHistoryCursorFor(pagination.kind, chainId, address, snapshotBlock, snapshotHash, asOf, total, lastRow) : undefined,
	})
}

export const addressTransactions = async (sql: SQL, url: URL): Promise<Response> =>
	await addressHistoryPage(sql, url, {
		kind: 'sent',
		defaultLimit: 50,
		anchor: transactionHistoryAnchor,
		snapshot: transactionHistorySnapshot,
		history: addressTransactionHistory,
		changedMessage: 'Transaction history changed; restart pagination',
	})

export const addressInteractions = async (sql: SQL, url: URL): Promise<Response> =>
	await addressHistoryPage(sql, url, {
		kind: 'referenced',
		defaultLimit: 20,
		anchor: interactionHistoryAnchor,
		snapshot: interactionHistorySnapshot,
		history: addressInteractionHistory,
		changedMessage: 'Interaction history changed; restart pagination',
	})

export const addressIdentity = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const rows = await addressContractIdentity(sql, chainId, address)
	return json({ chainId, address, ...(rows[0] ?? {}) })
}
