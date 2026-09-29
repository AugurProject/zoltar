import { createHash } from 'node:crypto'
import type { Hex } from '@zoltar/bot-shared/ethereum'

export function sha256(value: string): Hex {
	return `0x${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function collectionDigest(digests: readonly Hex[]): Hex {
	const hasher = createHash('sha256')
	for (let ordinal = 0; ordinal < digests.length; ordinal += 1) hasher.update(`${ordinal.toString()}:${digests[ordinal] ?? ''}\n`, 'utf8')
	return `0x${hasher.digest('hex')}`
}

/** Seals an immutable manifest with the digest of its canonical JSON payload. */
export function manifestWithDigest<Payload extends object>(payload: Payload): Payload & { manifestDigest: Hex } {
	const serialized = JSON.stringify(payload)
	if (serialized === undefined) throw new Error('Manifest payload is not JSON serializable')
	return { ...payload, manifestDigest: sha256(serialized) }
}
