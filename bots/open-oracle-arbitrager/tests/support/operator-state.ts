import type { OperatorState } from '#state/operator-state'
import { emptySettlementSnapshot } from '#state/settlement-store'

/** An idle, unpaused operator that has not observed a block yet; tests override only the fields they exercise. */
export function operatorStateFixture(overrides: Partial<OperatorState> = {}): OperatorState {
	return {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: false,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		settlements: emptySettlementSnapshot(),
		status: 'syncing',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
		...overrides,
	}
}
