import { encodeDeployData, getAddress, getCreate2Address, toHex, type Address, type Hash, type Hex, type PublicClient } from '@zoltar/shared/ethereum'
import { waitForSubmittedTransactionReceipt, type SubmittedTransactionClient } from '@zoltar/ui-core-shared/lib/transactionReceipt.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { TradingDeploymentVersion } from '@zoltar/ui-trading-domain/capabilities.js'

export type CoreDeployment = Readonly<{
	chainId: number
	chainName: string
	defaultRpcUrl: string
	id: string
	proxyDeployer: Address
	securityPoolFactory: Address
	zoltar: Address
}>

type TradingDeploymentStepId = 'factory' | 'router' | 'receiveRouter'

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
	receiveRouter?: TradingDeploymentStep
	version: TradingDeploymentVersion
}>

type TradingDeploymentWallet = Readonly<{
	onTransactionSubmitted?: SubmittedTransactionClient['onTransactionSubmitted']
	sendTransaction(transaction: Readonly<{ data: Hex; to: Address }>): Promise<Hash>
	waitForTransactionReceipt: SubmittedTransactionClient<Readonly<{ status: 'success' | 'reverted' }>>['waitForTransactionReceipt']
}>

const factoryContract = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const routerContract = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
const factoryContractV2 = tradingContracts['contracts/trading/TwoWayConstantProductFactoryV2.sol'].TwoWayConstantProductFactoryV2
const routerContractV2 = tradingContracts['contracts/trading/TwoWayConstantProductRouterV2.sol'].TwoWayConstantProductRouterV2
const zeroSalt = toHex(0, { size: 32 })
const rpcStateRetryDelaysMilliseconds = [250, 500, 1_000, 2_000, 4_000] as const
export const CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex

function requireFeeBps(feeBps: number) {
	if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	return feeBps
}

export function getTradingDeploymentPlan(core: CoreDeployment, feeBps: number, version: TradingDeploymentVersion): TradingDeploymentPlan {
	const checkedFeeBps = requireFeeBps(feeBps)
	const selectedFactory = version === 2 ? factoryContractV2 : factoryContract
	const selectedRouter = routerContract
	const factoryData = encodeDeployData({
		abi: selectedFactory.abi,
		bytecode: `0x${selectedFactory.evm.bytecode.object}`,
		args: [core.securityPoolFactory, BigInt(checkedFeeBps)],
	})
	const factoryAddress = getCreate2Address({ bytecode: factoryData, from: core.proxyDeployer, salt: zeroSalt })
	const routerData = encodeDeployData({
		abi: selectedRouter.abi,
		bytecode: `0x${selectedRouter.evm.bytecode.object}`,
		args: [factoryAddress],
	})
	const routerAddress = getCreate2Address({ bytecode: routerData, from: core.proxyDeployer, salt: zeroSalt })
	const receiveRouterData = version === 2 ? encodeDeployData({ abi: routerContractV2.abi, bytecode: `0x${routerContractV2.evm.bytecode.object}`, args: [factoryAddress] }) : undefined
	const receiveRouterAddress = receiveRouterData === undefined ? undefined : getCreate2Address({ bytecode: receiveRouterData, from: core.proxyDeployer, salt: zeroSalt })
	return {
		core,
		factory: { address: factoryAddress, data: factoryData, dependencies: [], id: 'factory', label: 'Trading factory' },
		feeBps: checkedFeeBps,
		router: { address: routerAddress, data: routerData, dependencies: ['factory'], id: 'router', label: 'Trading router' },
		...(receiveRouterAddress === undefined || receiveRouterData === undefined ? {} : { receiveRouter: { address: receiveRouterAddress, data: receiveRouterData, dependencies: ['factory'], id: 'receiveRouter' as const, label: 'Approval-free trading router' } }),
		version,
	}
}

export function deploymentConfigurationForPlan(plan: TradingDeploymentPlan, rpcUrl: string): DeploymentConfiguration {
	return {
		chainId: plan.core.chainId,
		chainName: plan.core.chainName,
		factory: plan.factory.address,
		feeBps: plan.feeBps,
		router: plan.router.address,
		...(plan.receiveRouter === undefined ? {} : { receiveRouter: plan.receiveRouter.address }),
		version: plan.version,
		rpcUrl,
		securityPoolFactory: plan.core.securityPoolFactory,
		zoltar: plan.core.zoltar,
	}
}

async function requireCode(client: Pick<PublicClient, 'getCode'>, address: Address, label: string) {
	const code = await client.getCode({ address })
	if (code === undefined || code === '0x') throw new Error(`${label} has no code at ${address}`)
}

async function validateTradingFactory(client: Pick<PublicClient, 'readContract'>, plan: TradingDeploymentPlan) {
	const selectedFactory = plan.version === 2 ? factoryContractV2 : factoryContract
	const [securityPoolFactory, feeBps] = await Promise.all([client.readContract({ abi: selectedFactory.abi, address: plan.factory.address, functionName: 'securityPoolFactory' }), client.readContract({ abi: selectedFactory.abi, address: plan.factory.address, functionName: 'feeBps' })])
	if (getAddress(securityPoolFactory) !== plan.core.securityPoolFactory) throw new Error('Trading factory references a different SecurityPoolFactory')
	if (feeBps !== BigInt(plan.feeBps)) throw new Error('Trading factory fee does not match the selected fee')
	if (plan.version === 2) {
		const version = await client.readContract({ abi: factoryContractV2.abi, address: plan.factory.address, functionName: 'IMPLEMENTATION_VERSION' })
		if (version !== 2n) throw new Error('Trading factory implementation version is not V2')
	}
}

