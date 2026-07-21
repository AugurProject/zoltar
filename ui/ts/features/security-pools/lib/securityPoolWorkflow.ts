import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { sameAddress } from '../../../lib/address.js'
import { assertNever } from '../../../lib/assert.js'
import { formatDuration, formatRoundedCurrencyBalance } from '../../../lib/formatters.js'
import { deriveHasForkActivity, getForkAuctionStageView, type ForkAuctionStageView } from '../../truth-auctions/lib/forkAuction.js'
import type { LoadableValueState } from '../../../lib/loadState.js'
import { getOracleManagerPriceValidUntilTimestamp } from './securityVault.js'
import { getTimeRemaining } from '../../../lib/time.js'
import type { UserMessagePresentation } from '../../../lib/userCopy.js'
import { resolveEnumValue } from '../../../lib/viewState.js'
import type { ListedSecurityPool, OracleManagerDetails, ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '../../../types/contracts.js'

const FORK_WORKFLOW_SELECTION_STAGES = ['fork-triggered', 'migration', 'auction', 'settlement'] as const
export type ForkWorkflowSelectionStage = (typeof FORK_WORKFLOW_SELECTION_STAGES)[number]
export type SelectedPoolView = 'vaults' | 'trading' | 'reporting' | 'fork-workflow' | 'staged-operations' | 'price-oracle'

export const SELECTED_POOL_PRIMARY_VIEWS: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting', 'fork-workflow']
export const SELECTED_POOL_SECONDARY_VIEWS: readonly SelectedPoolView[] = ['staged-operations', 'price-oracle']
export const SELECTED_POOL_VIEWS: readonly SelectedPoolView[] = [...SELECTED_POOL_PRIMARY_VIEWS, ...SELECTED_POOL_SECONDARY_VIEWS]

export function getSelectedPoolViewLabel(view: SelectedPoolView) {
	switch (view) {
		case 'vaults':
			return 'Vaults'
		case 'trading':
			return 'Shares'
		case 'reporting':
			return 'Reporting'
		case 'fork-workflow':
			return 'Fork & Migration'
		case 'staged-operations':
			return 'Staged Operations'
		case 'price-oracle':
			return 'Open Oracle'
		default:
			return assertNever(view)
	}
}
export function resolveSelectedPoolView(value: string | undefined): SelectedPoolView {
	const normalizedValue = (() => {
		if (value === 'resolution') return 'reporting'
		if (value === 'withdraw-escalation-deposits') return 'reporting'
		if (value === 'oracle') return 'staged-operations'
		if (value === 'fork-migration' || value === 'fork-auction' || value === 'fork-settlement') return 'fork-workflow'

		return value
	})()
	return resolveEnumValue<SelectedPoolView>(normalizedValue, 'vaults', SELECTED_POOL_VIEWS)
}

export function isSelectedPoolForkWorkflowView(view: SelectedPoolView) {
	return view === 'fork-workflow'
}

export function getSelectedPoolViewForForkStage(stage: ForkAuctionStageView): SelectedPoolView {
	switch (stage) {
		case 'initiate':
		case 'migration':
			return 'fork-workflow'
		case 'auction':
			return 'fork-workflow'
		case 'settlement':
			return 'fork-workflow'
		default:
			return assertNever(stage)
	}
}

export function resolveForkWorkflowSelectionStage(value: string | undefined): ForkWorkflowSelectionStage | undefined {
	switch (value) {
		case 'fork-migration':
			return 'migration'
		case 'fork-auction':
			return 'auction'
		case 'fork-settlement':
			return 'settlement'
		default:
			return undefined
	}
}

export function getSelectedPoolViewForForkWorkflowSelectionStage(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return 'fork-workflow'
		case 'migration':
			return 'fork-migration'
		case 'auction':
			return 'fork-auction'
		case 'settlement':
			return 'fork-settlement'
		default:
			return assertNever(stage)
	}
}

export function normalizeForkWorkflowSelectionStage(stage: ForkAuctionStageView): ForkWorkflowSelectionStage {
	return stage === 'initiate' ? 'fork-triggered' : stage
}

