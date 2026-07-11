import { mock } from 'bun:test'
import { zeroHash } from '@zoltar/shared/ethereum'
import { createSecurityPoolPageFromLoadedPools, type UseSecurityPoolsOverviewDependencies } from '../../hooks/useSecurityPoolsOverview.js'
import type { OracleManagerDetails } from '../../types/contracts.js'

export type TestSecurityPoolsOverviewWriteClient = { kind: 'write-client' }

export function createSecurityPoolsOverviewDependencies(overrides: Partial<UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>> = {}): UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient> {
	const defaultManagerDetails: OracleManagerDetails = {
		callbackStateHash: undefined,
		exactToken1Report: 1n,
		isPriceValid: true,
		lastPrice: 10n ** 18n,
		lastSettlementTimestamp: 0n,
		managerAddress: zeroHash as never,
		openOracleAddress: zeroHash as never,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: undefined,
		queuedOperationEthCost: 0n,
		requestPriceEthCost: 0n,
		token1: undefined,
		token2: undefined,
	}
	return {
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
		})),
		createWalletWriteClient: mock(() => ({ kind: 'write-client' as const })),
		loadAllSecurityPools: mock(async () => []),
		loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
			currentRepBalance: 1n,
			currentWethBalance: 1n,
			exactToken1Report: 1n,
			initialReportAmount2: 1n,
			reputationTokenAddress: zeroHash as never,
			wethShortfall: 0n,
		})),
		loadOracleManagerDetails: mock(async () => defaultManagerDetails),
		loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
		loadSecurityPoolPage: mock(async () => createSecurityPoolPageFromLoadedPools([], 0, 2)),
		queueSecurityPoolLiquidation: mock(async () => ({
			hash: zeroHash,
		})),
		waitForSecurityPoolReadBackend: async () => undefined,
		...overrides,
	}
}
