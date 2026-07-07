import { mock } from 'bun:test'
import { zeroHash } from '@zoltar/shared/ethereum'
import { createSecurityPoolPageFromLoadedPools, type UseSecurityPoolsOverviewDependencies } from '../../hooks/useSecurityPoolsOverview.js'

export type TestSecurityPoolsOverviewWriteClient = { kind: 'write-client' }

export function createSecurityPoolsOverviewDependencies(overrides: Partial<UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>> = {}): UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient> {
	return {
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
		})),
		createWalletWriteClient: mock(() => ({ kind: 'write-client' as const })),
		loadAllSecurityPools: mock(async () => []),
		loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
		loadSecurityPoolPage: mock(async () => createSecurityPoolPageFromLoadedPools([], 0, 2)),
		queueSecurityPoolLiquidation: mock(async () => ({
			hash: zeroHash,
		})),
		waitForSecurityPoolReadBackend: async () => undefined,
		...overrides,
	}
}