export function getCurrentForkWorkflowSelectionStage({
	claimingAvailable = false,
	currentForkStage,
	hasForkActivity,
	systemState,
	truthAuctionFinalized = false,
}: {
	claimingAvailable?: boolean
	currentForkStage: ForkAuctionStageView
	hasForkActivity: boolean
	systemState: SecurityPoolSystemState | undefined
	truthAuctionFinalized?: boolean
}): ForkWorkflowSelectionStage {
	if (systemState === 'poolForked') return 'migration'
	if (systemState === 'operational' && hasForkActivity && truthAuctionFinalized && !claimingAvailable) return 'settlement'
	return normalizeForkWorkflowSelectionStage(currentForkStage)
}

export function getForkWorkflowStageSelection({
	currentStageView,
	forkAuctionDetails,
	forkOutcome,
	previewPool,
	selectedStageView,
	stageView,
	systemState,
}: {
	currentStageView: ForkAuctionStageView | undefined
	forkAuctionDetails:
		| {
				claimingAvailable: boolean
				hasForkActivity: boolean
				migratedRep: bigint
				truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined
				truthAuctionStartedAt: bigint
		  }
		| undefined
	forkOutcome: ListedSecurityPool['forkOutcome'] | undefined
	previewPool: Pick<ListedSecurityPool, 'hasForkActivity' | 'migratedRep' | 'truthAuctionStartedAt'> | undefined
	selectedStageView: ForkWorkflowSelectionStage | undefined
	stageView: ForkAuctionStageView | undefined
	systemState: SecurityPoolSystemState | undefined
}) {
	const currentStage =
		currentStageView ??
		(systemState === undefined
			? 'initiate'
			: getForkAuctionStageView({
					claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
					forkOutcome: forkOutcome ?? 'none',
					migratedRep: forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep ?? 0n,
					systemState,
					truthAuction: forkAuctionDetails?.truthAuction,
					truthAuctionStartedAt: forkAuctionDetails?.truthAuctionStartedAt ?? previewPool?.truthAuctionStartedAt ?? 0n,
				}))
	const currentWorkflowStage = getCurrentForkWorkflowSelectionStage({
		claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
		currentForkStage: currentStage,
		hasForkActivity: forkAuctionDetails?.hasForkActivity ?? previewPool?.hasForkActivity ?? false,
		systemState,
		truthAuctionFinalized: forkAuctionDetails?.truthAuction?.finalized ?? false,
	})
	const selectedStage = (() => {
		if (selectedStageView !== undefined) return selectedStageView
		if (stageView === undefined) return currentWorkflowStage
		return normalizeForkWorkflowSelectionStage(stageView)
	})()

	return {
		currentStage,
		currentWorkflowStage,
		selectedStage,
	}
}

export function getSelectedPoolForkWorkflowView({
	forkAuctionDetails,
	selectedPool,
}: {
	forkAuctionDetails:
		| {
				claimingAvailable: boolean
				forkOutcome: ListedSecurityPool['forkOutcome']
				migratedRep: bigint
				systemState: SecurityPoolSystemState
				truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined
				truthAuctionStartedAt: bigint
		  }
		| undefined
	selectedPool: (Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'> & { hasForkActivity?: boolean }) | undefined
}) {
	const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails,
		selectedPool,
	})
	if (currentForkAuctionDetails !== undefined)
		return getSelectedPoolViewForForkStage(
			getForkAuctionStageView({
				claimingAvailable: currentForkAuctionDetails.claimingAvailable,
				forkOutcome: currentForkAuctionDetails.forkOutcome,
				migratedRep: currentForkAuctionDetails.migratedRep,
				systemState: currentForkAuctionDetails.systemState,
				truthAuction: currentForkAuctionDetails.truthAuction,
				truthAuctionStartedAt: currentForkAuctionDetails.truthAuctionStartedAt,
			}),
		)
	if (selectedPool === undefined) return 'fork-workflow'
	return getSelectedPoolViewForForkStage(
		getCurrentSelectedPoolForkStage({
			forkAuctionDetails,
			selectedPool,
		}),
	)
}

