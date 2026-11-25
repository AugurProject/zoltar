import { decodeEventLog, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'
import type { OpenOraclePriceSettlement } from '../types/contracts.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

const sharedFeedLinkAbi = [
	{ type: 'function', name: 'securityPoolFactory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'securityPool', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'universeId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint248' }] },
	{ type: 'function', name: 'priceValidityWindowSeconds', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const reportEscrowAbi = [
	{ type: 'function', name: 'feed', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'reportId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{
		type: 'function',
		name: 'reportCandidates',
		stateMutability: 'view',
		inputs: [{ name: 'reportId', type: 'uint256' }],
		outputs: [
			{ name: 'escrow', type: 'address' },
			{ name: 'sponsor', type: 'address' },
			{ name: 'maxSettlementBaseFee', type: 'uint256' },
		],
	},
] as const

// Generic OpenOracle reports have no pool freshness rule. Verify both sides of the callback/pool association.
export async function loadCoordinatorPriceValidUntilTimestamp(client: Pick<ReadClient, 'multicall'>, openOracleAddress: Address, game: OpenOracleStatePreimage['game'], _chainId?: number, reportId?: bigint) {
	if (game.callbackContract === zeroAddress || !hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE) || game.reportTimestamp === 0n) return undefined
	const abi = statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi
	if (reportId === undefined) return undefined
	const [feed, escrowReport] = await readOptionalMulticall(client, [
		{ address: game.callbackContract, abi: reportEscrowAbi, functionName: 'feed' },
		{ address: game.callbackContract, abi: reportEscrowAbi, functionName: 'reportId' },
	])
	if (feed.status !== 'success' || feed.result === zeroAddress || escrowReport.status !== 'success' || escrowReport.result !== reportId) return undefined
	const [candidate] = await readOptionalMulticall(client, [{ address: feed.result, abi: reportEscrowAbi, functionName: 'reportCandidates', args: [reportId] }])
	if (candidate.status !== 'success' || !sameAddress(candidate.result[0], game.callbackContract)) return undefined
	const [factory, securityPool, universe, weth, rep, oracle] = await readOptionalMulticall(client, [
		{ address: feed.result, abi: sharedFeedLinkAbi, functionName: 'securityPoolFactory' },
		{ address: feed.result, abi: sharedFeedLinkAbi, functionName: 'securityPool' },
		{ address: feed.result, abi: sharedFeedLinkAbi, functionName: 'universeId' },
		{ address: feed.result, abi, functionName: 'collateralToken' },
		{ address: feed.result, abi, functionName: 'reputationToken' },
		{ address: feed.result, abi, functionName: 'openOracle' },
	])
	if (
		oracle.status !== 'success' ||
		!sameAddress(oracle.result, openOracleAddress) ||
		factory.status !== 'success' ||
		!sameAddress(factory.result, getInfraContractAddresses().securityPoolFactory) ||
		securityPool.status !== 'success' ||
		securityPool.result === zeroAddress ||
		universe.status !== 'success' ||
		weth.status !== 'success' ||
		!sameAddress(weth.result, game.token1) ||
		rep.status !== 'success' ||
		!sameAddress(rep.result, game.token2)
	)
		return undefined
	const [registeredFeed, validity] = await readOptionalMulticall(client, [
		{ address: factory.result, abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, functionName: 'sharedPriceFeeds', args: [securityPool.result, universe.result] },
		{ address: feed.result, abi: sharedFeedLinkAbi, functionName: 'priceValidityWindowSeconds' },
	])
	if (registeredFeed.status !== 'success' || !sameAddress(registeredFeed.result, feed.result) || validity.status !== 'success') return undefined
	return game.reportTimestamp + game.settlementTime + validity.result
}

/**
 * Resolves the registered shared price feed that opened this escrow for this report on this OpenOracle.
 * The authenticated escrow returns no data, so settlement needs no return-data allowance for it.
 */
export async function getAuthenticatedReportEscrowFeed(client: Pick<ReadClient, 'multicall'>, openOracleAddress: Address, callbackContract: Address, reportId: bigint) {
	if (callbackContract === zeroAddress) return undefined
	const feed = (await readOptionalMulticall(client, [{ address: callbackContract, abi: reportEscrowAbi, functionName: 'feed' }])).at(0)
	if (feed?.status !== 'success' || feed.result === zeroAddress) return undefined
	const feedAbi = statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi
	const [candidate, factory, securityPool, universe, feedOracle] = await readOptionalMulticall(client, [
		{ address: feed.result, abi: feedAbi, functionName: 'reportCandidates', args: [reportId] },
		{ address: feed.result, abi: feedAbi, functionName: 'securityPoolFactory' },
		{ address: feed.result, abi: feedAbi, functionName: 'securityPool' },
		{ address: feed.result, abi: feedAbi, functionName: 'universeId' },
		{ address: feed.result, abi: feedAbi, functionName: 'openOracle' },
	])
	if (
		candidate?.status !== 'success' ||
		!sameAddress(candidate.result[0], callbackContract) ||
		factory?.status !== 'success' ||
		!sameAddress(factory.result, getInfraContractAddresses().securityPoolFactory) ||
		securityPool?.status !== 'success' ||
		securityPool.result === zeroAddress ||
		universe?.status !== 'success' ||
		feedOracle?.status !== 'success' ||
		!sameAddress(feedOracle.result, openOracleAddress)
	)
		return undefined
	const registeredFeed = (await readOptionalMulticall(client, [{ address: factory.result, abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, functionName: 'sharedPriceFeeds', args: [securityPool.result, universe.result] }])).at(0)
	return registeredFeed?.status === 'success' && sameAddress(registeredFeed.result, feed.result) ? feed.result : undefined
}

export async function isFeedAuthenticatedReportEscrow(client: Pick<ReadClient, 'multicall'>, openOracleAddress: Address, callbackContract: Address, reportId: bigint) {
	return (await getAuthenticatedReportEscrowFeed(client, openOracleAddress, callbackContract, reportId)) !== undefined
}

export function getOpenOraclePriceSettlement(receipt: Partial<Pick<TransactionReceipt, 'logs'>>, priceSource: Address, reportId: bigint): OpenOraclePriceSettlement | undefined {
	let canonicalPriceReported = false
	for (const log of receipt.logs ?? []) {
		if (!sameAddress(log.address, priceSource)) continue
		try {
			const decoded = decodeEventLog({ abi: statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, data: log.data, topics: log.topics })
			if (decoded.eventName === 'PriceReportRejected' && decoded.args.reportId === reportId) return { status: 'rejected', reason: decoded.args.reason }
			if (decoded.eventName === 'PriceReportDeferred' && decoded.args.reportId === reportId) return { status: 'deferred', maxSettlementBaseFee: decoded.args.maxSettlementBaseFee }
			if (decoded.eventName === 'PriceCandidateAccepted' && decoded.args.reportId === reportId) {
				const { candidatePrice, canonicalPrice, observationTimestamp, canonicalUpdated } = decoded.args
				return { status: 'accepted', candidate: { candidatePrice, canonicalPrice, observationTimestamp, canonicalUpdated } }
			}
			if (decoded.eventName === 'PriceReported' && decoded.args.reportId === reportId) canonicalPriceReported = true
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
		}
	}
	return canonicalPriceReported ? { status: 'accepted' } : undefined
}
