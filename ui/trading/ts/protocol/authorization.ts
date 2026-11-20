import { zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { encodeReceiveRequest, RECEIVE_REQUEST_VERSION } from '@zoltar/trading-shared/trading/receiveRequest'
import { statoblast_tokens_ShareToken_ShareToken } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { DeploymentConfiguration } from './config.js'
import type { LiveMarket } from './liveMarket.js'

export const shareTokenAbi = statoblast_tokens_ShareToken_ShareToken.abi

type ReceiveMarket = Pick<LiveMarket, 'pair' | 'shareToken' | 'pool' | 'universeId' | 'questionId'>

export function shareOperationRouter(configuration: DeploymentConfiguration) {
	return configuration.router
}

function encodeReceiveBasedExitRequest(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint, minimumRepAttoRep: bigint): Hex {
	if (market.pair === undefined) throw new Error('The trading pool is unavailable')
	const invalidTokenId = market.universeId << 8n
	return encodeReceiveRequest([
		RECEIVE_REQUEST_VERSION,
		0,
		market.shareToken,
		market.pool,
		market.pair,
		market.universeId,
		market.questionId,
		invalidTokenId,
		invalidTokenId | 1n,
		invalidTokenId | 2n,
		side === 'YES' ? 1 : 2,
		completeSetShares,
		maximumLongShares,
		minimumEthAttoEth,
		recipient,
		recipient,
		deadline,
		minimumRepAttoRep,
	])
}

export function encodeReceiveBasedRedeemRequest(market: ReceiveMarket, completeSetShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint, minimumRepAttoRep = 0n): Hex {
	const invalidTokenId = market.universeId << 8n
	const noLongOutcome = 3 // BinaryOutcomes.BinaryOutcome.None: redemption has no directional leg.
	return encodeReceiveRequest([
		RECEIVE_REQUEST_VERSION,
		1,
		market.shareToken,
		market.pool,
		market.pair ?? zeroAddress,
		market.universeId,
		market.questionId,
		invalidTokenId,
		invalidTokenId | 1n,
		invalidTokenId | 2n,
		noLongOutcome,
		completeSetShares,
		0n,
		minimumEthAttoEth,
		recipient,
		recipient,
		deadline,
		minimumRepAttoRep,
	])
}

/** The signed REP floor covers the recovery REP a fork-child pool pays per burned complete set. */
export function receiveBasedExitArguments(market: ReceiveMarket, side: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumEthAttoEth: bigint, recipient: Address, deadline: bigint, minimumRepAttoRep: bigint) {
	const invalidTokenId = market.universeId << 8n
	return {
		ids: [invalidTokenId, invalidTokenId | (side === 'YES' ? 1n : 2n)],
		amounts: [completeSetShares, maximumLongShares],
		data: encodeReceiveBasedExitRequest(market, side, completeSetShares, maximumLongShares, minimumEthAttoEth, recipient, deadline, minimumRepAttoRep),
	}
}
