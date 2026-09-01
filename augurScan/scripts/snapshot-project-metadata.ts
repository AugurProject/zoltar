import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { projectManifests } from './project-manifests.ts'
import { contractSourceHash, contractSources } from './project-metadata-source.ts'

const projectRoot = path.resolve(import.meta.dir, '../..')
const compiledArtifactPath = path.join(projectRoot, 'solidity/artifacts/Contracts.json')
const outputRootIndex = process.argv.indexOf('--output-root')
const configuredOutputRoot = outputRootIndex < 0 ? undefined : process.argv[outputRootIndex + 1]
if (outputRootIndex >= 0 && (configuredOutputRoot === undefined || configuredOutputRoot === '')) throw new Error('--output-root requires a directory')
const configOutputRoot = configuredOutputRoot === undefined ? path.resolve(import.meta.dir, '../config') : path.resolve(configuredOutputRoot)
const outputPath = path.join(configOutputRoot, 'abis.json')
const manifestsRoot = path.join(configOutputRoot, 'manifests')
await mkdir(manifestsRoot, { recursive: true })

const sources = await contractSources(projectRoot)
const vendorPrefix = 'contracts/statoblast/openOracle/openzeppelin/contracts/'
for (const [name, source] of Object.entries(sources)) {
	if (name.startsWith(vendorPrefix)) sources[`@openzeppelin/contracts/${name.slice(vendorPrefix.length)}`] = source
}
const result = JSON.parse(await readFile(compiledArtifactPath, 'utf8')) as {
	contracts?: Record<string, Record<string, { abi?: readonly unknown[] }>>
}
if (result.contracts === undefined) throw new Error(`Canonical Solidity artifact has no contracts: ${compiledArtifactPath}`)

const abiKeyOrder = ['anonymous', 'indexed', 'components', 'inputs', 'internalType', 'name', 'outputs', 'stateMutability', 'type'] as const
const abiKeyPriorities = new Map<string, number>(abiKeyOrder.map((key, index) => [key, index]))
function canonicalizeAbiValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalizeAbiValue)
	if (typeof value !== 'object' || value === null) return value
	const entries = Object.entries(value).sort(([left], [right]) => {
		const leftIndex = abiKeyPriorities.get(left)
		const rightIndex = abiKeyPriorities.get(right)
		if (leftIndex === undefined && rightIndex === undefined) return left.localeCompare(right)
		if (leftIndex === undefined) return 1
		if (rightIndex === undefined) return -1
		return leftIndex - rightIndex
	})
	return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalizeAbiValue(entryValue)]))
}

function canonicalizeAbi(abi: readonly unknown[]): readonly unknown[] {
	const canonical = canonicalizeAbiValue(abi)
	if (!Array.isArray(canonical)) throw new Error('ABI canonicalization did not return an array')
	return canonical
}

const contracts: Record<string, { source: string; abi: readonly unknown[] }> = {}
for (const source of Object.keys(result.contracts).sort()) {
	if (sources[source] === undefined) continue
	const sourceContracts = result.contracts[source]
	if (sourceContracts === undefined) continue
	for (const name of Object.keys(sourceContracts).sort()) {
		const artifact = sourceContracts[name]
		if (artifact?.abi === undefined || artifact.abi.length === 0) continue
		const abi = canonicalizeAbi(artifact.abi)
		const existing = contracts[name]
		if (existing !== undefined && JSON.stringify(existing.abi) !== JSON.stringify(abi)) {
			contracts[`${source}:${name}`] = { source, abi }
			continue
		}
		contracts[name] = { source, abi }
	}
}

for (const [source, name] of [
	['contracts/trading/TwoWayConstantProductFactory.sol', 'TwoWayConstantProductFactory'],
	['contracts/trading/TwoWayConstantProductPair.sol', 'TwoWayConstantProductPair'],
] as const) {
	const artifact = result.contracts?.[source]?.[name]
	if (artifact?.abi === undefined) throw new Error(`Canonical Solidity artifact has no ${name} ABI`)
	contracts[name] = { source, abi: canonicalizeAbi(artifact.abi) }
}

const payload = {
	sourceHash: contractSourceHash(sources),
	contracts,
}

await Bun.write(outputPath, `${JSON.stringify(payload, undefined, 2)}\n`)

const manifests = await projectManifests(projectRoot)
await Promise.all(
	(['mainnet', 'sepolia'] as const).map(async (networkId) => await Bun.write(path.join(manifestsRoot, `${networkId}.json`), manifests[networkId])),
)

console.log(`Wrote ${Object.keys(contracts).length} ABIs and refreshed mainnet/Sepolia manifests`)
