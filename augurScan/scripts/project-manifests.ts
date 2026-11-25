import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { encodeDeployData, getAddress, toHex } from '@zoltar/core-shared/evm/ethereum'
import { CANONICAL_TRADING_FEE_BPS, createDeploymentStatusOracleAddressHelper, tradingDeploymentData, zoltarDeploymentStatusStepAddresses } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { DeploymentStatusOracle_DeploymentStatusOracle as statusOracleContract, trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryContract, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerContract } from '../../solidity/ts/types/contractArtifact.ts'
import { systemContractMappings } from './project-system-contracts.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

type DeploymentFile = {
	readonly network: {
		readonly id: string
		readonly genesisRepTokenAddress: string
		readonly wethAddress: string
	}
	readonly deploymentSteps: readonly { readonly id: string; readonly label: string; readonly address: string }[]
	readonly derivedContracts: readonly { readonly id: string; readonly label: string; readonly address: string }[]
}

const requiredString = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || value === '') throw new Error(`${name} must be a nonempty string`)
	return value
}
const deploymentEntries = (value: unknown, name: string): DeploymentFile['deploymentSteps'] => {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
	return value.map((entry, index) => {
		if (!isPlainRecord(entry)) throw new Error(`${name}[${index}] must be an object`)
		return {
			id: requiredString(entry['id'], `${name}[${index}].id`),
			label: requiredString(entry['label'], `${name}[${index}].label`),
			address: requiredString(entry['address'], `${name}[${index}].address`),
		}
	})
}
type GenesisOutcome = 'yes' | 'no'
const deploymentFile = (value: unknown, source: string, outcome: GenesisOutcome): DeploymentFile => {
	if (!isPlainRecord(value) || !isPlainRecord(value['network'])) throw new Error(`${source} has no network object`)
	if (value['network']['genesisOutcome'] !== outcome) throw new Error(`${source}.network.genesisOutcome must be ${outcome}`)
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

const usdcAddress = {
	mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
} as const

const serializeManifest = (contracts: readonly (readonly [string, string, string])[]): string => {
	const entries = contracts.map(entry => `\t\t[${entry.map(value => JSON.stringify(value)).join(', ')}]`).join(',\n')
	return `{\n\t"contracts": [\n${entries}\n\t]\n}\n`
}
const manifestEntry = (address: string, label: string, kind: string): [string, string, string] => [address, label, kind]

const deploymentProfiles = [
	{ id: 'mainnet', network: 'mainnet', outcome: 'yes' },
	{ id: 'sepolia', network: 'sepolia', outcome: 'yes' },
	{ id: 'mainnet-no', network: 'mainnet', outcome: 'no' },
	{ id: 'sepolia-no', network: 'sepolia', outcome: 'no' },
] as const

async function projectManifest(projectRoot: string, { id, network: networkId, outcome }: (typeof deploymentProfiles)[number], deploymentKinds: Readonly<Record<string, string>>): Promise<string> {
	const deploymentPath = path.join(projectRoot, 'docs', `${id}-deployment-addresses.json`)
	const deployment = deploymentFile(JSON.parse(await readFile(deploymentPath, 'utf8')), deploymentPath, outcome)
	if (deployment.network.id !== networkId) throw new Error(`${deploymentPath} describes ${deployment.network.id}, expected ${networkId}`)
	const configured = [...deployment.deploymentSteps, ...deployment.derivedContracts].map(({ id, label, address }) => {
		const kind = deploymentKinds[id]
		if (kind === undefined) throw new Error(`${deploymentPath}: unmapped deployment ID ${id}`)
		return manifestEntry(address, label, kind)
	})
	const requiredDeploymentAddress = (id: string) => {
		const entry = deployment.deploymentSteps.find(entry => entry.id === id)
		if (entry === undefined) throw new Error(`${deploymentPath}: missing deployment ${id}`)
		return getAddress(entry.address)
	}
	const trading = tradingDeploymentData(
		requiredDeploymentAddress('proxyDeployer'),
		requiredDeploymentAddress('securityPoolFactory'),
		CANONICAL_TRADING_FEE_BPS,
		{ abi: factoryContract.abi, bytecode: `0x${factoryContract.evm.bytecode.object}` },
		{ abi: routerContract.abi, bytecode: `0x${routerContract.evm.bytecode.object}` },
	)
	configured.push(manifestEntry(trading.factoryAddress, 'Augur AMM Factory', 'ammFactory'), manifestEntry(trading.routerAddress, 'Augur AMM Router', 'ammRouter'))
	const zoltarStepAddresses = zoltarDeploymentStatusStepAddresses(networkId, getAddress(deployment.network.genesisRepTokenAddress), {
		proxyDeployer: requiredDeploymentAddress('proxyDeployer'),
		multicall3: requiredDeploymentAddress('multicall3'),
		zoltarQuestionData: requiredDeploymentAddress('zoltarQuestionData'),
		zoltar: requiredDeploymentAddress('zoltar'),
	})
	const zoltarStatusOracle = createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => encodeDeployData({ abi: statusOracleContract.abi, bytecode: `0x${statusOracleContract.evm.bytecode.object}`, args: [zoltarStepAddresses] }),
		proxyDeployerAddress: requiredDeploymentAddress('proxyDeployer'),
		zeroSalt: toHex(0, { size: 32 }),
	}).getDeploymentStatusOracleAddress()
	configured.push(manifestEntry(zoltarStatusOracle, 'Zoltar Deployment Status Oracle', 'deploymentStatusOracle'))
	configured.push(manifestEntry(deployment.network.genesisRepTokenAddress, 'Genesis REP', 'reputationToken'), manifestEntry(deployment.network.wethAddress, 'Wrapped Ether', 'weth'), manifestEntry(usdcAddress[networkId], 'USD Coin', 'usdc'))
	const current = [...new Map(configured.map(entry => [entry[0].toLowerCase(), entry])).values()]
	return serializeManifest(current)
}

export async function projectManifests(projectRoot: string, deploymentKinds?: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>>> {
	let kinds = deploymentKinds
	if (kinds === undefined) {
		const catalog: unknown = await Bun.file(new URL('../config/abis.json', import.meta.url)).json()
		if (!isPlainRecord(catalog) || !isPlainRecord(catalog['contracts'])) throw new Error('ABI catalog has no contracts')
		kinds = systemContractMappings(Object.keys(catalog['contracts']), await projectDeploymentIds(projectRoot)).deploymentKinds
	}
	const manifests: Record<string, string> = {}
	for (const profile of deploymentProfiles) manifests[profile.id] = await projectManifest(projectRoot, profile, kinds)
	return manifests
}

export async function projectDeploymentIds(projectRoot: string): Promise<readonly string[]> {
	const ids: string[] = []
	for (const { id, outcome } of deploymentProfiles) {
		const source = path.join(projectRoot, 'docs', `${id}-deployment-addresses.json`)
		const deployment = deploymentFile(JSON.parse(await readFile(source, 'utf8')), source, outcome)
		ids.push(...[...deployment.deploymentSteps, ...deployment.derivedContracts].map(({ id }) => id))
	}
	return [...new Set(ids)].sort()
}
