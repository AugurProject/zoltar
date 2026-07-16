import * as commonCopy from '../copy/common.js'
import * as userMessagesCopy from '../copy/userMessages.js'
import type { Address } from '@zoltar/shared/ethereum'
import { assertNever } from './assert.js'
import { getWrongNetworkMessage } from './network.js'
import type { LoadableValueState } from './loadState.js'

export type UserMessageKey = 'not_checked' | 'loading' | 'not_found' | 'empty' | 'action_needed' | 'wrong_network' | 'wallet_disconnected' | 'unavailable' | 'load_failed'

type UserMessageTone = 'muted' | 'pending' | 'blocked' | 'error' | 'ok'

export type UserMessagePresentation = {
	actionHint?: string
	badgeLabel?: string
	badgeTone?: UserMessageTone
	detail?: string
	detailIsLoading?: boolean
	key: UserMessageKey
	placeholder?: string
}

const METRIC_PLACEHOLDER = commonCopy.metricUnavailablePlaceholder

function createPresentation(key: UserMessageKey, presentation: Omit<UserMessagePresentation, 'key'>): UserMessagePresentation {
	return { key, ...presentation }
}

export function getMetricPlaceholderPresentation(value: unknown, options?: { loading?: boolean }) {
	if (value !== undefined) return undefined
	if (options?.loading === true)
		return createPresentation('loading', {
			badgeLabel: commonCopy.loading,
			badgeTone: 'pending',
			placeholder: commonCopy.loadingWithEllipsis,
		})
	return createPresentation('unavailable', {
		placeholder: METRIC_PLACEHOLDER,
	})
}

export function getPoolRegistryPresentation(
	input:
		| {
				hasLoaded: boolean
				isLoading: boolean
				mode: 'collection'
				poolCount: number
		  }
		| {
				mode: 'selection'
				state: LoadableValueState
		  },
) {
	if (input.mode === 'collection') {
		if (input.poolCount > 0) return undefined
		if (input.isLoading)
			return createPresentation('loading', {
				badgeLabel: commonCopy.loading,
				badgeTone: 'pending',
				detail: userMessagesCopy.refreshingPoolRegistryDetail,
			})
		if (!input.hasLoaded)
			return createPresentation('not_checked', {
				badgeLabel: userMessagesCopy.notChecked,
				badgeTone: 'muted',
				detail: userMessagesCopy.uncheckedPoolRegistryDetail,
			})
		return createPresentation('empty', {
			actionHint: userMessagesCopy.emptyPoolRegistryActionHint,
			badgeLabel: commonCopy.none,
			badgeTone: 'muted',
			detail: userMessagesCopy.emptyPoolRegistryDetail,
		})
	}

	switch (input.state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: commonCopy.loading,
				badgeTone: 'pending',
				detail: commonCopy.loadingWithEllipsis,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: userMessagesCopy.notChecked,
				badgeTone: 'muted',
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: commonCopy.notFound,
				badgeTone: 'blocked',
			})
		case 'ready':
			return undefined
		default:
			return assertNever(input.state)
	}
}

export function getUniversePresentation(state: LoadableValueState) {
	switch (state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: commonCopy.loading,
				badgeTone: 'pending',
				detail: commonCopy.loadingUniverseDetails,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: userMessagesCopy.notChecked,
				badgeTone: 'muted',
				detail: userMessagesCopy.uncheckedUniverseDetail,
			})
		case 'missing':
			return createPresentation('not_found', {
				actionHint: commonCopy.goToGenesisUniverse,
				badgeLabel: commonCopy.notFound,
				badgeTone: 'blocked',
				detail: userMessagesCopy.missingUniverseDetail,
			})
		case 'ready':
			return undefined
		default:
			return assertNever(state)
	}
}

export function getWalletPresentation({ accountAddress, hasInjectedWallet, hasWallet, isMainnet, isSupportedChain }: { accountAddress: Address | undefined; hasInjectedWallet?: boolean; hasWallet?: boolean; isMainnet?: boolean; isSupportedChain?: boolean }) {
	const walletAvailable = hasWallet ?? hasInjectedWallet ?? true
	const supportedChain = isSupportedChain ?? isMainnet ?? true

	if (!walletAvailable)
		return createPresentation('wallet_disconnected', {
			badgeLabel: commonCopy.connectWallet,
			badgeTone: 'blocked',
			detail: userMessagesCopy.walletInstallationRequired,
		})
	if (accountAddress === undefined)
		return createPresentation('wallet_disconnected', {
			badgeLabel: commonCopy.connectWallet,
			badgeTone: 'blocked',
			detail: commonCopy.walletConnectionRequired,
		})
	if (!supportedChain)
		return createPresentation('wrong_network', {
			badgeLabel: userMessagesCopy.wrongNetwork,
			badgeTone: 'blocked',
			detail: getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason,
		})
	return undefined
}

export function getReportPresentation({ kind, state }: { kind: 'question' | 'report'; state: LoadableValueState }) {
	switch (state) {
		case 'loading':
			return createPresentation('loading', {
				detail: userMessagesCopy.retrieving,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				actionHint: userMessagesCopy.formatRefreshLookupAction(kind),
				badgeLabel: userMessagesCopy.notChecked,
				badgeTone: 'muted',
				detail: userMessagesCopy.formatUncheckedLookupDetail(kind),
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: commonCopy.notFound,
				badgeTone: 'blocked',
				detail: userMessagesCopy.formatMissingLookupDetail(kind),
			})
		case 'ready':
			return undefined
		default:
			return assertNever(state)
	}
}
