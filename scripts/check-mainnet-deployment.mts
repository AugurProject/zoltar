import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

type ManifestProtocolConfig = {
	forkBurnDivisor: string
	forkThresholdDivisor: string
	initialEscalationGameDeposit: string
}

type ManifestDeploymentStep = {
	id: string
	label: string
	address: string
}

type MainnetDeploymentManifest = {
	protocolConfig: ManifestProtocolConfig
	deploymentSteps: ManifestDeploymentStep[]
	derivedContracts: ManifestDeploymentStep[]
}

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..')
const manifestPath = path.join(repositoryRootPath, 'docs', 'mainnet-deployment-addresses.json')
const markdownPath = path.join(repositoryRootPath, 'docs', 'mainnet-deployment-addresses.md')

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
	const initialEscalationGameDeposit = Reflect.get(source, 'initialEscalationGameDeposit')
	if (typeof forkBurnDivisor !== 'bigint') throw new Error('Mainnet protocol config forkBurnDivisor must be a bigint')
	if (typeof forkThresholdDivisor !== 'bigint') throw new Error('Mainnet protocol config forkThresholdDivisor must be a bigint')
	if (typeof initialEscalationGameDeposit !== 'bigint') throw new Error('Mainnet protocol config initialEscalationGameDeposit must be a bigint')
	return {
		forkBurnDivisor: forkBurnDivisor.toString(),
		forkThresholdDivisor: forkThresholdDivisor.toString(),
		initialEscalationGameDeposit: initialEscalationGameDeposit.toString(),
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

function normalizeManifest(manifest: MainnetDeploymentManifest) {
	return `${JSON.stringify(manifest, undefined, '\t')}\n`
}

async function loadComputedManifest(): Promise<MainnetDeploymentManifest> {
	const deploymentModulePath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts', 'deployment.ts')
	const deploymentHelpersModulePath = path.join(repositoryRootPath, 'ui', 'ts', 'contracts', 'deploymentHelpers.ts')
	const protocolConfigModulePath = path.join(repositoryRootPath, 'shared', 'ts', 'protocolConfig.ts')

	try {
		const deploymentModule = await import(url.pathToFileURL(deploymentModulePath).href)
		const deploymentHelpersModule = await import(url.pathToFileURL(deploymentHelpersModulePath).href)
		const protocolConfigModule = await import(url.pathToFileURL(protocolConfigModulePath).href)
		const getDeploymentSteps = readFunction(deploymentModule, 'getDeploymentSteps')
		const getInfraContractAddresses = readFunction(deploymentHelpersModule, 'getInfraContractAddresses')
		const getMainnetProtocolConfig = readFunction(protocolConfigModule, 'getMainnetProtocolConfig')
		const infraContractAddresses = getInfraContractAddresses()
		return {
			protocolConfig: readProtocolConfig(getMainnetProtocolConfig()),
			deploymentSteps: readDeploymentSteps(getDeploymentSteps()),
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
		throw new Error(`Unable to compute mainnet deployment manifest. Run bun run generate before this check. ${message}`)
	}
}

function getProtocolConfigMeaning(name: keyof ManifestProtocolConfig, value: string) {
	if (name === 'forkThresholdDivisor') return `Fork threshold is \`1 / ${value}\` of theoretical REP supply.`
	if (name === 'forkBurnDivisor') return `Fork initiator haircut is \`1 / ${value}\` of the fork threshold.`
	if (name === 'initialEscalationGameDeposit') {
		if (value === '1000000000000000000') {
			return '`1 REP`; constructor-set starting escalation bond from the frozen deployment config.'
		}
		return `\`${value}\` atomic REP units; constructor-set starting escalation bond from the frozen deployment config.`
	}
	throw new Error(`Unknown protocol config key: ${name}`)
}

export function renderMarkdown(manifest: MainnetDeploymentManifest) {
	const configRows = [['forkThresholdDivisor', manifest.protocolConfig.forkThresholdDivisor] as const, ['forkBurnDivisor', manifest.protocolConfig.forkBurnDivisor] as const, ['initialEscalationGameDeposit', manifest.protocolConfig.initialEscalationGameDeposit] as const]
	const configTable = configRows.map(([name, value]) => `| ${name} | ${value} | ${getProtocolConfigMeaning(name, value)} |`).join('\n')
	const addressTable = manifest.deploymentSteps.map(step => `| ${step.id} | ${step.label} | \`${step.address}\` |`).join('\n')
	const derivedAddressTable = manifest.derivedContracts.map(contract => `| ${contract.id} | ${contract.label} | \`${contract.address}\` |`).join('\n')
	return `# Mainnet Deployment Addresses

Frozen mainnet protocol config, current contract artifacts, the proxy deployer, and CREATE2 salts determine the addresses and values below. \`docs/mainnet-deployment-addresses.json\` is the machine-readable source.

## Frozen Protocol Config

| Parameter | Value | Unit / Meaning |
| --- | --- | --- |
${configTable}

## Deterministic Deployment Steps

| ID | Label | Expected Address |
| --- | --- | --- |
${addressTable}

## Derived Side-Effect Contracts

These contracts are deployed by one of the deterministic deployment steps and are not separate user-triggered deployment steps.

| ID | Label | Expected Address |
| --- | --- | --- |
${derivedAddressTable}

Security pool deployments are deterministic per pool input rather than globally fixed. Their addresses are derived from the deployed factory set plus parent universe, universe ID, question ID, and security multiplier.
`
}

async function writeManifest(manifest: MainnetDeploymentManifest) {
	await fs.mkdir(path.dirname(manifestPath), { recursive: true })
	await fs.writeFile(manifestPath, normalizeManifest(manifest))
	await fs.writeFile(markdownPath, renderMarkdown(manifest))
}

async function readManifest(): Promise<MainnetDeploymentManifest> {
	const rawManifest = await fs.readFile(manifestPath, 'utf8')
	const parsedManifest: unknown = JSON.parse(rawManifest)
	if (!isRecord(parsedManifest)) throw new Error('Mainnet deployment manifest must be an object')
	const protocolConfig = Reflect.get(parsedManifest, 'protocolConfig')
	const deploymentSteps = Reflect.get(parsedManifest, 'deploymentSteps')
	const derivedContracts = Reflect.get(parsedManifest, 'derivedContracts')
	if (!isRecord(protocolConfig)) throw new Error('Mainnet deployment manifest protocolConfig must be an object')
	return {
		protocolConfig: {
			forkBurnDivisor: readStringField(protocolConfig, 'forkBurnDivisor', 'protocolConfig.forkBurnDivisor'),
			forkThresholdDivisor: readStringField(protocolConfig, 'forkThresholdDivisor', 'protocolConfig.forkThresholdDivisor'),
			initialEscalationGameDeposit: readStringField(protocolConfig, 'initialEscalationGameDeposit', 'protocolConfig.initialEscalationGameDeposit'),
		},
		deploymentSteps: readDeploymentSteps(deploymentSteps),
		derivedContracts: readDeploymentSteps(derivedContracts),
	}
}

export async function writeMainnetDeploymentManifest(): Promise<void> {
	await writeManifest(await loadComputedManifest())
}

export async function assertMainnetDeploymentManifestFresh(): Promise<void> {
	const expectedManifest = await readManifest()
	const computedManifest = await loadComputedManifest()
	const expected = normalizeManifest(expectedManifest)
	const computed = normalizeManifest(computedManifest)
	if (expected !== computed) {
		throw new Error(`Mainnet deployment manifest is stale. Run bun ./scripts/check-mainnet-deployment.mts --write after confirming the new mainnet values.`)
	}
	const expectedMarkdown = renderMarkdown(expectedManifest)
	const currentMarkdown = await fs.readFile(markdownPath, 'utf8')
	if (expectedMarkdown !== currentMarkdown) {
		throw new Error(`Mainnet deployment Markdown is stale. Run bun ./scripts/check-mainnet-deployment.mts --write after confirming the new mainnet values.`)
	}
}

async function main() {
	const write = process.argv.includes('--write')
	if (write) {
		await writeMainnetDeploymentManifest()
		return
	}

	await assertMainnetDeploymentManifestFresh()
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	main().catch(error => {
		console.error(error)
		process.exit(1)
	})
}
