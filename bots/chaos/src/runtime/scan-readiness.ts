import type { ChaosProtocolIndex } from '../monitoring/protocol-index.ts'

/** A missing prefix limits historical claims, not operations verified from the available range. */
export function availableHistoryExecutionReady(index: ChaosProtocolIndex | undefined, anchorBlockNumber: bigint, discoveryComplete: boolean, carryProofsComplete: boolean) {
	return discoveryComplete && index?.cursor.blockNumber === anchorBlockNumber.toString() && (index.availableStartBlock !== undefined || carryProofsComplete)
}
