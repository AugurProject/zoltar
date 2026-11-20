import type { Address } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '../monitoring/protocol-index.ts'

/** @internal Tests verify the retained-range rule directly. A missing prefix limits historical claims, not operations verified from the available range. */
export function availableHistoryExecutionReady(index: ChaosProtocolIndex | undefined, anchorBlockNumber: bigint, discoveryComplete: boolean, carryProofsComplete: boolean) {
	return discoveryComplete && index?.cursor.blockNumber === anchorBlockNumber.toString() && (index.availableStartBlock !== undefined || carryProofsComplete)
}

/**
 * History is complete once discovery and the index reach the anchor, plus the carry proofs a configured wallet needs.
 * Execution additionally needs that wallet, so a keyless scan can be caught up without being executable.
 */
export function canonicalScanReadiness(parameters: { anchorBlockNumber: bigint; carryProofsComplete: boolean; discoveryComplete: boolean; index: ChaosProtocolIndex | undefined; wallet: Address | undefined }) {
	const historyComplete = availableHistoryExecutionReady(parameters.index, parameters.anchorBlockNumber, parameters.discoveryComplete, parameters.wallet === undefined || parameters.carryProofsComplete)
	return { executionReady: parameters.wallet !== undefined && historyComplete, historyComplete }
}
