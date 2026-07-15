import type { Address } from '@zoltar/shared/ethereum'
import { assertNever } from './assert.js'
import { getWrongNetworkMessage } from './network.js'
import type { LoadableValueState } from './loadState.js'
import {
	UI_STRING_CHOOSE_A_UNIVERSE_TO_CONTINUE,
	UI_STRING_CHOOSE_ANOTHER_UNIVERSE,
	UI_STRING_CONNECT_WALLET,
	UI_STRING_CONNECT_WALLET_TO_CONTINUE,
	UI_STRING_CREATE_A_POOL_FROM_AN_EXACT_YES_NO_QUESTION_TO_ENABLE_SHARES_REPORTING_AND_VAULT_WORKFLOWS,
	UI_STRING_GO_TO_GENESIS_UNIVERSE,
	UI_STRING_INSTALL_OR_ENABLE_A_WALLET_TO_CONTINUE,
	UI_STRING_LOAD_SECURITY_POOLS_TO_CHECK_WHAT_IS_AVAILABLE_IN_THIS_UNIVERSE,
	UI_STRING_LOADING,
	UI_STRING_LOADING_UNIVERSE_DETAILS,
	UI_STRING_LOADING_WITH_ELLIPSIS,
	UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER,
	UI_STRING_NO_SECURITY_POOLS_ARE_AVAILABLE_IN_THIS_UNIVERSE,
	UI_STRING_NONE,
	UI_STRING_NOT_CHECKED,
	UI_STRING_NOT_FOUND,
	UI_STRING_OPEN_ONE_OF_THE_SECTIONS_BELOW,
	UI_STRING_OR_TRY_ANOTHER_ID,
	UI_STRING_PAGE_NOT_FOUND,
	UI_STRING_QUESTIONS_USER_COPY_REPORT_QUESTION_NOUN,
	UI_STRING_REFRESH,
	UI_STRING_REFRESHING_POOLS,
	UI_STRING_REPORTS,
	UI_STRING_RETRIEVING,
	UI_STRING_SWITCH_TO_ETHEREUM_MAINNET,
	UI_STRING_TO_CHECK_THIS_ID,
	UI_STRING_WRONG_NETWORK,
} from './uiStrings.js'

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

const METRIC_PLACEHOLDER = UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER

function createPresentation(key: UserMessageKey, presentation: Omit<UserMessagePresentation, 'key'>): UserMessagePresentation {
	return { key, ...presentation }
}

export function getMetricPlaceholderPresentation(value: unknown, options?: { loading?: boolean }) {
	if (value !== undefined) return undefined
	if (options?.loading === true)
		return createPresentation('loading', {
			badgeLabel: UI_STRING_LOADING,
			badgeTone: 'pending',
			placeholder: UI_STRING_LOADING_WITH_ELLIPSIS,
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
				badgeLabel: UI_STRING_LOADING,
				badgeTone: 'pending',
				detail: UI_STRING_REFRESHING_POOLS,
			})
		if (!input.hasLoaded)
			return createPresentation('not_checked', {
				badgeLabel: UI_STRING_NOT_CHECKED,
				badgeTone: 'muted',
				detail: UI_STRING_LOAD_SECURITY_POOLS_TO_CHECK_WHAT_IS_AVAILABLE_IN_THIS_UNIVERSE,
			})
		return createPresentation('empty', {
			actionHint: UI_STRING_CREATE_A_POOL_FROM_AN_EXACT_YES_NO_QUESTION_TO_ENABLE_SHARES_REPORTING_AND_VAULT_WORKFLOWS,
			badgeLabel: UI_STRING_NONE,
			badgeTone: 'muted',
			detail: UI_STRING_NO_SECURITY_POOLS_ARE_AVAILABLE_IN_THIS_UNIVERSE,
		})
	}

	switch (input.state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: UI_STRING_LOADING,
				badgeTone: 'pending',
				detail: UI_STRING_LOADING_WITH_ELLIPSIS,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: UI_STRING_NOT_CHECKED,
				badgeTone: 'muted',
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: UI_STRING_NOT_FOUND,
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
				badgeLabel: UI_STRING_LOADING,
				badgeTone: 'pending',
				detail: UI_STRING_LOADING_UNIVERSE_DETAILS,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: UI_STRING_NOT_CHECKED,
				badgeTone: 'muted',
				detail: UI_STRING_CHOOSE_A_UNIVERSE_TO_CONTINUE,
			})
		case 'missing':
			return createPresentation('not_found', {
				actionHint: UI_STRING_GO_TO_GENESIS_UNIVERSE,
				badgeLabel: UI_STRING_NOT_FOUND,
				badgeTone: 'blocked',
				detail: UI_STRING_CHOOSE_ANOTHER_UNIVERSE,
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
			badgeLabel: UI_STRING_CONNECT_WALLET,
			badgeTone: 'blocked',
			detail: UI_STRING_INSTALL_OR_ENABLE_A_WALLET_TO_CONTINUE,
		})
	if (accountAddress === undefined)
		return createPresentation('wallet_disconnected', {
			badgeLabel: UI_STRING_CONNECT_WALLET,
			badgeTone: 'blocked',
			detail: UI_STRING_CONNECT_WALLET_TO_CONTINUE,
		})
	if (!supportedChain)
		return createPresentation('wrong_network', {
			badgeLabel: UI_STRING_WRONG_NETWORK,
			badgeTone: 'blocked',
			detail: getWrongNetworkMessage() ?? UI_STRING_SWITCH_TO_ETHEREUM_MAINNET,
		})
	return undefined
}

export function getReportPresentation({ kind, state }: { kind: 'question' | 'report'; state: LoadableValueState }) {
	const noun = kind === 'question' ? UI_STRING_QUESTIONS_USER_COPY_REPORT_QUESTION_NOUN : UI_STRING_REPORTS
	switch (state) {
		case 'loading':
			return createPresentation('loading', {
				detail: UI_STRING_RETRIEVING,
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				actionHint: `${UI_STRING_REFRESH} ${noun}`,
				badgeLabel: UI_STRING_NOT_CHECKED,
				badgeTone: 'muted',
				detail: `${UI_STRING_REFRESH} ${noun} ${UI_STRING_TO_CHECK_THIS_ID}`,
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: UI_STRING_NOT_FOUND,
				badgeTone: 'blocked',
				detail: `${UI_STRING_REFRESH} ${noun} ${UI_STRING_OR_TRY_ANOTHER_ID}`,
			})
		case 'ready':
			return undefined
		default:
			return assertNever(state)
	}
}

export function getPageNotFoundPresentation() {
	return createPresentation('page_not_found', {
		actionHint: UI_STRING_OPEN_ONE_OF_THE_SECTIONS_BELOW,
		badgeLabel: UI_STRING_PAGE_NOT_FOUND,
		badgeTone: 'blocked',
	})
}
