import type { Address } from '@zoltar/shared/ethereum'
import { assertNever } from './assert.js'
import { getWrongNetworkMessage } from './network.js'
import type { LoadableValueState } from './loadState.js'
import { UI_STRINGS } from './uiStrings.js'

export type UserMessageKey = 'not_checked' | 'loading' | 'not_found' | 'empty' | 'action_needed' | 'wrong_network' | 'wallet_disconnected' | 'unavailable' | 'page_not_found' | 'load_failed'

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

const METRIC_PLACEHOLDER = UI_STRINGS.common.metricUnavailablePlaceholder

function createPresentation(key: UserMessageKey, presentation: Omit<UserMessagePresentation, 'key'>): UserMessagePresentation {
	return { key, ...presentation }
}

export function getMetricPlaceholderPresentation(value: unknown, options?: { loading?: boolean }) {
	if (value !== undefined) return undefined
	if (options?.loading === true)
		return createPresentation('loading', {
			badgeLabel: UI_STRINGS.userCopy.poolRegistry.collection.loadingBadgeLabel,
			badgeTone: 'pending',
			placeholder: UI_STRINGS.userCopy.poolRegistry.selection.loadingDetail,
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
				badgeLabel: UI_STRINGS.userCopy.poolRegistry.collection.loadingBadgeLabel,
				badgeTone: 'pending',
				detail: UI_STRINGS.userCopy.poolRegistry.collection.loadingDetail,
			})
		if (!input.hasLoaded)
			return createPresentation('not_checked', {
				badgeLabel: UI_STRINGS.userCopy.poolRegistry.collection.notCheckedBadgeLabel,
				badgeTone: 'muted',
				detail: UI_STRINGS.userCopy.poolRegistry.collection.notCheckedDetail,
			})
		return createPresentation('empty', {
			actionHint: UI_STRINGS.userCopy.poolRegistry.collection.emptyActionHint,
			badgeLabel: UI_STRINGS.userCopy.poolRegistry.collection.emptyBadgeLabel,
			badgeTone: 'muted',
			detail: UI_STRINGS.userCopy.poolRegistry.collection.emptyDetail,
		})
	}

	switch (input.state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: UI_STRINGS.userCopy.poolRegistry.selection.loadingBadgeLabel,
				badgeTone: 'pending',
				detail: UI_STRINGS.userCopy.poolRegistry.selection.loadingDetail,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: UI_STRINGS.userCopy.poolRegistry.selection.notCheckedBadgeLabel,
				badgeTone: 'muted',
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: UI_STRINGS.userCopy.poolRegistry.selection.notFoundBadgeLabel,
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
				badgeLabel: UI_STRINGS.userCopy.universe.loadingBadgeLabel,
				badgeTone: 'pending',
				detail: UI_STRINGS.userCopy.universe.loadingDetail,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: UI_STRINGS.userCopy.universe.notCheckedBadgeLabel,
				badgeTone: 'muted',
				detail: UI_STRINGS.userCopy.universe.notCheckedDetail,
			})
		case 'missing':
			return createPresentation('not_found', {
				actionHint: UI_STRINGS.userCopy.universe.goToGenesisUniverseActionHint,
				badgeLabel: UI_STRINGS.userCopy.universe.notFoundBadgeLabel,
				badgeTone: 'blocked',
				detail: UI_STRINGS.userCopy.universe.notFoundDetail,
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
			badgeLabel: UI_STRINGS.userCopy.wallet.connectWalletBadgeLabel,
			badgeTone: 'blocked',
			detail: UI_STRINGS.userCopy.wallet.installWalletDetail,
		})
	if (accountAddress === undefined)
		return createPresentation('wallet_disconnected', {
			badgeLabel: UI_STRINGS.userCopy.wallet.connectWalletBadgeLabel,
			badgeTone: 'blocked',
			detail: UI_STRINGS.userCopy.wallet.connectWalletDetail,
		})
	if (!supportedChain)
		return createPresentation('wrong_network', {
			badgeLabel: UI_STRINGS.userCopy.wallet.wrongNetworkBadgeLabel,
			badgeTone: 'blocked',
			detail: getWrongNetworkMessage() ?? UI_STRINGS.userCopy.wallet.switchToMainnetDetail,
		})
	return undefined
}

export function getReportPresentation({ kind, state }: { kind: 'question' | 'report'; state: LoadableValueState }) {
	const noun = kind === 'question' ? UI_STRINGS.userCopy.report.questionNoun : UI_STRINGS.userCopy.report.reportNoun
	switch (state) {
		case 'loading':
			return createPresentation('loading', {
				detail: UI_STRINGS.userCopy.report.loadingDetail,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				actionHint: `${UI_STRINGS.userCopy.report.refreshActionHintPrefix} ${noun}`,
				badgeLabel: UI_STRINGS.userCopy.report.notCheckedBadgeLabel,
				badgeTone: 'muted',
				detail: `${UI_STRINGS.userCopy.report.refreshActionHintPrefix} ${noun} ${UI_STRINGS.userCopy.report.refreshToCheckIdSuffix}`,
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: UI_STRINGS.userCopy.report.notFoundBadgeLabel,
				badgeTone: 'blocked',
				detail: `${UI_STRINGS.userCopy.report.refreshActionHintPrefix} ${noun} ${UI_STRINGS.userCopy.report.refreshOrTryAnotherIdSuffix}`,
			})
		case 'ready':
			return undefined
		default:
			return assertNever(state)
	}
}

export function getPageNotFoundPresentation() {
	return createPresentation('page_not_found', {
		actionHint: UI_STRINGS.userCopy.pageNotFound.actionHint,
		badgeLabel: UI_STRINGS.userCopy.pageNotFound.badgeLabel,
		badgeTone: 'blocked',
	})
}