export function getCurrentSelectedPoolForkStage({
	forkAuctionDetails,
	selectedPool,
}: {
	forkAuctionDetails:
		| {
				claimingAvailable: boolean
				forkOutcome: ListedSecurityPool['forkOutcome']
				migratedRep: bigint
				systemState: SecurityPoolSystemState
				truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined
				truthAuctionStartedAt: bigint
		  }
		| undefined
	selectedPool: (Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'> & { hasForkActivity?: boolean }) | undefined
}): ForkAuctionStageView {
	const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails,
		selectedPool,
	})
	if (currentForkAuctionDetails !== undefined)
		return getForkAuctionStageView({
			claimingAvailable: currentForkAuctionDetails.claimingAvailable,
			forkOutcome: currentForkAuctionDetails.forkOutcome,
			migratedRep: currentForkAuctionDetails.migratedRep,
			systemState: currentForkAuctionDetails.systemState,
			truthAuction: currentForkAuctionDetails.truthAuction,
			truthAuctionStartedAt: currentForkAuctionDetails.truthAuctionStartedAt,
		})
	if (selectedPool === undefined) return 'migration'
	return getForkAuctionStageView({
		forkOutcome: selectedPool.forkOutcome,
		migratedRep: selectedPool.migratedRep,
		systemState: selectedPool.systemState,
		truthAuctionStartedAt: selectedPool.truthAuctionStartedAt,
	})
}

export function hasCurrentSelectedPoolForkActivity({
	forkAuctionDetails,
	selectedPool,
}: {
	forkAuctionDetails:
		| {
				forkOutcome: ListedSecurityPool['forkOutcome']
				migratedRep: bigint
				systemState: SecurityPoolSystemState
				truthAuctionStartedAt: bigint
		  }
		| undefined
	selectedPool: Pick<ListedSecurityPool, 'forkOutcome' | 'hasForkActivity' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'> | undefined
}) {
	const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails,
		selectedPool,
	})
	if (currentForkAuctionDetails !== undefined) return deriveHasForkActivity(currentForkAuctionDetails)
	return selectedPool?.hasForkActivity ?? false
}

export function getCurrentSelectedPoolForkAuctionDetails<T extends { systemState: SecurityPoolSystemState }>({ forkAuctionDetails, selectedPool }: { forkAuctionDetails: T | undefined; selectedPool: { hasForkActivity?: boolean; systemState: SecurityPoolSystemState } | undefined }) {
	if (forkAuctionDetails === undefined) return undefined
	if (forkAuctionDetails.systemState === 'operational' && selectedPool !== undefined && selectedPool.systemState !== 'operational') return undefined
	if (forkAuctionDetails.systemState === 'operational') return forkAuctionDetails
	if (selectedPool?.systemState === 'operational' && selectedPool.hasForkActivity === true) return undefined
	return forkAuctionDetails
}

export function shouldReloadSelectedPoolDetails({
	currentDetailsAvailable,
	lastHandledRefreshNonce,
	loadedDetailsAddress,
	refreshNonce,
	selectedPoolAddress,
}: {
	currentDetailsAvailable: boolean
	lastHandledRefreshNonce: number
	loadedDetailsAddress: string | undefined
	refreshNonce: number
	selectedPoolAddress: string | undefined
}) {
	if (selectedPoolAddress === undefined) return false
	if (refreshNonce !== lastHandledRefreshNonce) return true
	if (!sameAddress(loadedDetailsAddress, selectedPoolAddress)) return true
	return !currentDetailsAvailable
}

export function getCurrentSelectedPoolReportingDetails({ reportingDetails, selectedPool }: { reportingDetails: ReportingDetails | undefined; selectedPool: Pick<ListedSecurityPool, 'hasForkActivity' | 'questionOutcome' | 'systemState'> | undefined }) {
	if (reportingDetails === undefined) return undefined
	if (reportingDetails.systemState === 'operational') {
		if (selectedPool !== undefined && selectedPool.systemState !== 'operational') return undefined
		if (selectedPool?.systemState === 'operational' && selectedPool.questionOutcome !== undefined && selectedPool.questionOutcome !== 'none' && reportingDetails.questionOutcome !== selectedPool.questionOutcome) {
			return undefined
		}
		return reportingDetails
	}
	if (selectedPool?.systemState === 'operational' && selectedPool.hasForkActivity === true) return undefined
	return reportingDetails
}

