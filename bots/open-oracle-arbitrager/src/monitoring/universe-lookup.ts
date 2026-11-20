import type { Address } from '@zoltar/bot-shared/ethereum'
import { loadUniverseTree } from '@zoltar/bot-shared/monitoring/universe-policy'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { ReadClient } from '#core/operator-types'

/** Resolve only selected lineages, pinned to one canonical snapshot across readers. */
export async function lookupUniverseLineages(readers: readonly ReadClient[], zoltar: Address, ids: readonly bigint[], quorum: 1 | 2) {
	const first = readers[0]
	if (first === undefined) throw new Error('Universe lookup requires a read endpoint')
	const head = await first.getBlock()
	if (head.number === undefined || head.hash === undefined) throw new Error('Universe lookup head is missing canonical identity')
	const blockNumber = head.number
	const blockHash = head.hash
	return settledQuorumValue(
		'universe lookup lineages',
		readers.map(async (reader, index) => {
			const before = await reader.getBlock({ blockNumber })
			if (before.hash !== blockHash) throw new Error('Universe lookup readers disagree about the canonical block')
			const value = await loadUniverseTree(reader, zoltar, blockNumber, ids)
			if ((await reader.getBlock({ blockNumber })).hash !== blockHash) throw new Error('Universe lookup canonical block changed')
			return { endpoint: String(index), value }
		}),
		quorum,
	)
}
