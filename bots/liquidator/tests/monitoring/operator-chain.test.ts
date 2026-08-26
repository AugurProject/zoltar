import { expect, test } from 'bun:test'
import { canonicalBlockHashFromReaders } from '#monitoring/operator-chain'

test('rejects final market snapshot revalidation when configured readers diverge', async () => {
	const hashes = new Map([
		['https://primary.example', `0x${'11'.repeat(32)}` as const],
		['https://secondary.example', `0x${'22'.repeat(32)}` as const],
	])

	await expect(canonicalBlockHashFromReaders([...hashes.keys()], 1, async endpoint => hashes.get(endpoint))).rejects.toThrow('RPC disagreement')
})
