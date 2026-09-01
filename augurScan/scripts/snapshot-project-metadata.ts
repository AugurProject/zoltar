import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
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

const serializeManifest = (contracts: readonly (readonly [string, string, string])[]): string => {
	const entries = contracts.map((entry) => `\t\t[${entry.map((value) => JSON.stringify(value)).join(', ')}]`).join(',\n')
	return `{\n\t"contracts": [\n${entries}\n\t]\n}\n`
}

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

type DeploymentFile = {
	readonly network: {
		readonly id: string
		readonly genesisRepTokenAddress: string
		readonly wethAddress: string
	}
	readonly deploymentSteps: readonly { readonly id: string; readonly label: string; readonly address: string }[]
	readonly derivedContracts: readonly { readonly id: string; readonly label: string; readonly address: string }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const requiredString = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || value === '') throw new Error(`${name} must be a nonempty string`)
	return value
}
const deploymentEntries = (value: unknown, name: string): DeploymentFile['deploymentSteps'] => {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
	return value.map((entry, index) => {
		if (!isRecord(entry)) throw new Error(`${name}[${index}] must be an object`)
		return {
			id: requiredString(entry['id'], `${name}[${index}].id`),
			label: requiredString(entry['label'], `${name}[${index}].label`),
			address: requiredString(entry['address'], `${name}[${index}].address`),
		}
	})
}
const deploymentFile = (value: unknown, source: string): DeploymentFile => {
	if (!isRecord(value) || !isRecord(value['network'])) throw new Error(`${source} has no network object`)
	return {
		network: {
			id: requiredString(value['network']['id'], `${source}.network.id`),
			genesisRepTokenAddress: requiredString(value['network']['genesisRepTokenAddress'], `${source}.network.genesisRepTokenAddress`),
			wethAddress: requiredString(value['network']['wethAddress'], `${source}.network.wethAddress`),
		},
		deploymentSteps: deploymentEntries(value['deploymentSteps'], `${source}.deploymentSteps`),
		derivedContracts: deploymentEntries(value['derivedContracts'], `${source}.derivedContracts`),
	}
}

const manifestEntries = (value: unknown, source: string): [string, string, string][] => {
	if (!isRecord(value) || !Array.isArray(value['contracts'])) throw new Error(`${source} has no contracts array`)
	return value['contracts'].map((entry, index) => {
		if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`${source}.contracts[${index}] must be an address, label, and kind tuple`)
		return [
			requiredString(entry[0], `${source}.contracts[${index}][0]`),
			requiredString(entry[1], `${source}.contracts[${index}][1]`),
			requiredString(entry[2], `${source}.contracts[${index}][2]`),
		]
	})
}

const deploymentKind: Readonly<Record<string, string>> = {
	deploymentStatusOracle: 'deploymentStatusOracle',
	escalationGameClaimDelegate: 'escalationGameClaimDelegate',
	escalationGameProofVerifier: 'escalationProofVerifier',
	escalationGameFactory: 'escalationGameFactory',
	multicall3: 'multicall3',
	openOracle: 'openOracle',
	priceOracleManagerAndOperatorQueuerFactory: 'priceCoordinatorFactory',
	proxyDeployer: 'proxyDeployer',
	scalarOutcomes: 'scalarOutcomes',
	securityPoolFactory: 'securityPoolFactory',
	securityPoolForker: 'securityPoolForker',
	securityPoolOperationsDelegate: 'securityPoolOperationsDelegate',
	securityPoolUtils: 'securityPoolUtils',
	shareTokenFactory: 'shareTokenFactory',
	uniformPriceDualCapBatchAuctionFactory: 'truthAuctionFactory',
	zoltar: 'zoltar',
	zoltarQuestionData: 'zoltarQuestionData',
}

const usdcAddress = {
	mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
} as const

for (const networkId of ['mainnet', 'sepolia'] as const) {
	const deploymentPath = path.join(projectRoot, 'docs', `${networkId}-deployment-addresses.json`)
	const deployment = deploymentFile(JSON.parse(await readFile(deploymentPath, 'utf8')), deploymentPath)
	if (deployment.network.id !== networkId) throw new Error(`${deploymentPath} describes ${deployment.network.id}, expected ${networkId}`)
	const configured = [...deployment.deploymentSteps, ...deployment.derivedContracts].flatMap(({ id, label, address }) => {
		const kind = deploymentKind[id]
		return kind === undefined ? [] : [[address, label, kind] as [string, string, string]]
	})
	configured.push(
		[deployment.network.genesisRepTokenAddress, 'Genesis REP', 'reputationToken'],
		[deployment.network.wethAddress, 'Wrapped Ether', 'weth'],
		[usdcAddress[networkId], 'USD Coin', 'usdc'],
	)
	const manifestPath = path.join(manifestsRoot, `${networkId}.json`)
	const historicalManifestPath = configuredOutputRoot === undefined ? manifestPath : path.resolve(import.meta.dir, `../config/manifests/${networkId}.json`)
	const historical = manifestEntries(JSON.parse(await readFile(historicalManifestPath, 'utf8')), historicalManifestPath)
	const unique = [...new Map([...historical, ...configured].map((entry) => [entry[0].toLowerCase(), entry])).values()]
	await Bun.write(manifestPath, serializeManifest(unique))
}

console.log(`Wrote ${Object.keys(contracts).length} ABIs and refreshed mainnet/Sepolia manifests`)
