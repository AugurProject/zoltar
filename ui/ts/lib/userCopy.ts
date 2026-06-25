import type { Address } from 'viem'
import { assertNever } from './assert.js'
import { getWrongNetworkMessage } from './network.js'
import type { LoadableValueState } from './loadState.js'

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

const METRIC_PLACEHOLDER = '—'

function createPresentation(key: UserMessageKey, presentation: Omit<UserMessagePresentation, 'key'>): UserMessagePresentation {
	return { key, ...presentation }
}

export function getMetricPlaceholderPresentation(value: unknown, options?: { loading?: boolean }) {
	if (value !== undefined) return undefined
	if (options?.loading === true)
		return createPresentation('loading', {
			badgeLabel: 'Loading',
			badgeTone: 'pending',
			placeholder: 'Loading...',
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
				badgeLabel: 'Loading',
				badgeTone: 'pending',
				detail: 'Refreshing pools.',
			})
		if (!input.hasLoaded)
			return createPresentation('not_checked', {
				badgeLabel: 'Not checked',
				badgeTone: 'muted',
				detail: 'Load security pools to check what is available in this universe.',
			})
		return createPresentation('empty', {
			actionHint: 'Create a pool from a binary question to enable trading, reporting, and vault collateral workflows.',
			badgeLabel: 'None yet',
			badgeTone: 'muted',
			detail: 'No security pools are available in this universe yet.',
		})
	}

	switch (input.state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: 'Loading',
				badgeTone: 'pending',
				detail: 'Loading...',
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: 'Not checked',
				badgeTone: 'muted',
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: 'Not found',
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
				badgeLabel: 'Loading',
				badgeTone: 'pending',
				detail: 'Loading universe details.',
			})
		case 'unknown':
			return createPresentation('not_checked', {
				badgeLabel: 'Not checked',
				badgeTone: 'muted',
				detail: 'Choose a universe to continue.',
			})
		case 'missing':
			return createPresentation('not_found', {
				actionHint: 'Go to Genesis universe',
				badgeLabel: 'Not found',
				badgeTone: 'blocked',
				detail: 'Choose another universe.',
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
			badgeLabel: 'Connect wallet',
			badgeTone: 'blocked',
			detail: 'Install or enable a wallet to continue.',
		})
	if (accountAddress === undefined)
		return createPresentation('wallet_disconnected', {
			badgeLabel: 'Connect wallet',
			badgeTone: 'blocked',
			detail: 'Connect wallet to continue.',
		})
	if (!supportedChain)
		return createPresentation('wrong_network', {
			badgeLabel: 'Wrong network',
			badgeTone: 'blocked',
			detail: getWrongNetworkMessage() ?? 'Switch to Ethereum mainnet.',
		})
	return undefined
}

export function getReportPresentation({ kind, state }: { kind: 'question' | 'report'; state: LoadableValueState }) {
	const noun = kind === 'question' ? 'questions' : 'reports'
	switch (state) {
		case 'loading':
			return createPresentation('loading', {
				detail: 'retrieving...',
				detailIsLoading: true,
			})
		case 'unknown':
			return createPresentation('not_checked', {
				actionHint: `Refresh ${noun}`,
				badgeLabel: 'Not checked',
				badgeTone: 'muted',
				detail: `Refresh ${noun} to check this ID.`,
			})
		case 'missing':
			return createPresentation('not_found', {
				badgeLabel: 'Not found',
				badgeTone: 'blocked',
				detail: `Refresh ${noun} or try another ID.`,
			})
		case 'ready':
			return undefined
		default:
			return assertNever(state)
	}
}

export function getPageNotFoundPresentation() {
	return createPresentation('page_not_found', {
		actionHint: 'Open one of the sections below.',
		badgeLabel: 'Page not found',
		badgeTone: 'blocked',
		detail: 'That page is not available here.',
	})
}
