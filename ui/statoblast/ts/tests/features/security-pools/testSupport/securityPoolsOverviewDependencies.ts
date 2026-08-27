import { mock } from 'bun:test'
import { zeroAddress, zeroHash } from '@zoltar/shared/ethereum'
import { createSecurityPoolPageFromLoadedPools, type UseSecurityPoolsOverviewDependencies } from '../../../../features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js'

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
		queuedOperationCostAttoEth: 0n,
		requestPriceCostAttoEth: 0n,
		token1: undefined,
		token2: undefined,
	}
	return {
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
		})),
		createWalletWriteClient: mock(() => ({ kind: 'write-client' as const })),
		loadSecurityPoolLineage: mock(async () => []),
		loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
			currentRepBalanceAttoRep: 1n,
			currentWethBalanceAttoEth: 1n,
			initialReportAmount2: 1n,
			maximumInitialAttoWeth: 1n,
			minimumToken1ReportAttoEth: 1n,
			proposedRepPerEthPrice: 1n,
			reputationTokenAddress: zeroHash as never,
			requestedInitialAttoWeth: 0n,
			wethShortfallAttoEth: 0n,
		})),
		loadLiquidationApproval: mock(async () => ({
			registryAddress: zeroAddress,
			params: {
				securityPool: zeroAddress,
				receiverVault: zeroAddress,
				operator: zeroAddress,
				targetVault: zeroAddress,
				maxCumulativeDebtAttoEth: 0n,
				maxDebtPerLiquidationAttoEth: 0n,
				minPostLiquidationHealthFactorBps: 10_000n,
				validAfter: 0n,
				validUntil: 0n,
				nonce: 0n,
			},
			availableDebtAttoEth: 0n,
			reservedDebtAttoEth: 0n,
			consumedDebtAttoEth: 0n,
			minimumValidNonce: 0n,
			revoked: false,
		})),
		loadSecurityPoolVaultSummary: mock(async (_securityPoolAddress, vaultAddress) => ({
			openInterestAttoEth: 0n,
			disputeStakedAttoRep: 0n,
			vaultAttoRepBacking: 0n,
			capacityOwnershipAttoRep: 0n,
			claimableFeesAttoEth: 0n,
			vaultAddress,
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
