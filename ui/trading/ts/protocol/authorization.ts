import { encodeAbiParameters, type Address, type Hex } from '@zoltar/shared/evm/ethereum'
import { statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveMarket } from './liveMarket.js'

export const shareTokenAbi = statoblast_tokens_ShareToken_ShareToken.abi

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

export function shareOperationRouter(configuration: DeploymentConfiguration) {
	return configuration.router
}

function encodeReceiveBasedExitRequest(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint): Hex {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	const invalidTokenId = market.universeId << 8n
	return encodeAbiParameters([receiveRequestParameter], [[1, 0, market.shareToken, market.pool, market.pair, market.universeId, market.questionId, invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n, side === 'YES' ? 1 : 2, completeSetShares, maximumLongShares, minimumEthAttoEth, recipient, recipient, deadline]])
}

export function encodeReceiveBasedRedeemRequest(market: ReceiveMarket, completeSetShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint): Hex {
	if (market.pair === undefined) throw new Error('Pair is unavailable')
	const invalidTokenId = market.universeId << 8n
	return encodeAbiParameters([receiveRequestParameter], [[1, 1, market.shareToken, market.pool, market.pair, market.universeId, market.questionId, invalidTokenId, invalidTokenId | 1n, invalidTokenId | 2n, 0, completeSetShares, 0n, minimumEthAttoEth, recipient, recipient, deadline]])
}

export function receiveBasedExitArguments(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint) {
	const invalidTokenId = market.universeId << 8n
	return {
		ids: [invalidTokenId, invalidTokenId | (side === 'YES' ? 1n : 2n)],
		amounts: [completeSetShares, maximumLongShares],
		data: encodeReceiveBasedExitRequest(market, side, completeSetShares, maximumLongShares, minimumEthAttoEth, recipient, deadline),
	}
}
