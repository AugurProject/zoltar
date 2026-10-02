import { mock } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { useSecurityPoolsOverview, type UseSecurityPoolsOverviewDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { OracleManagerDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-zoltar-shared/features/types.js'

export type TestSecurityPoolsOverviewWriteClient = { kind: 'write-client' }
type Dependencies = UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>
export type CoordinatorFundingRequirement = Awaited<ReturnType<Dependencies['loadCoordinatorInitialReportFundingRequirement']>>

export function createCoordinatorFundingRequirement(overrides: Partial<CoordinatorFundingRequirement> = {}): CoordinatorFundingRequirement {
	return {
		currentRepBalanceAttoRep: 1n,
		currentWethBalanceAttoEth: 1n,
		requiredRepAttoRep: 1n,
		initialReportAmount2: 1n,
		maximumInitialAttoWeth: 1n,
		minimumToken1ReportAttoEth: 1n,
		proposedRepPerEthPrice: 1n,
		reputationTokenAddress: zeroHash as never,
		requestedInitialAttoWeth: 0n,
		wethShortfallAttoEth: 0n,
		...overrides,
	}
}

type OverviewHarnessProps = { accountAddress?: Address; environmentRefreshKey?: number }

// Mounts useSecurityPoolsOverview with inert transaction callbacks and exposes its latest state.
export async function renderSecurityPoolsOverviewHook(dependencies: Dependencies, { accountAddress: defaultAccountAddress = zeroAddress, onTransactionPresented = () => undefined, ...initialProps }: OverviewHarnessProps & { onTransactionPresented?: (presentation: GlobalTransactionPresentation) => void } = {}) {
	let hookState: ReturnType<typeof useSecurityPoolsOverview> | undefined
	function SecurityPoolsOverviewHarness({ accountAddress = defaultAccountAddress, environmentRefreshKey = 0 }: OverviewHarnessProps) {
		hookState = useSecurityPoolsOverview(
			{
				accountAddress,
				environmentRefreshKey,
				onTransactionFinished: () => undefined,
				onTransactionPresented,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			},
			dependencies,
		)
		return h('div', {})
	}
	const rendered = await renderIntoDocument(h(SecurityPoolsOverviewHarness, initialProps))
	return {
		cleanup: rendered.cleanup,
		rerender: async (props: OverviewHarnessProps) => {
			await act(() => {
				render(h(SecurityPoolsOverviewHarness, props), rendered.container)
			})
		},
		state: () => requireHookState(hookState),
	}
}

export function createSecurityPoolsOverviewDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
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
		loadCoordinatorInitialReportFundingRequirement: mock(async () => createCoordinatorFundingRequirement()),
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
			underwritingLimitAttoEth: 0n,
			claimableFeesAttoEth: 0n,
			vaultAddress,
		})),
		loadOracleManagerDetails: mock(async () => defaultManagerDetails),
		loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
		queueSecurityPoolLiquidation: mock(async () => ({
			hash: zeroHash,
		})),
		waitForSecurityPoolReadBackend: async () => undefined,
		...overrides,
	}
}
