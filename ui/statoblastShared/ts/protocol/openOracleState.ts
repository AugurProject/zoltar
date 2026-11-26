import { reportMissingStoredState, reportStateMismatch } from '../copy/protocolErrors.js'
import { hasOpenOracleFlag, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import * as openOracleCopy from '../copy/openOracle.js'

const abi = statoblast_openOracle_OpenOracle_OpenOracle.abi

export async function loadOpenOracleStoredState(client: Pick<ReadClient, 'readContract'>, address: Address, reportId: bigint) {
	const [stored, helper, stateHash] = await Promise.all([client.readContract({ abi, address, functionName: 'storedGame', args: [reportId] }), client.readContract({ abi, address, functionName: 'storedHelper', args: [reportId] }), client.readContract({ abi, address, functionName: 'oracleGame', args: [reportId] })])
	if (stateHash === zeroHash) throw new Error(openOracleCopy.formatReportMissing(reportId.toString()))
	const [currentAmount1, currentAmount2, currentReporter, reportTimestamp, settlementTimestamp, token1, lastReportOppoTime, settlementTime, escalationHalt, protocolFeeRecipient, settlerRewardAttoEth, token2, numReports, disputeDelay, feePercentage, multiplier, callbackContract, callbackGasLimit, protocolFee, flags] =
		stored
	const [creator, blockTimestamp, blockNumber] = helper
	const latest = {
		game: {
			currentAmount1,
			currentAmount2,
			currentReporter,
			reportTimestamp: BigInt(reportTimestamp),
			settlementTimestamp: BigInt(settlementTimestamp),
			token1,
			lastReportOppoTime: BigInt(lastReportOppoTime),
			settlementTime: BigInt(settlementTime),
			escalationHalt,
			protocolFeeRecipient,
			settlerRewardAttoEth,
			token2,
			numReports: BigInt(numReports),
			disputeDelay: BigInt(disputeDelay),
			feePercentage: BigInt(feePercentage),
			multiplier: BigInt(multiplier),
			callbackContract,
			callbackGasLimit: BigInt(callbackGasLimit),
			protocolFee: BigInt(protocolFee),
			flags: BigInt(flags),
		},
		helper: { creator, blockTimestamp: BigInt(blockTimestamp), blockNumber: BigInt(blockNumber), reportId },
	} satisfies OpenOracleStatePreimage
	if (!hasOpenOracleFlag(latest.game, OPEN_ORACLE_FLAG_STORE_ALL)) {
		const error = new Error(reportMissingStoredState(reportId))
		error.name = 'OpenOracleStateUnavailableError'
		throw error
	}
	if (hashOpenOracleStatePreimage(latest).toLowerCase() !== stateHash.toLowerCase()) throw new Error(reportStateMismatch(reportId))
	const initial = hasOpenOracleFlag(latest.game, OPEN_ORACLE_FLAG_TRACK_DISPUTES) ? await client.readContract({ abi, address, functionName: 'disputeHistory', args: [reportId, 0n] }) : undefined
	return { latest, stateHash, initialAmount1: initial?.[0] ?? (latest.game.numReports === 1n ? currentAmount1 : undefined), initialReporter: latest.game.numReports === 1n ? currentReporter : undefined, reportCount: latest.game.numReports, settled: latest.game.settlementTimestamp !== 0n }
}

export function isOpenOracleStateUnavailable(error: unknown): error is Error {
	return error instanceof Error && error.name === 'OpenOracleStateUnavailableError'
}
