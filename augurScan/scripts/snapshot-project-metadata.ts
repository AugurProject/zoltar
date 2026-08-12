import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import solc from 'solc'

const projectRoot = path.resolve(import.meta.dir, '../..')
const contractsRoot = path.join(projectRoot, 'solidity/contracts')
const outputPath = path.resolve(import.meta.dir, '../config/abis.json')
const manifestsRoot = path.resolve(import.meta.dir, '../config/manifests')

const collectSources = async (directory: string, relativeRoot = path.join(projectRoot, 'solidity')): Promise<Record<string, { content: string }>> => {
	const sources: Record<string, { content: string }> = {}
	const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
	for (const entry of entries) {
		const absolute = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'test') continue
			Object.assign(sources, await collectSources(absolute, relativeRoot))
			continue
		}
		if (!entry.name.endsWith('.sol')) continue
		const relative = path.relative(relativeRoot, absolute).replaceAll(path.sep, '/')
		const content = (await readFile(absolute, 'utf8')).replace('pragma solidity 0.8.28;', 'pragma solidity >=0.8.28;')
		sources[relative] = { content }
	}
	return sources
}

const sources = await collectSources(contractsRoot)
const vendorPrefix = 'contracts/peripherals/openOracle/openzeppelin/contracts/'
for (const [name, source] of Object.entries(sources)) {
	if (name.startsWith(vendorPrefix)) sources[`@openzeppelin/contracts/${name.slice(vendorPrefix.length)}`] = source
}
const input = {
	language: 'Solidity',
	sources,
	settings: {
		outputSelection: {
			'*': {
				'*': ['abi'],
			},
		},
	},
}

const result = JSON.parse(solc.compile(JSON.stringify(input))) as {
	contracts?: Record<string, Record<string, { abi: readonly unknown[] }>>
	errors?: readonly { severity: string; formattedMessage: string }[]
}
const errors = result.errors?.filter((error) => error.severity === 'error') ?? []
if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
if (result.contracts === undefined) throw new Error('Solidity compiler returned no contracts')

const contracts: Record<string, { source: string; abi: readonly unknown[] }> = {}
for (const source of Object.keys(result.contracts).sort()) {
	const sourceContracts = result.contracts[source]
	if (sourceContracts === undefined) continue
	for (const name of Object.keys(sourceContracts).sort()) {
		const artifact = sourceContracts[name]
		if (artifact === undefined || artifact.abi.length === 0) continue
		const existing = contracts[name]
		if (existing !== undefined && JSON.stringify(existing.abi) !== JSON.stringify(artifact.abi)) {
			contracts[`${source}:${name}`] = { source, abi: artifact.abi }
			continue
		}
		contracts[name] = { source, abi: artifact.abi }
	}
}

const tradingSources = {
	...(await collectSources(contractsRoot, projectRoot)),
	...(await collectSources(path.join(projectRoot, 'trading/contracts'), projectRoot)),
}
const tradingVendorPrefix = 'solidity/contracts/peripherals/openOracle/openzeppelin/contracts/'
for (const [name, source] of Object.entries(tradingSources)) {
	if (name.startsWith(tradingVendorPrefix)) tradingSources[`@openzeppelin/contracts/${name.slice(tradingVendorPrefix.length)}`] = source
}
const tradingResult = JSON.parse(
	solc.compile(
		JSON.stringify({
			language: 'Solidity',
			sources: tradingSources,
			settings: { outputSelection: { '*': { '*': ['abi'] } } },
		}),
	),
) as typeof result
const tradingErrors = tradingResult.errors?.filter((error) => error.severity === 'error') ?? []
if (tradingErrors.length > 0) throw new Error(tradingErrors.map((error) => error.formattedMessage).join('\n'))
for (const [source, name] of [
	['trading/contracts/TwoWayConstantProductFactory.sol', 'TwoWayConstantProductFactory'],
	['trading/contracts/TwoWayConstantProductPair.sol', 'TwoWayConstantProductPair'],
] as const) {
	const artifact = tradingResult.contracts?.[source]?.[name]
	if (artifact === undefined) throw new Error(`Solidity compiler returned no ${name} ABI`)
	contracts[name] = { source, abi: artifact.abi }
}

const payload = {
	sourceHash: createHash('sha256')
		.update(
			Object.entries(tradingSources)
				.filter(([name]) => !name.startsWith('@openzeppelin/'))
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([name, source]) => `${name}\0${source.content}`)
				.join('\0'),
		)
		.digest('hex'),
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
	securityPoolUtils: 'securityPoolUtils',
	shareTokenFactory: 'shareTokenFactory',
	uniformPriceDualCapBatchAuctionFactory: 'truthAuctionFactory',
	zoltar: 'zoltar',
	zoltarQuestionData: 'zoltarQuestionData',
}

for (const networkId of ['mainnet', 'sepolia']) {
	const deploymentPath = path.join(projectRoot, 'docs', `${networkId}-deployment-addresses.json`)
	const deployment = deploymentFile(JSON.parse(await readFile(deploymentPath, 'utf8')), deploymentPath)
	if (deployment.network.id !== networkId) throw new Error(`${deploymentPath} describes ${deployment.network.id}, expected ${networkId}`)
	const configured = [...deployment.deploymentSteps, ...deployment.derivedContracts].flatMap(({ id, label, address }) => {
		const kind = deploymentKind[id]
		return kind === undefined ? [] : [[address, label, kind] as [string, string, string]]
	})
	configured.push([deployment.network.genesisRepTokenAddress, 'Genesis REP', 'reputationToken'], [deployment.network.wethAddress, 'Wrapped Ether', 'weth'])
	const unique = [...new Map(configured.map((entry) => [entry[0].toLowerCase(), entry])).values()]
	await Bun.write(path.join(manifestsRoot, `${networkId}.json`), `${JSON.stringify({ contracts: unique }, undefined, 2)}\n`)
}

console.log(`Wrote ${Object.keys(contracts).length} ABIs and refreshed mainnet/Sepolia manifests`)
