import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sources from '../config/dependency-abi-sources.json'
import type { Abi } from '../src/ethereum.ts'

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

export function verifyDependencyAbis(candidate: unknown): asserts candidate is Readonly<Record<string, Abi>> {
	if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new TypeError('Dependency ABI cache must contain an object')
	if (Object.keys(candidate).sort().join(',') !== Object.keys(sources).sort().join(',')) throw new TypeError('Dependency ABI kinds do not match the pinned sources')
	for (const [kind, source] of Object.entries(sources)) {
		if (sha256(JSON.stringify(Reflect.get(candidate, kind)) ?? '') !== source.abiSha256) throw new TypeError(`Pinned dependency ABI changed: ${kind}. Run metadata:dependencies after reviewing its source pin.`)
	}
}

export async function fetchDependencyAbis(fetchArtifact: (url: string) => Promise<Response> = fetch): Promise<Readonly<Record<string, Abi>>> {
	const result: Record<string, Abi> = {}
	for (const [kind, source] of Object.entries(sources)) {
		const response = await fetchArtifact(source.url)
		if (!response.ok) throw new Error(`Unable to fetch ${kind}: HTTP ${response.status}`)
		const bytes = new Uint8Array(await response.arrayBuffer())
		if (sha256(bytes) !== source.artifactSha256) throw new Error(`Upstream artifact checksum mismatch: ${kind}`)
		// The complete artifact and its ABI are independently pinned before use.
		const artifact = JSON.parse(new TextDecoder().decode(bytes))
		if (!Array.isArray(artifact.abi) || sha256(JSON.stringify(artifact.abi)) !== source.abiSha256) throw new Error(`Upstream ABI checksum mismatch: ${kind}`)
		result[kind] = artifact.abi
	}
	verifyDependencyAbis(result)
	return result
}

export async function ensureDependencyAbis(output: string, fetchArtifact: (url: string) => Promise<Response> = fetch): Promise<void> {
	let cached: string | undefined
	try {
		cached = await readFile(output, 'utf8')
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
	}
	if (cached !== undefined) {
		try {
			verifyDependencyAbis(JSON.parse(cached))
			return
		} catch (error) {
			if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error
			console.log(`Refreshing generated dependency ABIs: ${error.message}`)
		}
	}
	// Missing or stale build outputs are regenerated. Downloads must still
	// match both upstream-artifact and extracted-ABI pins before any write.
	const abis = await fetchDependencyAbis(fetchArtifact)
	await Bun.write(output, `${JSON.stringify(abis, undefined, '\t')}\n`)
	console.log('Generated dependency ABIs from verified pinned artifacts')
}
