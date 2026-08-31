import { decodeOpaqueCursor } from './cursor-codec.ts'

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n

export type ExportDataset = 'logs' | 'timeline' | 'reorgs'
export type ExportCanonicalScope = 'canonical' | 'orphaned' | 'all'

export type ExportRequestScope = {
	readonly dataset: ExportDataset
	readonly chainId: string
	readonly canonical: ExportCanonicalScope
	readonly fromBlock: string
	readonly toBlock: string
}

type ExportSnapshot = {
	readonly block: string
	readonly hash: string
	readonly invalidationId: string
	readonly abiSourceHash: string
	readonly applicationSourceHash: string
	readonly projectionSourceHash: string
}

export type ExportValidationState = {
	readonly snapshot: ExportSnapshot
	readonly total: string
	readonly returnedTotal: string
	readonly truncated: boolean
	readonly nextCursor?: string
}

type ExportKey = readonly string[]

type CursorBoundary = {
	readonly scope: ExportRequestScope
	readonly snapshot: ExportSnapshot
	readonly total: string
	readonly lastKey: ExportKey
}

const record = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const decimal = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > POSTGRES_BIGINT_MAX)
		throw new Error(`${name} must be a non-negative PostgreSQL bigint`)
	return value
}

const rowDecimal = (value: unknown, name: string): string => {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
	return decimal(value, name)
}

