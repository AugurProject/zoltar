import { readFile } from 'node:fs/promises'
import path from 'node:path'

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

const serializeManifest = (contracts: readonly (readonly [string, string, string])[]): string => {
	const entries = contracts.map((entry) => `\t\t[${entry.map((value) => JSON.stringify(value)).join(', ')}]`).join(',\n')
	return `{\n\t"contracts": [\n${entries}\n\t]\n}\n`
}
const manifestEntry = (address: string, label: string, kind: string): [string, string, string] => [address, label, kind]

async function projectManifest(projectRoot: string, networkId: keyof typeof usdcAddress): Promise<string> {
	const deploymentPath = path.join(projectRoot, 'docs', `${networkId}-deployment-addresses.json`)
	const deployment = deploymentFile(JSON.parse(await readFile(deploymentPath, 'utf8')), deploymentPath)
	if (deployment.network.id !== networkId) throw new Error(`${deploymentPath} describes ${deployment.network.id}, expected ${networkId}`)
	const configured = [...deployment.deploymentSteps, ...deployment.derivedContracts].flatMap(({ id, label, address }) => {
		const kind = deploymentKind[id]
		return kind === undefined ? [] : [manifestEntry(address, label, kind)]
	})
	configured.push(
		manifestEntry(deployment.network.genesisRepTokenAddress, 'Genesis REP', 'reputationToken'),
		manifestEntry(deployment.network.wethAddress, 'Wrapped Ether', 'weth'),
		manifestEntry(usdcAddress[networkId], 'USD Coin', 'usdc'),
	)
	const current = [...new Map(configured.map((entry) => [entry[0].toLowerCase(), entry])).values()]
	return serializeManifest(current)
}

export async function projectManifests(projectRoot: string): Promise<Readonly<Record<keyof typeof usdcAddress, string>>> {
	const [mainnet, sepolia] = await Promise.all([projectManifest(projectRoot, 'mainnet'), projectManifest(projectRoot, 'sepolia')])
	return { mainnet, sepolia }
}
