import { hasSubmissionWindow, TRANSACTION_SUBMISSION_RESERVE_SECONDS } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import { hasOpenOracleFlag, OPEN_ORACLE_FLAG_TIME_TYPE } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { loadOpenOracleStoredState } from './openOracleState.js'

// Keep seconds and block clocks separate; neither reserve guarantees arbitrary inclusion delays.
const DISPUTE_SUBMISSION_BLOCKS = 2n

export function getOpenOracleDisputeSubmissionReserve(timeType: boolean) {
	return timeType ? TRANSACTION_SUBMISSION_RESERVE_SECONDS : DISPUTE_SUBMISSION_BLOCKS
}

export function getOpenOracleDisputeSubmissionTimingGuard(timing: { currentClock: bigint; reportTimestamp: bigint; settlementTime: bigint; timeType: boolean }) {
	return hasSubmissionWindow(timing.currentClock, timing.reportTimestamp + timing.settlementTime, getOpenOracleDisputeSubmissionReserve(timing.timeType)) ? undefined : 'Dispute window ends too soon. Wait to settle this report.'
}

export async function requireOpenOracleDisputeSubmissionWindow(client: Pick<ReadClient, 'readContract' | 'getBlock'>, address: Address, reportId: bigint) {
	const [state, block] = await Promise.all([loadOpenOracleStoredState(client, address, reportId), client.getBlock()])
	if (state.settled) throw new Error('This report is already settled.')
	const timeType = hasOpenOracleFlag(state.latest.game, OPEN_ORACLE_FLAG_TIME_TYPE)
	const currentClock = timeType ? block.timestamp : block.number
	if (currentClock === undefined) throw new Error('Could not read the current dispute clock. Retry before sending.')
	const guard = getOpenOracleDisputeSubmissionTimingGuard({ ...state.latest.game, currentClock, timeType })
	if (guard !== undefined) throw new Error(guard)
	return state
}
