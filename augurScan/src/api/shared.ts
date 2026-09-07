import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
export { ApiConflictError, ApiRequestError } from '../query-errors.ts'
import { ApiRequestError } from '../query-errors.ts'
import { snapshotBoundary } from './entity-details.ts'

export { actionJsonColumns, decodedJsonColumns, json, jsonRecord, normalize, parsedJsonColumn } from './serializers.ts'
import { actionJsonColumns } from './serializers.ts'

export const integer = (value: string | null, name: string): number | undefined => {
	if (value === null || value === '') return undefined
	if (!/^\d+$/.test(value)) throw new ApiRequestError(`${name} must be a non-negative integer`)
	const result = Number(value)
	if (!Number.isSafeInteger(result) || result < 0) throw new ApiRequestError(`${name} must be a non-negative integer`)
	return result
}

export const boundedInteger = (value: string | null, name: string, maximum: number): number | undefined => {
	const result = integer(value, name)
	if (result !== undefined && result > maximum) throw new ApiRequestError(`${name} must not exceed ${maximum}`)
	return result
}

export const evmAddress = (value: string | null, name: string): string | undefined => {
	if (value === null || value.trim() === '') return undefined
	const result = value.trim().toLowerCase()
	if (!/^0x[0-9a-f]{40}$/.test(result)) throw new ApiRequestError(`${name} must be a complete 20-byte EVM address`)
	return result
}

export const isExactIsoTimestamp = (value: string): boolean => {
	if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
	const parsed = new Date(value)
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

export const isCursorTimestamp = (value: string): boolean => {
	const match = /^((?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,6})Z$/.exec(value)
	if (match === null) return false
	const [, prefix, fraction] = match
	if (prefix === undefined || fraction === undefined) return false
	const millisecondTimestamp = `${prefix}.${fraction.slice(0, 3)}Z`
	const parsed = new Date(millisecondTimestamp)
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondTimestamp
}

export const cursorTimestamp = (value: unknown): string => {
	const result = value instanceof Date ? value.toISOString() : value
	if (typeof result !== 'string' || !isCursorTimestamp(result)) throw new Error('Database returned an invalid cursor timestamp')
	return result
}

export const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const POSTGRES_INTEGER_MAX = 2_147_483_647
export const isPostgresInteger = (value: unknown): value is number => isNonNegativeSafeInteger(value) && value <= POSTGRES_INTEGER_MAX
export const isPostgresIntegerString = (value: unknown): value is string =>
	typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) <= BigInt(POSTGRES_INTEGER_MAX)
export const routeInteger = (value: string | undefined, postgresInteger = false): number | undefined => {
	if (value === undefined || !/^\d+$/.test(value)) return undefined
	const result = Number(value)
	return (postgresInteger ? isPostgresInteger(result) : isNonNegativeSafeInteger(result)) ? result : undefined
}

export type LogCursor = readonly [
	version: 1,
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	timestamp: string,
	blockNumber: string,
	transactionIndex: number,
	logIndex: number,
	blockHash: string,
]

export const isLogCursor = (parts: readonly unknown[]): parts is LogCursor =>
	parts.length === 17 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	(parts[2] === null || (typeof parts[2] === 'string' && parts[2] !== '')) &&
	(parts[3] === null || (typeof parts[3] === 'string' && /^0x[0-9a-f]{40}$/.test(parts[3]))) &&
	(parts[4] === null || parts[4] === 'true' || parts[4] === 'false') &&
	(parts[5] === 'canonical' || parts[5] === 'orphaned' || parts[5] === 'all') &&
	isPostgresBigint(parts[6]) &&
	typeof parts[7] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[7]) &&
	isPostgresBigint(parts[8]) &&
	parts.slice(9, 12).every((part) => typeof part === 'string') &&
	typeof parts[12] === 'string' &&
	isExactIsoTimestamp(parts[12]) &&
	isPostgresBigint(parts[13]) &&
	isPostgresInteger(parts[14]) &&
	isPostgresInteger(parts[15]) &&
	typeof parts[16] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[16])

export const parseLogCursor = (
	value: string | null,
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
): LogCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isLogCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId || parts[2] !== event || parts[3] !== address || parts[4] !== decoded || parts[5] !== canonical)
		throw new ApiRequestError('cursor does not match the requested log collection')
	return parts
}

