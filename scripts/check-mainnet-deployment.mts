import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

type ManifestProtocolConfig = {
	forkBurnDivisor: string
	forkThresholdDivisor: string
	initialEscalationGameDepositAttoRep: string
	minimumSecurityBondDebtAttoEth: string
	minimumVaultRepDepositAttoRep: string
}

type ManifestDeploymentStep = {
	id: string
	label: string
	address: string
}

type ManifestNetwork = {
	chainId: number
	chainIdHex: string
	genesisRepTokenAddress: string
	id: 'mainnet' | 'sepolia'
	name: string
	wethAddress: string
}

type DeploymentManifest = {
	network: ManifestNetwork
	protocolConfig: ManifestProtocolConfig
	deploymentSteps: ManifestDeploymentStep[]
	derivedContracts: ManifestDeploymentStep[]
}

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..')
const manifestIds = ['mainnet', 'sepolia'] as const
type ManifestId = (typeof manifestIds)[number]

function getManifestPath(manifestId: ManifestId) {
	return path.join(repositoryRootPath, 'docs', `${manifestId}-deployment-addresses.json`)
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function readFunction(source: unknown, name: string): (...args: unknown[]) => unknown {
	if (!isRecord(source)) throw new Error(`Module for ${name} did not load as an object`)
	const value = Reflect.get(source, name)
	if (typeof value !== 'function') throw new Error(`Module export ${name} is missing`)
	return (...args: unknown[]) => value.call(undefined, ...args)
}

function readStringField(source: unknown, field: string, label = field): string {
	if (!isRecord(source)) throw new Error(`Expected ${label} source to be an object`)
	const value = Reflect.get(source, field)
	if (typeof value !== 'string') throw new Error(`Expected ${label} to be a string`)
	return value
}

function readProtocolConfig(source: unknown): ManifestProtocolConfig {
	if (!isRecord(source)) throw new Error('Mainnet protocol config did not load as an object')
	const forkBurnDivisor = Reflect.get(source, 'forkBurnDivisor')
	const forkThresholdDivisor = Reflect.get(source, 'forkThresholdDivisor')
	const initialEscalationGameDepositAttoRep = Reflect.get(source, 'initialEscalationGameDepositAttoRep')
	const minimumSecurityBondDebtAttoEth = Reflect.get(source, 'minimumSecurityBondDebtAttoEth')
	const minimumVaultRepDepositAttoRep = Reflect.get(source, 'minimumVaultRepDepositAttoRep')
	if (typeof forkBurnDivisor !== 'bigint') throw new Error('Mainnet protocol config forkBurnDivisor must be a bigint')
	if (typeof forkThresholdDivisor !== 'bigint') throw new Error('Mainnet protocol config forkThresholdDivisor must be a bigint')
	if (typeof initialEscalationGameDepositAttoRep !== 'bigint') throw new Error('Mainnet protocol config initialEscalationGameDepositAttoRep must be a bigint')
	if (typeof minimumSecurityBondDebtAttoEth !== 'bigint') throw new Error('Mainnet protocol config minimumSecurityBondDebtAttoEth must be a bigint')
	if (typeof minimumVaultRepDepositAttoRep !== 'bigint') throw new Error('Mainnet protocol config minimumVaultRepDepositAttoRep must be a bigint')
	return {
		forkBurnDivisor: forkBurnDivisor.toString(),
		forkThresholdDivisor: forkThresholdDivisor.toString(),
		initialEscalationGameDepositAttoRep: initialEscalationGameDepositAttoRep.toString(),
		minimumSecurityBondDebtAttoEth: minimumSecurityBondDebtAttoEth.toString(),
		minimumVaultRepDepositAttoRep: minimumVaultRepDepositAttoRep.toString(),
	}
}

function readDeploymentSteps(source: unknown): ManifestDeploymentStep[] {
	if (!Array.isArray(source)) throw new Error('Deployment steps did not load as an array')
	return source.map((step, index) => {
		const id = readStringField(step, 'id', `deploymentSteps[${index}].id`)
		const label = readStringField(step, 'label', `deploymentSteps[${index}].label`)
		const address = readStringField(step, 'address', `deploymentSteps[${index}].address`)
		return { id, label, address }
	})
}

function normalizeManifest(manifest: DeploymentManifest) {
	return `${JSON.stringify(manifest, undefined, '\t')}\n`
}

function readNetworkProfile(source: unknown, manifestId: ManifestId): ManifestNetwork {
	if (!isRecord(source)) throw new Error(`${manifestId} network profile did not load as an object`)
	const chain = Reflect.get(source, 'chain')
	if (!isRecord(chain)) throw new Error(`${manifestId} network profile chain did not load as an object`)
	const chainId = Reflect.get(chain, 'id')
	if (typeof chainId !== 'number') throw new Error(`${manifestId} chain id must be a number`)
	const id = readStringField(source, 'id', `${manifestId}.id`)
	if (id !== manifestId) throw new Error(`Expected ${manifestId} profile id, received ${id}`)
	return {
		chainId,
		chainIdHex: readStringField(source, 'chainIdHex', `${manifestId}.chainIdHex`),
		genesisRepTokenAddress: readStringField(source, 'genesisRepTokenAddress', `${manifestId}.genesisRepTokenAddress`),
		id,
		name: readStringField(source, 'displayName', `${manifestId}.displayName`),
		wethAddress: readStringField(source, 'wethAddress', `${manifestId}.wethAddress`),
	}
}

async function loadComputedManifest(manifestId: ManifestId): Promise<DeploymentManifest> {
	const deploymentModulePath = path.join(repositoryRootPath, 'ui', 'ts', 'protocol', 'deployment.ts')
	const deploymentHelpersModulePath = path.join(repositoryRootPath, 'ui', 'ts', 'protocol', 'deploymentHelpers.ts')
	const networkProfileModulePath = path.join(repositoryRootPath, 'ui', 'ts', 'lib', 'networkProfile.ts')
	const protocolConfigModulePath = path.join(repositoryRootPath, 'shared', 'ts', 'protocolConfig.ts')

	try {
		const deploymentModule = await import(url.pathToFileURL(deploymentModulePath).href)
		const deploymentHelpersModule = await import(url.pathToFileURL(deploymentHelpersModulePath).href)
		const networkProfileModule = await import(url.pathToFileURL(networkProfileModulePath).href)
		const protocolConfigModule = await import(url.pathToFileURL(protocolConfigModulePath).href)
		const getDeploymentSteps = readFunction(deploymentModule, 'getDeploymentSteps')
		const getInfraContractAddresses = readFunction(deploymentHelpersModule, 'getInfraContractAddresses')
		const getMainnetProtocolConfig = readFunction(protocolConfigModule, 'getMainnetProtocolConfig')
		const setRuntimeNetworkProfile = readFunction(networkProfileModule, 'setRuntimeNetworkProfile')
		const profileExportName = manifestId === 'mainnet' ? 'MAINNET_NETWORK_PROFILE' : 'SEPOLIA_NETWORK_PROFILE'
		const profile = isRecord(networkProfileModule) ? Reflect.get(networkProfileModule, profileExportName) : undefined
		if (!isRecord(profile)) throw new Error(`Module export ${profileExportName} is missing`)
		setRuntimeNetworkProfile(profile)
		const infraContractAddresses = getInfraContractAddresses(profile)
		return {
			network: readNetworkProfile(profile, manifestId),
			protocolConfig: readProtocolConfig(getMainnetProtocolConfig()),
			deploymentSteps: readDeploymentSteps(getDeploymentSteps(profile)),
			derivedContracts: [
				{
					id: 'escalationGameProofVerifier',
					label: 'Escalation Game Proof Verifier',
					address: readStringField(infraContractAddresses, 'escalationGameProofVerifier', 'infraContractAddresses.escalationGameProofVerifier'),
				},
			],
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Unable to compute ${manifestId} deployment manifest. Run bun run generate before this check. ${message}`)
	}
}

async function writeManifest(manifestPath: string, manifest: DeploymentManifest) {
	await fs.mkdir(path.dirname(manifestPath), { recursive: true })
	await fs.writeFile(manifestPath, normalizeManifest(manifest))
}

async function readManifest(manifestId: ManifestId): Promise<DeploymentManifest> {
	const manifestPath = getManifestPath(manifestId)
	const rawManifest = await fs.readFile(manifestPath, 'utf8')
	const parsedManifest: unknown = JSON.parse(rawManifest)
	if (!isRecord(parsedManifest)) throw new Error(`${manifestId} deployment manifest must be an object`)
	const network = Reflect.get(parsedManifest, 'network')
	const protocolConfig = Reflect.get(parsedManifest, 'protocolConfig')
	const deploymentSteps = Reflect.get(parsedManifest, 'deploymentSteps')
	const derivedContracts = Reflect.get(parsedManifest, 'derivedContracts')
	if (!isRecord(network)) throw new Error(`${manifestId} deployment manifest network must be an object`)
	if (!isRecord(protocolConfig)) throw new Error(`${manifestId} deployment manifest protocolConfig must be an object`)
	const chainId = Reflect.get(network, 'chainId')
	if (typeof chainId !== 'number') throw new Error(`${manifestId} deployment manifest chainId must be a number`)
	const id = readStringField(network, 'id', 'network.id')
	if (id !== manifestId) throw new Error(`Expected ${manifestId} manifest id, received ${id}`)
	return {
		network: {
			chainId,
			chainIdHex: readStringField(network, 'chainIdHex', 'network.chainIdHex'),
			genesisRepTokenAddress: readStringField(network, 'genesisRepTokenAddress', 'network.genesisRepTokenAddress'),
			id,
			name: readStringField(network, 'name', 'network.name'),
			wethAddress: readStringField(network, 'wethAddress', 'network.wethAddress'),
		},
		protocolConfig: {
			forkBurnDivisor: readStringField(protocolConfig, 'forkBurnDivisor', 'protocolConfig.forkBurnDivisor'),
			forkThresholdDivisor: readStringField(protocolConfig, 'forkThresholdDivisor', 'protocolConfig.forkThresholdDivisor'),
			initialEscalationGameDepositAttoRep: readStringField(protocolConfig, 'initialEscalationGameDepositAttoRep', 'protocolConfig.initialEscalationGameDepositAttoRep'),
			minimumSecurityBondDebtAttoEth: readStringField(protocolConfig, 'minimumSecurityBondDebtAttoEth', 'protocolConfig.minimumSecurityBondDebtAttoEth'),
			minimumVaultRepDepositAttoRep: readStringField(protocolConfig, 'minimumVaultRepDepositAttoRep', 'protocolConfig.minimumVaultRepDepositAttoRep'),
		},
		deploymentSteps: readDeploymentSteps(deploymentSteps),
		derivedContracts: readDeploymentSteps(derivedContracts),
	}
}

export async function writeMainnetDeploymentManifest(): Promise<void> {
	for (const manifestId of manifestIds) {
		await writeManifest(getManifestPath(manifestId), await loadComputedManifest(manifestId))
	}
}

export function assertDeploymentManifestCurrent(manifestId: ManifestId, expected: string, computed: string): void {
	if (expected === computed) return
	const displayName = manifestId === 'mainnet' ? 'Mainnet' : 'Sepolia'
	throw new Error(`${displayName} deployment manifest is stale. Run bun ./scripts/check-mainnet-deployment.mts --write after confirming the new values.`)
}

export async function assertDeploymentManifestsCurrent(): Promise<void> {
	for (const manifestId of manifestIds) {
		const expectedManifest = await readManifest(manifestId)
		const computedManifest = await loadComputedManifest(manifestId)
		const expected = normalizeManifest(expectedManifest)
		const computed = normalizeManifest(computedManifest)
		assertDeploymentManifestCurrent(manifestId, expected, computed)
	}
}

async function main() {
	const write = process.argv.includes('--write')
	if (write) {
		await writeMainnetDeploymentManifest()
		return
	}

	await assertDeploymentManifestsCurrent()
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	main().catch(error => {
		console.error(error)
		process.exit(1)
	})
}
