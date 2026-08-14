import { encodeDeployData, getAddress, getCreate2Address, toHex, type Address, type Hash, type Hex, type PublicClient } from '@zoltar/shared/ethereum'
import { tradingContracts } from '../generated/contractArtifact.ts'
import type { DeploymentConfiguration } from './config.ts'

export type CoreDeployment = Readonly<{
	chainId: number
	chainName: string
	id: string
	proxyDeployer: Address
	securityPoolFactory: Address
}>

export type TradingDeploymentStepId = 'factory' | 'router'

export type TradingDeploymentStep = Readonly<{
	address: Address
	data: Hex
	dependencies: readonly TradingDeploymentStepId[]
	id: TradingDeploymentStepId
	label: string
}>

export type TradingDeploymentPlan = Readonly<{
	core: CoreDeployment
	factory: TradingDeploymentStep
	feeBps: number
	router: TradingDeploymentStep
}>

type TradingDeploymentWallet = Readonly<{
	sendTransaction(transaction: Readonly<{ data: Hex; to: Address }>): Promise<Hash>
	waitForTransactionReceipt(parameters: Readonly<{ hash: Hash }>): Promise<Readonly<{ status: 'success' | 'reverted' }>>
}>

const factoryContract = tradingContracts['trading/contracts/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const routerContract = tradingContracts['trading/contracts/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
const zeroSalt = toHex(0, { size: 32 })
const rpcStateRetryDelaysMilliseconds = [250, 500, 1_000, 2_000, 4_000] as const
export const CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex

function requireFeeBps(feeBps: number) {
	if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	return feeBps
}

export function getTradingDeploymentPlan(core: CoreDeployment, feeBps: number): TradingDeploymentPlan {
	const checkedFeeBps = requireFeeBps(feeBps)
	const factoryData = encodeDeployData({
		abi: factoryContract.abi,
		bytecode: `0x${factoryContract.evm.bytecode.object}`,
		args: [core.securityPoolFactory, BigInt(checkedFeeBps)],
	})
	const factoryAddress = getCreate2Address({ bytecode: factoryData, from: core.proxyDeployer, salt: zeroSalt })
	const routerData = encodeDeployData({
		abi: routerContract.abi,
		bytecode: `0x${routerContract.evm.bytecode.object}`,
		args: [factoryAddress],
	})
	const routerAddress = getCreate2Address({ bytecode: routerData, from: core.proxyDeployer, salt: zeroSalt })
	return {
		core,
		factory: { address: factoryAddress, data: factoryData, dependencies: [], id: 'factory', label: 'Two-way trading factory' },
		feeBps: checkedFeeBps,
		router: { address: routerAddress, data: routerData, dependencies: ['factory'], id: 'router', label: 'Two-way trading router' },
	}
}

export function deploymentConfigurationForPlan(plan: TradingDeploymentPlan, rpcUrl: string): DeploymentConfiguration {
	return {
		chainId: plan.core.chainId,
		chainName: plan.core.chainName,
		factory: plan.factory.address,
		feeBps: plan.feeBps,
		router: plan.router.address,
		rpcUrl,
		securityPoolFactory: plan.core.securityPoolFactory,
	}
}

async function requireCode(client: Pick<PublicClient, 'getCode'>, address: Address, label: string) {
	const code = await client.getCode({ address })
	if (code === undefined || code === '0x') throw new Error(`${label} has no code at ${address}`)
}

export async function validateTradingFactory(client: Pick<PublicClient, 'readContract'>, plan: TradingDeploymentPlan) {
	const [securityPoolFactory, feeBps] = await Promise.all([client.readContract({ abi: factoryContract.abi, address: plan.factory.address, functionName: 'securityPoolFactory' }), client.readContract({ abi: factoryContract.abi, address: plan.factory.address, functionName: 'feeBps' })])
	if (getAddress(securityPoolFactory) !== plan.core.securityPoolFactory) throw new Error('Trading factory references a different SecurityPoolFactory')
	if (feeBps !== BigInt(plan.feeBps)) throw new Error('Trading factory fee does not match the selected fee')
}

export async function validateTradingRouter(client: Pick<PublicClient, 'readContract'>, plan: TradingDeploymentPlan) {
	const factory = await client.readContract({ abi: routerContract.abi, address: plan.router.address, functionName: 'factory' })
	if (getAddress(factory) !== plan.factory.address) throw new Error('Trading router references a different factory')
}

export async function loadTradingDeploymentStatus(client: Pick<PublicClient, 'getCode' | 'readContract'>, plan: TradingDeploymentPlan) {
	const [proxyCode] = await Promise.all([client.getCode({ address: plan.core.proxyDeployer }), requireCode(client, plan.core.securityPoolFactory, 'SecurityPoolFactory')])
	if (proxyCode === undefined || proxyCode.toLowerCase() !== CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Canonical proxy deployer has unexpected code at ${plan.core.proxyDeployer}`)
	const factoryCode = await client.getCode({ address: plan.factory.address })
	const factoryDeployed = factoryCode !== undefined && factoryCode !== '0x'
	if (factoryDeployed) await validateTradingFactory(client, plan)
	const routerCode = await client.getCode({ address: plan.router.address })
	const routerDeployed = routerCode !== undefined && routerCode !== '0x'
	if (routerDeployed) {
		if (!factoryDeployed) throw new Error('Trading router exists without its expected factory')
		await validateTradingRouter(client, plan)
	}
	return { factory: factoryDeployed, router: routerDeployed }
}

export async function validateStoredTradingDeployment(client: Pick<PublicClient, 'getCode' | 'readContract'>, configuration: DeploymentConfiguration, coreDeployments: readonly CoreDeployment[]) {
	const core = coreDeployments.find(deployment => deployment.chainId === configuration.chainId)
	if (core === undefined) throw new Error(`Stored trading deployment uses unsupported chain ${configuration.chainId.toString()}`)
	if (core.securityPoolFactory !== configuration.securityPoolFactory) throw new Error('Stored trading deployment references a noncanonical SecurityPoolFactory')
	const plan = getTradingDeploymentPlan(core, configuration.feeBps)
	if (plan.factory.address !== configuration.factory || plan.router.address !== configuration.router) throw new Error('Stored trading deployment addresses do not match the current deterministic contracts')
	const status = await loadTradingDeploymentStatus(client, plan)
	if (!status.factory || !status.router) throw new Error('Stored trading deployment is incomplete')
}

export function nextTradingDeploymentStep(plan: TradingDeploymentPlan, status: Readonly<{ factory: boolean; router: boolean }>) {
	if (!status.factory) return plan.factory
	if (!status.router) return plan.router
	return undefined
}

async function waitForInstalledTradingStep(publicClient: Pick<PublicClient, 'getCode' | 'readContract'>, plan: TradingDeploymentPlan, step: TradingDeploymentStep, wait: (milliseconds: number) => Promise<void> = async milliseconds => await new Promise(resolve => setTimeout(resolve, milliseconds))) {
	let status = await loadTradingDeploymentStatus(publicClient, plan)
	for (const delayMilliseconds of rpcStateRetryDelaysMilliseconds) {
		if (status[step.id]) return status
		await wait(delayMilliseconds)
		status = await loadTradingDeploymentStatus(publicClient, plan)
	}
	return status
}

export async function deployTradingStep(
	walletClient: TradingDeploymentWallet,
	publicClient: Pick<PublicClient, 'getCode' | 'readContract'>,
	plan: TradingDeploymentPlan,
	step: TradingDeploymentStep,
	onSubmitted: (hash: Hash) => void = () => undefined,
	beforeSend: () => Promise<void> = async () => undefined,
	waitForRpcState?: (milliseconds: number) => Promise<void>,
): Promise<Hash> {
	const status = await loadTradingDeploymentStatus(publicClient, plan)
	if (status[step.id]) throw new Error(`${step.label} is already deployed`)
	for (const dependency of step.dependencies) {
		if (!status[dependency]) throw new Error(`Deploy ${plan[dependency].label} first`)
	}
	await beforeSend()
	const hash = await walletClient.sendTransaction({ to: plan.core.proxyDeployer, data: step.data })
	onSubmitted(hash)
	const receipt = await walletClient.waitForTransactionReceipt({ hash })
	if (receipt.status !== 'success') throw new Error(`${step.label} deployment reverted`)
	const refreshed = await waitForInstalledTradingStep(publicClient, plan, step, waitForRpcState)
	if (!refreshed[step.id]) throw new Error(`${step.label} deployment confirmed without installing the expected contract`)
	return hash
}
