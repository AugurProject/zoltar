import { requirePositiveLimit } from './discovery-client.ts'
import { type CountedRegistryCursor, emptyCountedRegistryCursor } from './topology-cache.ts'
import { type Address, type Hash, getAddress } from '@zoltar/bot-shared/ethereum'
import { createHash } from 'node:crypto'

export async function collectCountedPages<T>(parameters: { count: bigint; label: string; maximumItems: number; pageSize: number; readPage: (start: bigint, count: bigint) => Promise<readonly T[]>; start: bigint }) {
	if (parameters.count < 0n) throw new Error(`${parameters.label} count cannot be negative`)
	if (parameters.start < 0n || parameters.start > parameters.count) throw new Error(`${parameters.label} cursor is outside its canonical count`)
	requirePositiveLimit(parameters.maximumItems, `${parameters.label} cycle item limit`)
	requirePositiveLimit(parameters.pageSize, `${parameters.label} page size`)
	const values: T[] = []
	const pageSize = BigInt(parameters.pageSize)
	const cycleEnd = parameters.start + BigInt(parameters.maximumItems) < parameters.count ? parameters.start + BigInt(parameters.maximumItems) : parameters.count
	for (let start = parameters.start; start < cycleEnd; ) {
		const remaining = cycleEnd - start
		const requested = remaining < pageSize ? remaining : pageSize
		const page = await parameters.readPage(start, requested)
		if (page.length !== Number(requested)) {
			throw new Error(`${parameters.label} page at ${start.toString()} returned ${page.length.toString()} entries instead of ${requested.toString()}`)
		}
		values.push(...page)
		start += requested
	}
	const nextStart = parameters.start + BigInt(values.length)
	return { complete: nextStart === parameters.count, nextStart, values }
}

export function updateRegistryCommitment(previous: Hash, start: bigint, values: readonly string[]) {
	let commitment = previous
	for (let offset = 0; offset < values.length; offset += 1) {
		const value = values[offset]
		if (value === undefined) throw new Error(`Immutable registry commitment lost value ${offset.toString()}`)
		const hasher = createHash('sha256')
		hasher.update(commitment, 'utf8')
		hasher.update(`:${(start + BigInt(offset)).toString()}:${Buffer.byteLength(value, 'utf8').toString()}:`, 'utf8')
		hasher.update(value, 'utf8')
		commitment = `0x${hasher.digest('hex')}` as Hash
	}
	return commitment
}

export function cursorWithCanonicalCount(cursor: CountedRegistryCursor | undefined, count: bigint, residentLimit: number, retentionMode: CountedRegistryCursor['retentionMode']) {
	const current = cursor ?? emptyCountedRegistryCursor()
	if (BigInt(current.nextIndex) > count || BigInt(current.canonicalCount) > count) throw new Error(`Immutable registry count ${count.toString()} no longer extends its authenticated cursor`)
	return { ...current, canonicalCount: count.toString(), residentLimit: residentLimit.toString(), retentionMode }
}

export function assertRegistryCountNotRegressed(cursor: CountedRegistryCursor | undefined, count: bigint, label: string) {
	if (cursor !== undefined && (BigInt(cursor.nextIndex) > count || BigInt(cursor.canonicalCount) > count)) {
		throw new Error(`${label} canonical count ${count.toString()} no longer extends its authenticated cursor`)
	}
}

export function registryCatchUpWarning(label: string, cursor: CountedRegistryCursor) {
	return BigInt(cursor.nextIndex) < BigInt(cursor.canonicalCount)
		? `${label} discovery truncated while bounded catch-up authenticated ${cursor.nextIndex} of ${cursor.canonicalCount} canonical entries`
		: `${label} discovery truncated after authenticating the exact canonical total ${cursor.canonicalCount}; configured resident safety envelope cannot hold complete topology (entry limit ${cursor.residentLimit})`
}

export function sameRegistryCursor(left: CountedRegistryCursor, right: CountedRegistryCursor) {
	return left.canonicalCount === right.canonicalCount && left.commitment === right.commitment && left.nextIndex === right.nextIndex && left.residentLimit === right.residentLimit && left.retentionMode === right.retentionMode
}

export async function advanceVaultRegistryCursor(parameters: { cachedVaults: readonly Address[]; canonicalCount: bigint; cursor: CountedRegistryCursor | undefined; label: string; limit: number; readNewestFirstPage: (start: bigint, count: bigint) => Promise<readonly Address[]> }) {
	requirePositiveLimit(parameters.limit, `${parameters.label} resident limit`)
	let changed = false
	let cachedVaults = [...parameters.cachedVaults]
	let cursor = parameters.cursor
	assertRegistryCountNotRegressed(cursor, parameters.canonicalCount, parameters.label)
	const retentionMode: CountedRegistryCursor['retentionMode'] = parameters.canonicalCount <= BigInt(parameters.limit) ? 'resident' : 'overflow'
	if (cursor?.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		cachedVaults = []
		changed = true
	}
	if (retentionMode === 'overflow' && cachedVaults.length > 0) {
		cachedVaults = []
		changed = true
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, parameters.canonicalCount, parameters.limit, retentionMode)
	if (cursor === undefined || !sameRegistryCursor(cursor, canonicalCursor)) changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(cachedVaults.length) !== BigInt(cursor.nextIndex)) throw new Error(`${parameters.label} cursor does not match its retained canonical prefix`)
	const collected = await collectCountedPages({
		count: parameters.canonicalCount,
		label: parameters.label,
		maximumItems: parameters.limit,
		pageSize: parameters.limit,
		readPage: async (start, pageCount) => {
			const end = start + pageCount
			const newestFirst = await parameters.readNewestFirstPage(parameters.canonicalCount - end, pageCount)
			return [...newestFirst].reverse().map(getAddress)
		},
		start: BigInt(cursor.nextIndex),
	})
	const newlyRegisteredVaults = collected.values
	if (newlyRegisteredVaults.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				newlyRegisteredVaults.map(vault => vault.toLowerCase()),
			),
			nextIndex: collected.nextStart.toString(),
		}
		changed = true
	}
	const vaults = cursor.retentionMode === 'resident' ? [...newlyRegisteredVaults].reverse().concat(cachedVaults) : []
	if (cursor.retentionMode === 'resident' && (BigInt(vaults.length) !== parameters.canonicalCount || new Set(vaults.map(vault => vault.toLowerCase())).size !== vaults.length)) {
		throw new Error(`${parameters.label} contains duplicate or missing immutable entries`)
	}
	return { changed, complete: collected.complete, cursor, vaults }
}
