import { expect, test } from 'bun:test'
import { getAddress } from '../../src/ethereum.ts'
import { readTokenMetadata, tokenMetadataReadCandidates } from '../../src/indexer/planning.ts'
const address = getAddress('0x0000000000000000000000000000000000000001')
const candidatesFor = (metadata: Awaited<ReturnType<typeof readTokenMetadata>>, block: bigint) => tokenMetadataReadCandidates([address], new Map([[address, metadata]]), block, 0n)

test('#1467: contract metadata failures are permanent, transport failures are retried', async () => {
	for (const name of ['ContractFunctionRevertedError', 'AbiDecodingError', 'ResponseBodyTooLargeError']) {
		const failure = Object.assign(new Error('failed metadata'), { name })
		const metadata = await readTokenMetadata(address, 10n, {
			decimals: async () => {
				throw failure
			},
			name: async () => 'Token',
			symbol: async () => 'TKN',
		})
		expect(metadata.readError).toBeDefined()
		expect(candidatesFor(metadata, 1_000_000n)).toEqual([])
	}
	const failure = Object.assign(new Error('connection unavailable'), { name: 'HttpRequestError' })
	const transient = await readTokenMetadata(address, 10n, {
		decimals: async () => {
			throw failure
		},
		name: async () => 'Token',
		symbol: async () => 'TKN',
	})
	expect(candidatesFor(transient, 34n)).toEqual([])
	expect(candidatesFor(transient, 35n)).toEqual([address])
})

test('#1443: oversized token metadata is rejected and never copied into labels', async () => {
	const metadata = await readTokenMetadata(address, 10n, { decimals: async () => 18, name: async () => 'x'.repeat(1_000_000), symbol: async () => '🦊'.repeat(100_000) })
	expect(metadata.name).toBeUndefined()
	expect(metadata.symbol).toBeUndefined()
	expect(metadata.readError).toContain('metadata exceeds')
	expect(candidatesFor(metadata, 1_000_000n)).toEqual([])
})

test('#1467: transient retries have a fixed budget and do not starve older work', () => {
	const candidates = Array.from({ length: 100 }, (_, index) => getAddress(`0x${(index + 1).toString(16).padStart(40, '0')}`))
	const metadata = new Map(candidates.map(address => [address.toLowerCase(), { address, readError: 'HttpRequestError', readBlock: 10n }]))
	const first = tokenMetadataReadCandidates(candidates, metadata, 100n, 0n)
	expect(first).toHaveLength(32)
	for (const address of first) metadata.set(address.toLowerCase(), { address, readError: 'HttpRequestError', readBlock: 100n })
	const second = tokenMetadataReadCandidates(candidates, metadata, 101n, 0n)
	expect(second).toHaveLength(32)
	expect(second.some(address => first.includes(address))).toBe(false)
})