const nonEmptyString = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string`)
	return value
}

const blockHash = (value: unknown, name: string): string => {
	const hash = nonEmptyString(value, name)
	if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error(`${name} must be a lowercase 32-byte hash`)
	return hash
}

const datasetValue = (value: unknown): ExportDataset => {
	if (value !== 'logs' && value !== 'timeline' && value !== 'reorgs') throw new Error('dataset must be logs, timeline, or reorgs')
	return value
}

const canonicalValue = (value: unknown): ExportCanonicalScope => {
	if (value !== 'canonical' && value !== 'orphaned' && value !== 'all') throw new Error('canonical scope must be canonical, orphaned, or all')
	return value
}

export const exportRequestScope = (dataset: unknown, chainId: unknown, canonical: unknown, fromBlock: unknown, toBlock: unknown): ExportRequestScope => {
	const parsedChainId = decimal(chainId, 'chain ID')
	if (!Number.isSafeInteger(Number(parsedChainId))) throw new Error('chain ID must be a safe integer')
	const parsedFromBlock = decimal(fromBlock, 'from block')
	const parsedToBlock = decimal(toBlock, 'to block')
	if (BigInt(parsedFromBlock) > BigInt(parsedToBlock)) throw new Error('from block must not exceed to block')
	const parsedDataset = datasetValue(dataset)
	const parsedCanonical = canonicalValue(canonical)
	if (parsedDataset === 'reorgs' && parsedCanonical !== 'all') throw new Error('reorg exports require canonical scope all')
	return {
		dataset: parsedDataset,
		chainId: parsedChainId,
		canonical: parsedCanonical,
		fromBlock: parsedFromBlock,
		toBlock: parsedToBlock,
	}
}

export const parseExportValidationState = (value: unknown): ExportValidationState => {
	const state = record(value)
	const snapshotValue = record(state['snapshot'])
	const snapshot = {
		block: decimal(snapshotValue['block'], 'snapshot block'),
		hash: blockHash(snapshotValue['hash'], 'snapshot hash'),
		invalidationId: decimal(snapshotValue['invalidationId'], 'snapshot invalidation ID'),
		abiSourceHash: nonEmptyString(snapshotValue['abiSourceHash'], 'ABI source hash'),
		applicationSourceHash: nonEmptyString(snapshotValue['applicationSourceHash'], 'application source hash'),
		projectionSourceHash: nonEmptyString(snapshotValue['projectionSourceHash'], 'projection source hash'),
	}
	const truncated = state['truncated']
	if (typeof truncated !== 'boolean') throw new Error('truncated must be boolean')
	const nextCursor = state['nextCursor']
	if (nextCursor !== undefined && (typeof nextCursor !== 'string' || nextCursor.length === 0)) throw new Error('next cursor must be a non-empty string')
	if (truncated !== (nextCursor !== undefined)) throw new Error('truncated state and next cursor do not agree')
	const total = decimal(state['total'], 'snapshot total')
	const returnedTotal = decimal(state['returnedTotal'], 'cumulative returned count')
	if (BigInt(returnedTotal) > BigInt(total) || (truncated ? BigInt(returnedTotal) >= BigInt(total) : returnedTotal !== total))
		throw new Error('validation state counts do not agree')
	return {
		snapshot,
		total,
		returnedTotal,
		truncated,
		...(nextCursor === undefined ? {} : { nextCursor }),
	}
}

const responseHeaders = (source: string): ReadonlyMap<string, readonly string[]> => {
	const values = new Map<string, string[]>()
	for (const line of source.split(/\r?\n/)) {
		const separator = line.indexOf(':')
		if (separator < 1) continue
		const name = line.slice(0, separator).trim().toLowerCase()
		const value = line.slice(separator + 1).trim()
		values.set(name, [...(values.get(name) ?? []), value])
	}
	return values
}

const requiredHeader = (headers: ReadonlyMap<string, readonly string[]>, name: string): string => {
	const values = headers.get(name)
	if (values?.length !== 1 || values[0] === undefined || values[0].length === 0) throw new Error(`${name} must occur exactly once with a value`)
	return values[0]
}

const optionalHeader = (headers: ReadonlyMap<string, readonly string[]>, name: string): string | undefined => {
	const values = headers.get(name)
	if (values === undefined) return undefined
	if (values.length !== 1 || values[0] === undefined || values[0].length === 0) throw new Error(`${name} must occur at most once with a value`)
	return values[0]
}

const ndjsonRecords = (body: string): readonly Record<string, unknown>[] => {
	if (body === '') return []
	if (!body.endsWith('\n')) throw new Error('NDJSON body must end with a newline')
	return body
		.slice(0, -1)
		.split('\n')
		.map((line) => {
			if (line.length === 0) throw new Error('NDJSON body contains an empty record')
			let parsed: unknown
			try {
				parsed = JSON.parse(line)
			} catch (error) {
				throw new Error('NDJSON body contains malformed JSON', { cause: error })
			}
			const row = record(parsed)
			if (Object.keys(row).length === 0) throw new Error('NDJSON records must be non-empty objects')
			return row
		})
}

const sameSnapshot = (left: ExportSnapshot, right: ExportSnapshot): boolean =>
	left.block === right.block &&
	left.hash === right.hash &&
	left.invalidationId === right.invalidationId &&
	left.abiSourceHash === right.abiSourceHash &&
	left.applicationSourceHash === right.applicationSourceHash &&
	left.projectionSourceHash === right.projectionSourceHash

const sameScope = (left: ExportRequestScope, right: ExportRequestScope): boolean =>
	left.dataset === right.dataset &&
	left.chainId === right.chainId &&
	left.canonical === right.canonical &&
	left.fromBlock === right.fromBlock &&
	left.toBlock === right.toBlock

const keyFor = (dataset: ExportDataset, value: Record<string, unknown> | readonly unknown[], cursor: boolean): ExportKey => {
	const fields = record(value)
	const field = (name: string, index: number): unknown => (cursor && Array.isArray(value) ? value[index] : fields[name])
	if (dataset === 'logs')
		return [
			rowDecimal(field('block_number', 0), 'log block number'),
			rowDecimal(field('transaction_index', 1), 'log transaction index'),
			rowDecimal(field('log_index', 2), 'log index'),
			blockHash(field('block_hash', 3), 'log block hash'),
			blockHash(field('tx_hash', 4), 'log transaction hash'),
		]
	if (dataset === 'timeline')
		return [
			rowDecimal(field('block_number', 0), 'timeline block number'),
			blockHash(field('block_hash', 1), 'timeline block hash'),
			blockHash(field('tx_hash', 2), 'timeline transaction hash'),
			rowDecimal(field('log_index', 3), 'timeline log index'),
			nonEmptyString(field('entity_type', 4), 'timeline entity type'),
			nonEmptyString(field('entity_identity', 5), 'timeline entity identity'),
		]
	return [rowDecimal(field('id', 0), 'reorganization ID')]
}

const numericKeyIndex = (dataset: ExportDataset, index: number): boolean =>
	dataset === 'logs' ? index <= 2 : dataset === 'timeline' ? index === 0 || index === 3 : index === 0

const compareKeys = (dataset: ExportDataset, left: ExportKey, right: ExportKey): number => {
	if (left.length !== right.length) throw new Error('export row identity shape changed')
	for (let index = 0; index < left.length; index += 1) {
		const leftPart = left[index]
		const rightPart = right[index]
		if (leftPart === undefined || rightPart === undefined) throw new Error('export row identity is incomplete')
		if (leftPart === rightPart) continue
		if (numericKeyIndex(dataset, index)) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1
		return leftPart < rightPart ? -1 : 1
	}
	return 0
}

const sameKey = (dataset: ExportDataset, left: ExportKey, right: ExportKey): boolean => compareKeys(dataset, left, right) === 0

const parseCursor = (cursor: string): CursorBoundary => {
	let value: unknown
	try {
		value = decodeOpaqueCursor(cursor)
	} catch (error) {
		throw new Error('export cursor is not valid base64url JSON', { cause: error })
	}
	if (!Array.isArray(value) || value.length !== 14 || value[0] !== 1) throw new Error('export cursor shape is invalid')
	const rawChainId = value[2]
	if (typeof rawChainId !== 'number' || !Number.isSafeInteger(rawChainId) || rawChainId < 0) throw new Error('export cursor chain ID is invalid')
	const scope = exportRequestScope(value[1], String(rawChainId), value[3], value[4], value[5])
	const snapshot = {
		block: decimal(value[6], 'cursor snapshot block'),
		hash: blockHash(value[7], 'cursor snapshot hash'),
		invalidationId: decimal(value[8], 'cursor snapshot invalidation ID'),
		abiSourceHash: nonEmptyString(value[10], 'cursor ABI source hash'),
		applicationSourceHash: nonEmptyString(value[11], 'cursor application source hash'),
		projectionSourceHash: nonEmptyString(value[12], 'cursor projection source hash'),
	}
	const lastKeyValue = value[13]
	if (!Array.isArray(lastKeyValue)) throw new Error('export cursor row identity is invalid')
	return {
		scope,
		snapshot,
		total: decimal(value[9], 'cursor snapshot total'),
		lastKey: keyFor(scope.dataset, lastKeyValue, true),
	}
}

const validateRowScope = (row: Record<string, unknown>, scope: ExportRequestScope, snapshot: ExportSnapshot): void => {
	if (rowDecimal(row['chain_id'], 'row chain ID') !== scope.chainId) throw new Error('export row chain ID does not match the request')
	if (scope.dataset === 'logs' || scope.dataset === 'timeline') {
		const block = rowDecimal(row['block_number'], 'row block number')
		if (BigInt(block) < BigInt(scope.fromBlock) || BigInt(block) > BigInt(scope.toBlock) || BigInt(block) > BigInt(snapshot.block))
			throw new Error('export row block is outside the request snapshot range')
		const canonical = row['canonical']
		if (typeof canonical !== 'boolean') throw new Error('export row canonical state must be boolean')
		if ((scope.canonical === 'canonical' && !canonical) || (scope.canonical === 'orphaned' && canonical))
			throw new Error('export row canonical state does not match the request')
		return
	}
	if (scope.canonical !== 'all') throw new Error('reorganization exports require canonical scope all')
	if (BigInt(rowDecimal(row['id'], 'reorganization ID')) > BigInt(snapshot.invalidationId))
		throw new Error('reorganization row is outside the snapshot invalidation boundary')
	if (row['reason'] === 'start-boundary-advanced') return
	const boundary = row['previous_block'] ?? row['ancestor_block']
	const block = rowDecimal(boundary, 'reorganization boundary block')
	if (BigInt(block) < BigInt(scope.fromBlock) || BigInt(block) > BigInt(scope.toBlock)) throw new Error('reorganization row is outside the request range')
}

const validateCursorBoundary = (cursor: CursorBoundary, scope: ExportRequestScope, snapshot: ExportSnapshot, total: string): void => {
	if (!sameScope(cursor.scope, scope)) throw new Error('export cursor scope does not match the request')
	if (!sameSnapshot(cursor.snapshot, snapshot) || cursor.total !== total) throw new Error('export cursor boundary does not match the response headers')
}

export const verifyExportPage = (
	headerSource: string,
	body: string,
	scope: ExportRequestScope,
	previous?: ExportValidationState,
	requestCursor?: string,
): ExportValidationState => {
	const headers = responseHeaders(headerSource)
	const contentType = requiredHeader(headers, 'content-type').toLowerCase()
	if (contentType.split(';', 1)[0]?.trim() !== 'application/x-ndjson') throw new Error('content-type must be application/x-ndjson')
	const returned = decimal(requiredHeader(headers, 'x-augurscan-returned'), 'returned count')
	const returnedNumber = Number(returned)
	if (!Number.isSafeInteger(returnedNumber)) throw new Error('returned count must be a safe integer')
	const rows = ndjsonRecords(body)
	if (rows.length !== returnedNumber) throw new Error('NDJSON line count does not match x-augurscan-returned')
	const total = decimal(requiredHeader(headers, 'x-augurscan-snapshot-total'), 'snapshot total')
	const truncatedValue = requiredHeader(headers, 'x-augurscan-truncated')
	if (truncatedValue !== 'true' && truncatedValue !== 'false') throw new Error('x-augurscan-truncated must be true or false')
	const truncated = truncatedValue === 'true'
	const nextCursor = optionalHeader(headers, 'x-augurscan-next-cursor')
	if (truncated !== (nextCursor !== undefined)) throw new Error('truncated response and next cursor do not agree')
	const snapshot = {
		block: decimal(requiredHeader(headers, 'x-augurscan-snapshot-block'), 'snapshot block'),
		hash: blockHash(requiredHeader(headers, 'x-augurscan-snapshot-hash'), 'snapshot hash'),
		invalidationId: decimal(requiredHeader(headers, 'x-augurscan-snapshot-invalidation-id'), 'snapshot invalidation ID'),
		abiSourceHash: requiredHeader(headers, 'x-augurscan-abi-source-hash'),
		applicationSourceHash: requiredHeader(headers, 'x-augurscan-application-source-hash'),
		projectionSourceHash: requiredHeader(headers, 'x-augurscan-projection-source-hash'),
	}
	if (previous !== undefined) {
		if (!previous.truncated || previous.nextCursor === undefined) throw new Error('a completed export cannot accept another page')
		if (requestCursor !== previous.nextCursor) throw new Error('request cursor does not continue the previous page')
		if (!sameSnapshot(previous.snapshot, snapshot) || previous.total !== total) throw new Error('export snapshot headers changed between pages')
	} else if (requestCursor !== undefined) throw new Error('the first export page cannot use a continuation cursor')
	const requestBoundary = requestCursor === undefined ? undefined : parseCursor(requestCursor)
	const nextBoundary = nextCursor === undefined ? undefined : parseCursor(nextCursor)
	if (requestBoundary !== undefined) validateCursorBoundary(requestBoundary, scope, snapshot, total)
	if (nextBoundary !== undefined) validateCursorBoundary(nextBoundary, scope, snapshot, total)
	let priorKey = requestBoundary?.lastKey
	let lastBodyKey: ExportKey | undefined
	for (const row of rows) {
		validateRowScope(row, scope, snapshot)
		const key = keyFor(scope.dataset, row, false)
		if (priorKey !== undefined && compareKeys(scope.dataset, priorKey, key) >= 0) throw new Error('export row identities are not strictly increasing')
		priorKey = key
		lastBodyKey = key
	}
	if (nextBoundary !== undefined && (lastBodyKey === undefined || !sameKey(scope.dataset, lastBodyKey, nextBoundary.lastKey)))
		throw new Error('next cursor does not identify the final export row')
	const returnedTotal = BigInt(previous?.returnedTotal ?? '0') + BigInt(returned)
	const exactTotal = BigInt(total)
	if (returnedTotal > exactTotal) throw new Error('cumulative returned count exceeds snapshot total')
	if (truncated ? returnedTotal >= exactTotal : returnedTotal !== exactTotal)
		throw new Error(truncated ? 'truncated page must leave records remaining' : 'final page count does not match snapshot total')
	return {
		snapshot,
		total,
		returnedTotal: returnedTotal.toString(),
		truncated,
		...(nextCursor === undefined ? {} : { nextCursor }),
	}
}