async function validateTradingRouter(client: Pick<PublicClient, 'readContract'>, plan: TradingDeploymentPlan) {
	const selectedRouter = routerContract
	const factory = await client.readContract({ abi: selectedRouter.abi, address: plan.router.address, functionName: 'factory' })
	if (getAddress(factory) !== plan.factory.address) throw new Error('Trading router references a different factory')
}

async function validateReceiveRouter(client: Pick<PublicClient, 'readContract'>, plan: TradingDeploymentPlan) {
	if (plan.receiveRouter === undefined) return
	const [receiveFactory, version] = await Promise.all([client.readContract({ abi: routerContractV2.abi, address: plan.receiveRouter.address, functionName: 'factory' }), client.readContract({ abi: routerContractV2.abi, address: plan.receiveRouter.address, functionName: 'IMPLEMENTATION_VERSION' })])
	if (getAddress(receiveFactory) !== plan.factory.address || version !== 2n) throw new Error('Approval-free router capability does not match the V2 deployment')
}

export async function loadTradingDeploymentStatus(client: Pick<PublicClient, 'getCode' | 'readContract'>, plan: TradingDeploymentPlan) {
	const [proxyCode] = await Promise.all([client.getCode({ address: plan.core.proxyDeployer }), requireCode(client, plan.core.securityPoolFactory, 'SecurityPoolFactory')])
	if (proxyCode === undefined || proxyCode.toLowerCase() !== CANONICAL_PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Canonical proxy deployer has unexpected code at ${plan.core.proxyDeployer}`)
	const factoryCode = await client.getCode({ address: plan.factory.address })
	const factoryDeployed = factoryCode !== undefined && factoryCode !== '0x'
	if (factoryDeployed) await validateTradingFactory(client, plan)
	const routerCode = await client.getCode({ address: plan.router.address })
	const routerDeployed = routerCode !== undefined && routerCode !== '0x'
	const receiveRouterCode = plan.receiveRouter === undefined ? undefined : await client.getCode({ address: plan.receiveRouter.address })
	const receiveRouterDeployed = plan.receiveRouter === undefined ? undefined : receiveRouterCode !== undefined && receiveRouterCode !== '0x'
	if (routerDeployed) {
		if (!factoryDeployed) throw new Error('Trading router exists without its expected factory')
		await validateTradingRouter(client, plan)
	}
	if (receiveRouterDeployed && plan.receiveRouter !== undefined) {
		if (!factoryDeployed) throw new Error('Approval-free router exists without its expected factory')
		await validateReceiveRouter(client, plan)
	}
	return { factory: factoryDeployed, router: routerDeployed, ...(receiveRouterDeployed === undefined ? {} : { receiveRouter: receiveRouterDeployed }) }
}

export function isTradingDeploymentComplete(plan: TradingDeploymentPlan, status: Readonly<{ factory: boolean; router: boolean; receiveRouter?: boolean }>) {
	return status.factory && status.router && (plan.receiveRouter === undefined || status.receiveRouter === true)
}

function hasInstalledTradingStep(status: Readonly<{ factory: boolean; router: boolean; receiveRouter?: boolean }>) {
	return status.factory || status.router || status.receiveRouter === true
}

export async function resolveInstalledTradingDeployment(client: Pick<PublicClient, 'getCode' | 'readContract'>, core: CoreDeployment, feeBps: number, rpcUrl: string): Promise<DeploymentConfiguration> {
	const versionTwoPlan = getTradingDeploymentPlan(core, feeBps, 2)
	const versionTwoStatus = await loadTradingDeploymentStatus(client, versionTwoPlan)
	if (isTradingDeploymentComplete(versionTwoPlan, versionTwoStatus)) return deploymentConfigurationForPlan(versionTwoPlan, rpcUrl)
	const legacyPlan = getTradingDeploymentPlan(core, feeBps, 1)
	const legacyStatus = await loadTradingDeploymentStatus(client, legacyPlan)
	if (isTradingDeploymentComplete(legacyPlan, legacyStatus)) return deploymentConfigurationForPlan(legacyPlan, rpcUrl)
	if (hasInstalledTradingStep(versionTwoStatus)) throw new Error('The V2 trading deployment is incomplete')
	if (hasInstalledTradingStep(legacyStatus)) throw new Error('The V1 trading deployment is incomplete')
	throw new Error('Trading contracts have not been deployed')
}

export function nextTradingDeploymentStep(plan: TradingDeploymentPlan, status: Readonly<{ factory: boolean; router: boolean; receiveRouter?: boolean }>) {
	if (!status.factory) return plan.factory
	if (!status.router) return plan.router
	if (plan.receiveRouter !== undefined && !status.receiveRouter) return plan.receiveRouter
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
		const dependencyStep = plan[dependency]
		if (dependencyStep === undefined) throw new Error(`Deployment plan is missing ${dependency}`)
		if (!status[dependency]) throw new Error(`Deploy ${dependencyStep.label} first`)
	}
	await beforeSend()
	const hash = await walletClient.sendTransaction({ to: plan.core.proxyDeployer, data: step.data })
	onSubmitted(hash)
	const { hash: resolvedHash, receipt } = await waitForSubmittedTransactionReceipt(walletClient, hash, { allowRevertedReceipt: true, onTransactionReplaced: onSubmitted })
	if (receipt.status !== 'success') throw new Error(`${step.label} deployment reverted`)
	const refreshed = await waitForInstalledTradingStep(publicClient, plan, step, waitForRpcState)
	if (!refreshed[step.id]) throw new Error(`${step.label} deployment confirmed without installing the expected contract`)
	return resolvedHash
}
