import { encodeAbiParameters, getAddress, type Address, type Hex, type PublicClient } from '@zoltar/shared/ethereum'
import { statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-core-shared/contractArtifact.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveMarket } from './liveMarket.js'

const tradingFactory = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory
const tradingFactoryV2 = tradingContracts['contracts/trading/TwoWayConstantProductFactoryV2.sol'].TwoWayConstantProductFactoryV2
const pair = tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair
const pairV2 = tradingContracts['contracts/trading/TwoWayConstantProductPairV2.sol'].TwoWayConstantProductPairV2
const receiveRouterV2 = tradingContracts['contracts/trading/TwoWayConstantProductRouterV2.sol'].TwoWayConstantProductRouterV2

export const shareTokenAbi = statoblast_tokens_ShareToken_ShareToken.abi

export function configuredFactory(configuration: DeploymentConfiguration) {
	return configuration.version === 2 ? tradingFactoryV2 : tradingFactory
}

export function configuredPair(configuration: DeploymentConfiguration) {
	return configuration.version === 2 ? pairV2 : pair
}

export function configuredShareOperationRouter(configuration: DeploymentConfiguration) {
	if (configuration.version !== 2) return configuration.router
	if (configuration.receiveRouter === undefined) throw new Error('V2 deployment is missing its approval-free router')
	return configuration.receiveRouter
}

export const directLiquidityRemovalV2Abi = [
	{
		type: 'function',
		name: 'removeLiquidity',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'liquidity', type: 'uint256' },
			{ name: 'minYes', type: 'uint256' },
			{ name: 'minNo', type: 'uint256' },
			{ name: 'recipient', type: 'address' },
			{ name: 'deadline', type: 'uint256' },
		],
		outputs: [
			{ name: 'yesOut', type: 'uint256' },
			{ name: 'noOut', type: 'uint256' },
		],
	},
] as const

const receiveRequestParameter = {
	type: 'tuple',
	components: [
		{ name: 'version', type: 'uint8' },
		{ name: 'operation', type: 'uint8' },
		{ name: 'shareToken', type: 'address' },
		{ name: 'securityPool', type: 'address' },
		{ name: 'pair', type: 'address' },
		{ name: 'universeId', type: 'uint248' },
		{ name: 'questionId', type: 'uint256' },
		{ name: 'invalidTokenId', type: 'uint256' },
		{ name: 'yesTokenId', type: 'uint256' },
		{ name: 'noTokenId', type: 'uint256' },
		{ name: 'longOutcome', type: 'uint8' },
		{ name: 'completeSetShares', type: 'uint256' },
		{ name: 'maxLongSharesIn', type: 'uint256' },
		{ name: 'minEthOut', type: 'uint256' },
		{ name: 'payoutRecipient', type: 'address' },
		{ name: 'refundRecipient', type: 'address' },
		{ name: 'deadline', type: 'uint256' },
	],
} as const

type ReceiveMarket = Pick<LiveMarket, 'pair' | 'shareToken' | 'pool' | 'universeId' | 'questionId'>

export function encodeReceiveBasedExitRequest(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEth: bigint, recipient: Address, deadline: bigint): Hex {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	const invalidTokenId = market.universeId << 8n
	return encodeAbiParameters([receiveRequestParameter], [[1, 0, market.shareToken, market.pool, market.pair, market.universeId, market.questionId, invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n, side === 'YES' ? 1 : 2, completeSetShares, maximumLongShares, minimumEth, recipient, recipient, deadline]])
}

export function encodeReceiveBasedRedeemRequest(market: ReceiveMarket, completeSetShares: bigint, minimumEth: bigint, recipient: Address, deadline: bigint): Hex {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	const invalidTokenId = market.universeId << 8n
	return encodeAbiParameters([receiveRequestParameter], [[1, 1, market.shareToken, market.pool, market.pair, market.universeId, market.questionId, invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n, 0, completeSetShares, 0n, minimumEth, recipient, recipient, deadline]])
}

export function receiveBasedExitArguments(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEth: bigint, recipient: Address, deadline: bigint) {
	const invalidTokenId = market.universeId << 8n
	return {
		ids: [invalidTokenId, invalidTokenId | (side === 'YES' ? 1n : 2n)],
		amounts: [completeSetShares, maximumLongShares],
		data: encodeReceiveBasedExitRequest(market, side, completeSetShares, maximumLongShares, minimumEth, recipient, deadline),
	}
}

export async function validateV2AuthorizationDeployment(client: PublicClient, configuration: DeploymentConfiguration) {
	if (configuration.version !== 2) return
	const receiveRouterAddress = configuredShareOperationRouter(configuration)
	const [factoryVersion, pairFactory, receiveFactory, receiveVersion] = await Promise.all([
		client.readContract({ abi: tradingFactoryV2.abi, address: configuration.factory, functionName: 'IMPLEMENTATION_VERSION' }),
		client.readContract({ abi: tradingFactoryV2.abi, address: configuration.factory, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: receiveRouterV2.abi, address: receiveRouterAddress, functionName: 'factory' }),
		client.readContract({ abi: receiveRouterV2.abi, address: receiveRouterAddress, functionName: 'IMPLEMENTATION_VERSION' }),
	])
	if (factoryVersion !== 2n || receiveVersion !== 2n || getAddress(pairFactory) !== configuration.securityPoolFactory || getAddress(receiveFactory) !== configuration.factory) throw new Error('Configured V2 trading capabilities do not match their authoritative contracts')
}
