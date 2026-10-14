import { decodeEventLog, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../contractArtifact.js'
import type { OpenOraclePriceSettlement } from '../types/contracts.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { getOracleManagerPriceValidUntilTimestamp } from './oracleTiming.js'

const sharedFeedLinkAbi = [
	{ type: 'function', name: 'securityPoolFactory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'portfolio', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', name: 'universeId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint248' }] },
] as const

// Generic OpenOracle reports have no pool freshness rule. Verify both sides of the callback/pool association.
export async function loadCoordinatorPriceValidUntilTimestamp(client: Pick<ReadClient, 'multicall'>, openOracleAddress: Address, game: OpenOracleStatePreimage['game'], chainId?: number) {
	if (game.callbackContract === zeroAddress || !hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE) || game.reportTimestamp === 0n) return undefined
	const abi = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
	const [oracle, pool] = await readOptionalMulticall(client, [
		{ address: game.callbackContract, abi, functionName: 'openOracle' },
		{ address: game.callbackContract, abi, functionName: 'securityPool' },
	])
	if (oracle.status !== 'success' || !sameAddress(oracle.result, openOracleAddress)) return undefined
	const securityPool = pool.status === 'success' ? pool.result : zeroAddress
	if (securityPool === zeroAddress) {
		const [factory, portfolio, universe, weth, rep] = await readOptionalMulticall(client, [
			{ address: game.callbackContract, abi: sharedFeedLinkAbi, functionName: 'securityPoolFactory' },
			{ address: game.callbackContract, abi: sharedFeedLinkAbi, functionName: 'portfolio' },
			{ address: game.callbackContract, abi: sharedFeedLinkAbi, functionName: 'universeId' },
			{ address: game.callbackContract, abi, functionName: 'weth' },
			{ address: game.callbackContract, abi, functionName: 'reputationToken' },
		])
		if (
			factory.status !== 'success' ||
			!sameAddress(factory.result, getInfraContractAddresses().securityPoolFactory) ||
			portfolio.status !== 'success' ||
			portfolio.result === zeroAddress ||
			universe.status !== 'success' ||
			weth.status !== 'success' ||
			!sameAddress(weth.result, game.token1) ||
			rep.status !== 'success' ||
			!sameAddress(rep.result, game.token2)
		)
			return undefined
		const [registeredFeed] = await readOptionalMulticall(client, [{ address: factory.result, abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, functionName: 'sharedPriceFeeds', args: [portfolio.result, universe.result] }])
		if (registeredFeed.status !== 'success' || !sameAddress(registeredFeed.result, game.callbackContract)) return undefined
		return getOracleManagerPriceValidUntilTimestamp(game.reportTimestamp + game.settlementTime, chainId)
	}
	const [coordinator] = await readOptionalMulticall(client, [{ address: securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'openOraclePriceCoordinator' }])
	if (coordinator.status !== 'success' || !sameAddress(coordinator.result, game.callbackContract)) return undefined
	return getOracleManagerPriceValidUntilTimestamp(game.reportTimestamp + game.settlementTime, chainId)
}

export function getOpenOraclePriceSettlement(receipt: Partial<Pick<TransactionReceipt, 'logs'>>, callbackContract: Address, reportId: bigint): OpenOraclePriceSettlement | undefined {
	if (callbackContract === zeroAddress) return undefined
	for (const log of receipt.logs ?? []) {
		if (!sameAddress(log.address, callbackContract)) continue
		try {
			const decoded = decodeEventLog({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics })
			if (decoded.eventName === 'PriceReportRejected' && decoded.args.reportId === reportId) return { status: 'rejected', reason: decoded.args.reason }
			if (decoded.eventName === 'PriceReported' && decoded.args.reportId === reportId) return { status: 'accepted' }
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
		}
	}
	return undefined
}
