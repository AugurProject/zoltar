import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sources from '../config/dependency-abi-sources.json'
import type { Abi } from '../src/ethereum.ts'

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

export function verifyDependencyAbis(candidate: unknown): asserts candidate is Readonly<Record<string, Abi>> {
	if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new TypeError('Vendored dependency ABIs must contain an object')
	if (Object.keys(candidate).sort().join(',') !== Object.keys(sources).sort().join(',')) throw new TypeError('Dependency ABI kinds do not match the pinned sources')
	for (const [kind, source] of Object.entries(sources)) {
		if (sha256(JSON.stringify(Reflect.get(candidate, kind)) ?? '') !== source.abiSha256) throw new TypeError(`Pinned dependency ABI changed: ${kind}. Update the vendored ABI and its source pin together after review.`)
	}
}

export async function verifyDependencyAbiFile(source: string): Promise<void> {
	verifyDependencyAbis(JSON.parse(await readFile(source, 'utf8')))
}
