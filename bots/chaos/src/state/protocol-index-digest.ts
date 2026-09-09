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
