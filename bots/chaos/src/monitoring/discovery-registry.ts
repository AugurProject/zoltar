import { requirePositiveLimit } from './discovery-client.ts'
import { type CountedRegistryCursor, emptyCountedRegistryCursor } from './topology-schema.ts'
import { type Hash } from '@zoltar/bot-shared/ethereum'
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

export function sameRegistryCursor(left: CountedRegistryCursor, right: CountedRegistryCursor) {
	return left.canonicalCount === right.canonicalCount && left.commitment === right.commitment && left.nextIndex === right.nextIndex && left.residentLimit === right.residentLimit && left.retentionMode === right.retentionMode
}