export const logCursorFor = (
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
	asOf: Record<string, unknown>,
	row: Record<string, unknown>,
): string =>
	encodeOpaqueCursor([
		1,
		chainId,
		event,
		address,
		decoded,
		canonical,
		...snapshotBoundary(asOf),
		cursorTimestamp(row['block_timestamp']),
		String(row['block_number']),
		Number(row['transaction_index']),
		Number(row['log_index']),
		String(row['block_hash']),
	] satisfies LogCursor)

export type AddressHistoryKind = 'referenced' | 'sent'

export type AddressHistoryCursor = readonly [
	version: 1,
	kind: AddressHistoryKind,
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	total: number,
	block: string,
	transaction: number,
]

export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n

export const isPostgresBigint = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) return false
	return BigInt(value) <= POSTGRES_BIGINT_MAX
}

export const directObservationTotal = (value: unknown): number => {
	if (!isPostgresBigint(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
		throw new ApiRequestError('direct observation result set exceeds the safe pagination range; narrow kind, address, or canonical filters')
	return Number(value)
}

export const postgresBigint = (value: string | null, name: string): string | undefined => {
	if (value === null || value === '') return undefined
	if (!isPostgresBigint(value)) throw new ApiRequestError(`${name} must be a non-negative PostgreSQL bigint`)
	return value
}

export const parseAddressHistoryCursor = (value: string | null, kind: AddressHistoryKind): AddressHistoryCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 13 ||
			parts[0] !== 1 ||
			parts[1] !== kind ||
			!isNonNegativeSafeInteger(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{40}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			typeof parts[5] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			!parts.slice(7, 10).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[10]) ||
			!isPostgresBigint(parts[11]) ||
			!isPostgresInteger(parts[12]) ||
			BigInt(parts[11]) > BigInt(parts[4])
		)
			throw new Error('shape')
		return parts as [1, AddressHistoryKind, number, string, string, string, string, string, string, string, number, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

export const addressHistoryCursorFor = (
	kind: AddressHistoryKind,
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	asOf: Record<string, unknown>,
	total: number,
	row: Record<string, unknown>,
): string =>
	encodeOpaqueCursor([
		1,
		kind,
		chainId,
		address,
		snapshotBlock,
		snapshotHash,
		String(asOf['invalidationId']),
		String(asOf['abiSourceHash']),
		String(asOf['applicationSourceHash']),
		String(asOf['projectionSourceHash']),
		total,
		String(row['block_number']),
		Number(row['transaction_index']),
	] satisfies AddressHistoryCursor)

export type ActionCursor = readonly [
	version: 1,
	chainId: number,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	timestamp: string,
	blockNumber: string,
	transactionIndex: number,
	blockHash: string,
	txHash: string,
]

export const isActionCursor = (parts: readonly unknown[]): parts is ActionCursor =>
	parts.length === 13 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	isPostgresBigint(parts[2]) &&
	typeof parts[3] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[3]) &&
	isPostgresBigint(parts[4]) &&
	parts.slice(5, 8).every((part) => typeof part === 'string') &&
	typeof parts[8] === 'string' &&
	isCursorTimestamp(parts[8]) &&
	isPostgresBigint(parts[9]) &&
	isPostgresInteger(parts[10]) &&
	typeof parts[11] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[11]) &&
	typeof parts[12] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[12])

export const parseActionCursor = (value: string | null, chainId: number): ActionCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isActionCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId) throw new ApiRequestError('cursor does not match the requested action collection')
	return parts
}

export const actionCursorFor = (chainId: number, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		1,
		chainId,
		...snapshotBoundary(asOf),
		cursorTimestamp(row['block_timestamp']),
		String(row['block_number']),
		Number(row['transaction_index']),
		String(row['block_hash']),
		String(row['tx_hash']),
	] satisfies ActionCursor)

export type CanonicalHistoryFilter = 'canonical' | 'orphaned' | 'all'

export const canonicalHistoryFilter = (url: URL): CanonicalHistoryFilter => {
	const value = url.searchParams.get('canonical') ?? 'canonical'
	if (value !== 'canonical' && value !== 'orphaned' && value !== 'all') throw new ApiRequestError('canonical must be canonical, orphaned, or all')
	return value
}
