import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { projectDeploymentIds, projectManifests } from './project-manifests.ts'
import dependencyAbis from '../config/dependency-abis.json'
import { verifyDependencyAbis } from './dependency-abis.ts'
import { serializeSystemContracts, systemContractMappings } from './project-system-contracts.ts'
import { contractSourceHash, contractSources } from './project-metadata-source.ts'
import { assertAbiCoverage } from '../src/abi-catalog.ts'
import { discoveredContractKinds } from '../src/contract-discovery.ts'
import { parseManifestValue } from '../src/manifest.ts'
import { systemInterfaces } from '../src/system-interfaces.ts'

const projectRoot = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(projectRoot, '..')
const catalogPath = path.join(projectRoot, 'config/abis.json')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { sourceHash?: unknown; contracts: Record<string, unknown> }
const sourceHash = contractSourceHash(await contractSources(repositoryRoot))
if (catalog.sourceHash !== sourceHash) throw new Error('Generated augurScan metadata is stale: config/abis.json. Run bun run metadata:snapshot.')

const artifactPath = path.join(repositoryRoot, 'solidity/artifacts/Contracts.json')
const artifactAvailable = await access(artifactPath).then(
	() => true,
	(error: unknown) => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	},
)
const stale: string[] = []
verifyDependencyAbis(dependencyAbis)
const mappings = systemContractMappings(Object.keys(catalog.contracts), await projectDeploymentIds(repositoryRoot))
if (serializeSystemContracts(mappings) !== (await readFile(path.join(projectRoot, 'config/system-contracts.generated.ts'), 'utf8'))) stale.push('config/system-contracts.generated.ts')
assertAbiCoverage([...Object.keys(systemInterfaces), ...discoveredContractKinds])
const expectedManifests = await projectManifests(repositoryRoot, mappings.deploymentKinds)
for (const [networkId, expected] of Object.entries(expectedManifests)) {
	const relativePath = `manifests/${networkId}.json`
	const current = await readFile(path.join(projectRoot, 'config', relativePath), 'utf8')
	parseManifestValue(JSON.parse(current), relativePath)
	if (expected !== current) stale.push(`config/${relativePath}`)
}
if (artifactAvailable) {
	const generatedRoot = await mkdtemp(path.join(tmpdir(), 'augurscan-metadata-'))
	try {
		const generation = Bun.spawn(['bun', 'scripts/snapshot-project-metadata.ts', '--output-root', generatedRoot], {
			cwd: projectRoot,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout, stderr] = await Promise.all([generation.exited, new Response(generation.stdout).text(), new Response(generation.stderr).text()])
		if (exitCode !== 0) throw new Error(`Unable to generate augurScan metadata for comparison\n${stderr || stdout}`)
		for (const relativePath of ['abis.json', 'system-contracts.generated.ts']) {
			const [expected, current] = await Promise.all([readFile(path.join(generatedRoot, relativePath), 'utf8'), readFile(path.join(projectRoot, 'config', relativePath), 'utf8')])
			if (expected !== current) stale.push(`config/${relativePath}`)
		}
	} finally {
		await rm(generatedRoot, { recursive: true, force: true })
	}
}
if (stale.length > 0) throw new Error(`Generated augurScan metadata is stale: ${stale.join(', ')}. Run bun run metadata:snapshot.`)
process.stdout.write(`Generated augurScan metadata is current${artifactAvailable ? '' : ' by contract source hash; canonical artifacts were unavailable for an exact ABI comparison'}.\n`)
