import { zeroHash, type Block } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'

type ClaimReadClient = Pick<ReadClient, 'readContract' | 'getBlockNumber'> & {
	getBlock: (request: { blockNumber: bigint }) => Promise<Pick<Block, 'hash' | 'number'>>
}

function readKey(value: unknown) {
	return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `${item}n` : item))
}

/** A request owns its cache and block number; canonical hash checks bracket every read. */
export async function withClaimReadContext<T>(client: ClaimReadClient, read: (context: Pick<ReadClient, 'readContract'>, blockNumber: bigint) => Promise<T>): Promise<T> {
	async function readAnchor(blockNumber: bigint) {
		const anchor = await client.getBlock({ blockNumber })
		if (typeof anchor.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(anchor.hash) || anchor.hash === zeroHash || anchor.number !== blockNumber) throw new Error('Claim block anchor is unavailable. Refresh and retry.')
		return anchor
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		const blockNumber = await client.getBlockNumber()
		const anchor = await readAnchor(blockNumber)
		const cache = new Map<string, Promise<unknown>>()
		function memo<TValue>(key: string, load: () => Promise<TValue>): Promise<TValue> {
			const cached = cache.get(key)
			// Each key includes the ABI, function, arguments, and address in this one block.
			if (cached !== undefined) return cached as Promise<TValue>
			const pending = load()
			cache.set(key, pending)
			return pending
		}
		const context: Pick<ReadClient, 'readContract'> = { readContract: request => memo(readKey(request), () => client.readContract({ ...request, blockNumber })) }
		const result = await read(context, blockNumber).then(
			value => ({ ok: true, value }) as const,
			error => ({ ok: false, error }) as const,
		)
		const current = await readAnchor(blockNumber)
		if (current.hash !== anchor.hash || current.number !== blockNumber) {
			if (attempt === 0) continue
			throw new Error('Claim block changed repeatedly. Refresh and retry.')
		}
		if (!result.ok) throw result.error
		return result.value
	}
	throw new Error('Claim block could not be verified.')
}
