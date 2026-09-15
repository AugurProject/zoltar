import { createHash } from 'node:crypto'
import sources from '../config/dependency-abi-sources.json'
import type { Abi } from '../src/ethereum.ts'

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

export function verifyDependencyAbis(candidate: Readonly<Record<string, Abi>>): void {
	if (Object.keys(candidate).sort().join(',') !== Object.keys(sources).sort().join(',')) throw new Error('Dependency ABI kinds do not match the pinned sources')
	for (const [kind, source] of Object.entries(sources)) {
		if (sha256(JSON.stringify(candidate[kind])) !== source.abiSha256) throw new Error(`Pinned dependency ABI changed: ${kind}. Run metadata:dependencies after reviewing its source pin.`)
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
