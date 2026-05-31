import { sameAddress } from './address.js'
import { assertNever } from './assert.js'
import { formatDuration, formatRoundedCurrencyBalance } from './formatters.js'
import { getForkAuctionStageView, type ForkAuctionStageView } from './forkAuction.js'
import type { LoadableValueState } from './loadState.js'
import { getOracleManagerPriceValidUntilTimestamp } from './securityVault.js'
import { getTimeRemaining } from './time.js'
import type { UserMessagePresentation } from './userCopy.js'
import { resolveEnumValue } from './viewState.js'
import type { ListedSecurityPool, OracleManagerDetails, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '../types/contracts.js'

export type SelectedPoolForkStageView = 'fork-migration' | 'fork-auction' | 'fork-settlement'
export type SelectedPoolView = 'vaults' | 'trading' | 'reporting' | 'withdraw-escalation-deposits' | SelectedPoolForkStageView | 'staged-operations' | 'price-oracle'

export const SELECTED_POOL_PRIMARY_VIEWS: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting', 'withdraw-escalation-deposits']
export const SELECTED_POOL_FORK_STAGE_VIEWS: readonly SelectedPoolForkStageView[] = ['fork-migration', 'fork-auction', 'fork-settlement']
export const SELECTED_POOL_SECONDARY_VIEWS: readonly SelectedPoolView[] = ['staged-operations', 'price-oracle']
export const SELECTED_POOL_VIEWS: readonly SelectedPoolView[] = [...SELECTED_POOL_PRIMARY_VIEWS, ...SELECTED_POOL_FORK_STAGE_VIEWS, ...SELECTED_POOL_SECONDARY_VIEWS]

export function getSelectedPoolViewLabel(view: SelectedPoolView) {
	switch (view) {
		case 'vaults':
			return 'Vaults'
		case 'trading':
			return 'Trading'
		case 'reporting':
			return 'Reporting'
		case 'withdraw-escalation-deposits':
			return 'Withdraw Escalation Deposits'
		case 'fork-migration':
			return 'Migration'
		case 'fork-auction':
			return 'Auction'
		case 'fork-settlement':
			return 'Settlement'
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
		if (value === 'oracle') return 'staged-operations'

		return value
	})()
	return resolveEnumValue<SelectedPoolView>(normalizedValue, 'vaults', SELECTED_POOL_VIEWS)
}

export function isSelectedPoolForkStageView(view: SelectedPoolView): view is SelectedPoolForkStageView {
	switch (view) {
		case 'fork-migration':
		case 'fork-auction':
		case 'fork-settlement':
			return true
		default:
			return false
	}
}

export function getForkStageViewForSelectedPoolView(view: SelectedPoolForkStageView): ForkAuctionStageView {
	switch (view) {
		case 'fork-migration':
			return 'migration'
		case 'fork-auction':
			return 'auction'
		case 'fork-settlement':
			return 'settlement'
		default:
			return assertNever(view)
	}
}

export function getSelectedPoolViewForForkStage(stage: ForkAuctionStageView): SelectedPoolForkStageView {
	switch (stage) {
		case 'initiate':
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
	selectedPool: Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'> | undefined
}) {
	if (forkAuctionDetails !== undefined)
		return getSelectedPoolViewForForkStage(
			getForkAuctionStageView({
				claimingAvailable: forkAuctionDetails.claimingAvailable,
				forkOutcome: forkAuctionDetails.forkOutcome,
				migratedRep: forkAuctionDetails.migratedRep,
				systemState: forkAuctionDetails.systemState,
				truthAuction: forkAuctionDetails.truthAuction,
				truthAuctionStartedAt: forkAuctionDetails.truthAuctionStartedAt,
			}),
		)
	if (selectedPool === undefined) return 'fork-migration'
	return getSelectedPoolViewForForkStage(
		getForkAuctionStageView({
			forkOutcome: selectedPool.forkOutcome,
			migratedRep: selectedPool.migratedRep,
			systemState: selectedPool.systemState,
			truthAuctionStartedAt: selectedPool.truthAuctionStartedAt,
		}),
	)
}

export function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolExists: boolean; selectedPoolUniverseMismatch: boolean }) {
	return hasSelectedPoolAddress && selectedPoolExists && !selectedPoolUniverseMismatch
}
export function getSelectedPoolCardTitle() {
	return 'Operate Security Pool'
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
	if (selectedPoolUniverseMismatch) return 'Switch to the same universe before using this pool workflow.'
	if (selectedPoolLookupState === 'loading') return 'Wait for this pool to finish loading.'
	if (selectedPoolLookupState === 'missing') return 'Load a valid pool to open this workflow.'
	if (!hasSelectedPoolAddress || selectedPoolLookupState === 'unknown') return 'Load a pool to open this workflow.'
	return undefined
}
export function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }): UserMessagePresentation {
	if (selectedPoolUniverseMismatch)
		return {
			actionHint: 'Switch to the matching universe first.',
			badgeLabel: 'Unavailable',
			badgeTone: 'blocked',
			detail: 'Switch to the same universe before using vault, trading, reporting, and fork workflows.',
			key: 'unavailable',
		}
	if (selectedPoolLookupState === 'loading')
		return {
			detail: 'Loading...',
			detailIsLoading: true,
			key: 'loading',
		}
	if (selectedPoolLookupState === 'missing')
		return {
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'This security pool address was not found.',
			key: 'not_found',
		}
	if (hasSelectedPoolAddress)
		return {
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'Pool not found.',
			key: 'not_found',
		}
	return {
		badgeLabel: 'No pool selected',
		badgeTone: 'muted',
		detail: 'No pool selected.',
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
