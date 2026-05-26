import { sameAddress } from './address.js'
import { assertNever } from './assert.js'
import { formatDuration, formatRoundedCurrencyBalance } from './formatters.js'
import type { LoadableValueState } from './loadState.js'
import { getOracleManagerPriceValidUntilTimestamp } from './securityVault.js'
import { getTimeRemaining } from './time.js'
import type { UserMessagePresentation } from './userCopy.js'
import { resolveEnumValue } from './viewState.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolSystemState } from '../types/contracts.js'

export type SelectedPoolView = 'vaults' | 'trading' | 'reporting' | 'withdraw-escalation-deposits' | 'fork' | 'staged-operations' | 'price-oracle'

export const SELECTED_POOL_VIEWS: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting', 'withdraw-escalation-deposits', 'fork', 'staged-operations', 'price-oracle']

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
		case 'fork':
			return 'Fork'
		case 'staged-operations':
			return 'Staged Operations'
		case 'price-oracle':
			return 'Open Oracle'
		default:
			return assertNever(view)
	}
}

export function resolveSelectedPoolView(value: string | undefined): SelectedPoolView {
	const normalizedValue = value === 'resolution' ? 'reporting' : value === 'oracle' ? 'staged-operations' : value
	return resolveEnumValue<SelectedPoolView>(normalizedValue, 'vaults', SELECTED_POOL_VIEWS)
}

export function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolExists: boolean; selectedPoolUniverseMismatch: boolean }) {
	return hasSelectedPoolAddress && selectedPoolExists && !selectedPoolUniverseMismatch
}

export function getSelectedPoolCardTitle() {
	return 'Operate Security Pool'
}

export function getSelectedPoolWorkflowGuardMessage({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }) {
	if (selectedPoolUniverseMismatch) return 'Switch to the same universe before using this pool workflow.'
	if (selectedPoolLookupState === 'loading') return 'Wait for this pool to finish loading.'
	if (selectedPoolLookupState === 'missing') return 'Load a valid pool to open this workflow.'
	if (!hasSelectedPoolAddress || selectedPoolLookupState === 'unknown') return 'Load a pool to open this workflow.'
	return undefined
}

export function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: { hasSelectedPoolAddress: boolean; selectedPoolLookupState: LoadableValueState; selectedPoolUniverseMismatch: boolean }): UserMessagePresentation {
	if (selectedPoolUniverseMismatch) {
		return {
			actionHint: 'Switch to the matching universe first.',
			badgeLabel: 'Unavailable',
			badgeTone: 'blocked',
			detail: 'Switch to the same universe before using vault, trading, reporting, and fork workflows.',
			key: 'unavailable',
		}
	}

	if (selectedPoolLookupState === 'loading') {
		return {
			detail: 'Loading...',
			detailIsLoading: true,
			key: 'loading',
		}
	}

	if (selectedPoolLookupState === 'missing') {
		return {
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'This security pool address was not found.',
			key: 'not_found',
		}
	}

	if (hasSelectedPoolAddress) {
		return {
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'Pool not found.',
			key: 'not_found',
		}
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
