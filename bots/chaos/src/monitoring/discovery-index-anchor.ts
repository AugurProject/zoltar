import type { Hash } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from './protocol-index.ts'
import { ChaosProtocolIndexReorgError } from './protocol-index-context.ts'

/** Authenticate indexed identities before discovery dereferences their contracts. */
export async function validateDiscoveryIndexAnchor(index: ChaosProtocolIndex | undefined, anchorBlockNumber: bigint, readCanonicalHash: (blockNumber: bigint) => Promise<Hash>) {
	if (index === undefined) return
	const cursor = BigInt(index.cursor.blockNumber)
	if (cursor > anchorBlockNumber) throw new ChaosProtocolIndexReorgError('Indexed discovery cursor is ahead of the canonical scan', BigInt(index.startBlock))
	const canonical = await readCanonicalHash(cursor)
	if (canonical.toLowerCase() !== index.cursor.blockHash.toLowerCase()) throw new ChaosProtocolIndexReorgError(`Indexed discovery block ${cursor} changed from ${index.cursor.blockHash} to ${canonical}`, cursor)
}