export function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolExists: boolean; selectedPoolUniverseMismatch: boolean }) {
	return hasSelectedPoolAddress && selectedPoolExists && !selectedPoolUniverseMismatch
}
export function getSelectedPoolCardTitle() {
	return 'Manage Pool'
}
export function applySelectedPoolWorkflowState(
	pool: ListedSecurityPool | undefined,
	{
		questionOutcome,
		systemState,
	}: {
		questionOutcome: ReportingOutcomeKey | 'none' | undefined
		systemState: SecurityPoolSystemState | undefined
	},
) {
	if (pool === undefined) return undefined
	if (questionOutcome === undefined && systemState === undefined) return pool
	return {
		...pool,
		...(questionOutcome === undefined ? {} : { questionOutcome }),
		...(systemState === undefined ? {} : { systemState }),
	}
}
export function getSelectedPoolWorkflowGuardMessage({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }) {
	if (selectedPoolUniverseMismatch) return undefined
	if (selectedPoolLookupState === 'loading') return securityPoolCopy.waitForPoolLoadingReason
	if (selectedPoolLookupState === 'missing') return securityPoolCopy.loadValidPoolReason
	if (!hasSelectedPoolAddress || selectedPoolLookupState === 'unknown') return securityPoolCopy.loadPoolReason
	return undefined
}
export function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }): UserMessagePresentation {
	if (selectedPoolUniverseMismatch)
		return {
			badgeLabel: commonCopy.unavailable,
			badgeTone: 'blocked',
			detail: securityPoolCopy.selectedPoolUnavailableDetail,
			key: 'unavailable',
		}
	if (selectedPoolLookupState === 'loading')
		return {
			detail: commonCopy.loadingWithEllipsis,
			detailIsLoading: true,
			key: 'loading',
		}
	if (selectedPoolLookupState === 'missing')
		return {
			badgeLabel: commonCopy.notFound,
			badgeTone: 'blocked',
			detail: securityPoolCopy.securityPoolAddressNotFoundDetail,
			key: 'not_found',
		}
	if (hasSelectedPoolAddress)
		return {
			badgeLabel: commonCopy.notFound,
			badgeTone: 'blocked',
			detail: securityPoolCopy.poolNotFoundDetail,
			key: 'not_found',
		}
	return {
		badgeLabel: securityPoolCopy.noPoolSelectedBadgeLabel,
		badgeTone: 'muted',
		detail: securityPoolCopy.noPoolSelectedDetail,
		key: 'action_needed',
	}
}
export function isForkWorkflowDisabled(selectedPoolState: SecurityPoolSystemState | undefined, selectedPoolHasForkActivity = false) {
	return selectedPoolState === undefined || (selectedPoolState === 'operational' && !selectedPoolHasForkActivity)
}
export function getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }: { lastPrice: bigint; lastSettlementTimestamp: bigint }) {
	if (lastSettlementTimestamp === 0n) return '-'
	return `≈ ${formatRoundedCurrencyBalance(lastPrice, 18, 2)} REP / ETH`
}
export function getOraclePriceValidityPresentation({ currentTimestamp, lastSettlementTimestamp, priceValidUntilTimestamp }: { currentTimestamp: bigint; lastSettlementTimestamp: bigint; priceValidUntilTimestamp: bigint | undefined }) {
	if (lastSettlementTimestamp === 0n) return undefined
	const validUntilTimestamp = priceValidUntilTimestamp ?? getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp)
	if (validUntilTimestamp === undefined) return undefined
	const timeRemaining = getTimeRemaining(validUntilTimestamp, currentTimestamp)
	if (timeRemaining === undefined) return undefined
	if (timeRemaining === 0n) {
		const expiredFor = currentTimestamp > validUntilTimestamp ? currentTimestamp - validUntilTimestamp : 0n
		return { text: `(expired ${expiredFor === 0n ? 'less than a minute' : formatDuration(expiredFor)} ago)`, tone: 'danger' as const }
	}
	return { text: `(Valid for ${formatDuration(timeRemaining)})`, tone: 'success' as const }
}
export function getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress }: { poolOracleManagerDetails: OracleManagerDetails | undefined; selectedPoolManagerAddress: string | undefined }) {
	if (!sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return undefined
	return poolOracleManagerDetails
}
export function getSelectedPoolOracleMetricValues({ lastOraclePrice, lastOracleSettlementTimestamp }: Pick<ListedSecurityPool, 'lastOraclePrice' | 'lastOracleSettlementTimestamp'>) {
	return {
		lastPrice: lastOraclePrice ?? 0n,
		lastSettlementTimestamp: lastOracleSettlementTimestamp,
	}
}
