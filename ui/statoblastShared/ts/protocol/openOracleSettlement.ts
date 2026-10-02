import { decodeEventLog, zeroAddress, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import type { OpenOraclePriceSettlement } from '../types/contracts.js'
import { getOracleManagerPriceValidUntilTimestamp } from './oracleTiming.js'

// Generic OpenOracle reports have no pool freshness rule. Verify both sides of the callback/pool association.
export async function loadCoordinatorPriceValidUntilTimestamp(client: Pick<ReadClient, 'multicall'>, openOracleAddress: Address, game: OpenOracleStatePreimage['game'], chainId?: number) {
	if (game.callbackContract === zeroAddress || !hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE) || game.reportTimestamp === 0n) return undefined
	const abi = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi
	const [oracle, pool] = await readOptionalMulticall(client, [
		{ address: game.callbackContract, abi, functionName: 'openOracle' },
		{ address: game.callbackContract, abi, functionName: 'securityPool' },
	])
	if (oracle.status !== 'success' || pool.status !== 'success' || !sameAddress(oracle.result, openOracleAddress) || pool.result === zeroAddress) return undefined
	const [coordinator] = await readOptionalMulticall(client, [{ address: pool.result, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'openOraclePriceCoordinator' }])
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
