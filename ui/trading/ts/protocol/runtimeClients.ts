import { createWalletClient, custom, getAddress, type Address, type PublicClient } from '@zoltar/shared/ethereum'
import { ReputationToken_ReputationToken, statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-core-shared/contractArtifact.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { InjectedEthereum } from './injected.js'
import type { LiveMarket } from './liveMarket.js'
import { configuredFactory, validateV2AuthorizationDeployment } from './versionedAuthorization.js'

const securityPoolAbi = statoblast_SecurityPool_SecurityPool.abi
const erc20BalanceAbi = ReputationToken_ReputationToken.abi
const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter

export function validateRpcChainId(rpcChainId: number, deploymentChainId: number) {
	if (rpcChainId !== deploymentChainId) throw new Error(`RPC chain ${rpcChainId} does not match deployment chain ${deploymentChainId}`)
}

export function createTradingPublicClient(configuration: DeploymentConfiguration) {
	void configuration
	return getActiveBackend().createReadClient()
}

export function createTradingWalletClient(provider: InjectedEthereum, account: Address) {
	const backend = getActiveBackend()
	if (backend.id === 'simulation') return backend.createWriteClient(account)
	return createWalletClient({ account, transport: custom(provider) })
}

export async function loadWalletHeaderBalances(client: PublicClient, market: Pick<LiveMarket, 'pool'>, account: Address) {
	const [ethAttoEth, repToken] = await Promise.all([client.getBalance({ address: account }), client.readContract({ abi: securityPoolAbi, address: market.pool, functionName: 'repToken' })])
	const repAttoRep = await client.readContract({ abi: erc20BalanceAbi, address: getAddress(repToken), functionName: 'balanceOf', args: [account] })
	return { ethAttoEth, repAttoRep, repToken: getAddress(repToken) }
}

export async function validateLiveDeployment(client: PublicClient, configuration: DeploymentConfiguration) {
	const factoryArtifact = configuredFactory(configuration)
	const [rpcChainId, configuredCoreFactory, configuredFee, configuredRouterFactory] = await Promise.all([
		client.getChainId(),
		client.readContract({ abi: factoryArtifact.abi, address: configuration.factory, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: factoryArtifact.abi, address: configuration.factory, functionName: 'feeBps' }),
		client.readContract({ abi: router.abi, address: configuration.router, functionName: 'factory' }),
	])
	validateRpcChainId(rpcChainId, configuration.chainId)
	if (getAddress(configuredCoreFactory) !== configuration.securityPoolFactory) throw new Error('Trading factory references a different SecurityPoolFactory')
	if (configuredFee !== BigInt(configuration.feeBps)) throw new Error('Trading factory fee does not match the deterministic deployment')
	if (getAddress(configuredRouterFactory) !== configuration.factory) throw new Error('Router references a different trading factory')
	await validateV2AuthorizationDeployment(client, configuration)
}
