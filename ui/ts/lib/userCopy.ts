import type { Address } from 'viem'
import type { LoadableValueState } from './loadState.js'

export type UserMessageKey = 'not_checked' | 'loading' | 'not_found' | 'empty' | 'action_needed' | 'wrong_network' | 'wallet_disconnected' | 'unavailable' | 'page_not_found' | 'load_failed'

export type UserMessageTone = 'muted' | 'pending' | 'blocked' | 'error' | 'ok'

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
	if (options?.loading === true) {
		return createPresentation('loading', {
			badgeLabel: 'Loading',
			badgeTone: 'pending',
			placeholder: 'Loading...',
		})
	}
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
		if (input.isLoading) {
			return createPresentation('loading', {
				badgeLabel: 'Loading',
				badgeTone: 'pending',
				detail: 'Refreshing pools.',
			})
		}
		if (!input.hasLoaded) {
			return createPresentation('not_checked', {
				actionHint: 'Refresh pools',
				badgeLabel: 'Not checked',
				badgeTone: 'muted',
				detail: 'Refresh pools to check again.',
			})
		}
		return createPresentation('empty', {
			badgeLabel: 'None yet',
			badgeTone: 'muted',
			detail: 'Refresh pools to check again.',
		})
	}

	switch (input.state) {
		case 'loading':
			return createPresentation('loading', {
				badgeLabel: 'Loading',
				badgeTone: 'pending',
				detail: 'Checking this address.',
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
	}
}

export function getWalletPresentation({
	accountAddress,
	activeNetworkLabel = 'Ethereum mainnet',
	hasInjectedWallet = true,
	isMainnet,
	walletMatchesActiveNetwork = isMainnet ?? true,
}: {
	accountAddress: Address | undefined
	activeNetworkLabel?: string
	hasInjectedWallet?: boolean
	isMainnet?: boolean
	walletMatchesActiveNetwork?: boolean
}) {
	if (!hasInjectedWallet) {
		return createPresentation('wallet_disconnected', {
			badgeLabel: 'Connect wallet',
			badgeTone: 'blocked',
			detail: 'Install or enable a wallet to continue.',
		})
	}
	if (accountAddress === undefined) {
		return createPresentation('wallet_disconnected', {
			badgeLabel: 'Connect wallet',
			badgeTone: 'blocked',
			detail: 'Connect wallet to continue.',
		})
	}
	if (!walletMatchesActiveNetwork) {
		return createPresentation('wrong_network', {
			badgeLabel: 'Wrong network',
			badgeTone: 'blocked',
			detail: `Switch wallet to ${activeNetworkLabel}.`,
		})
	}
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
