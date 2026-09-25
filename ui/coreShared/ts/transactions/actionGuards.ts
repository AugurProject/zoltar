import * as commonCopy from '../copy/common.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ActionAvailability, ActionAvailabilityReason, WalletActionBlocker } from '../types/components.js'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { getWrongNetworkReason } from '../wallet/network.js'
import { getNetworkSwitchTarget } from '../wallet/networkProfile.js'

type WalletActiveAppChainGuardParameters = {
	accountAddress: Address | string | undefined
	isOnActiveAppChain: boolean
	walletRequiredReason?: string | undefined
}

type WalletConnectionActiveAppChainGuardParameters = {
	isOnActiveAppChain: boolean
	walletConnected: boolean
	walletRequiredReason?: string | undefined
}

type WalletActiveAppChainGuardState = {
	blocked: boolean
	reason: string | undefined
	walletBlocker: WalletActionBlocker | undefined
}

function getWalletRequiredReason(walletRequiredReason: string | undefined) {
	return walletRequiredReason ?? commonCopy.walletConnectionRequired
}

/** Classifies the wallet prerequisite that blocks a transaction: no connected account first, then a wallet on another network. */
export function getWalletActionBlocker({ isOnActiveAppChain, targetChainName, walletConnected }: { isOnActiveAppChain: boolean; targetChainName: string; walletConnected: boolean }): WalletActionBlocker | undefined {
	if (!walletConnected) return { kind: 'wallet-disconnected' }
	if (!isOnActiveAppChain) return { kind: 'wrong-network', targetChainName }
	return undefined
}

/** The wallet prerequisite for the active application network. */
export function getActiveAppChainWalletBlocker({ accountAddress, isOnActiveAppChain }: { accountAddress: Address | string | undefined; isOnActiveAppChain: boolean }) {
	return getWalletActionBlocker({ isOnActiveAppChain, targetChainName: getNetworkSwitchTarget(getActiveNetworkProfile()), walletConnected: accountAddress !== undefined })
}

/** Marks a disabled availability as blocked by the wallet so the action offers the connect or switch fix; enabled availability is unchanged. */
export function withWalletBlocker(availability: ActionAvailability, walletBlocker: WalletActionBlocker | undefined): ActionAvailability {
	if (!availability.disabled || walletBlocker === undefined) return availability
	return { ...availability, walletBlocker }
}

/** Marks a disabled availability with the active application network's wallet prerequisite, when one blocks the action. */
export function withActiveAppChainWalletBlocker(availability: ActionAvailability, wallet: { accountAddress: Address | string | undefined; isOnActiveAppChain: boolean }) {
	return withWalletBlocker(availability, getActiveAppChainWalletBlocker(wallet))
}

/** The typed reason a disabled action is unavailable, or undefined when it is available or gives no reason. */
export function getActionAvailabilityReason(availability: ActionAvailability | undefined): ActionAvailabilityReason | undefined {
	if (availability === undefined || !availability.disabled) return undefined
	if (availability.walletBlocker !== undefined) return availability.walletBlocker
	if (availability.reason === undefined) return undefined
	return { kind: 'other', message: availability.reason }
}

function createGuardState(walletBlocker: WalletActionBlocker | undefined, walletRequiredReason: string | undefined): WalletActiveAppChainGuardState {
	if (walletBlocker === undefined) return { blocked: false, reason: undefined, walletBlocker }
	return { blocked: true, reason: walletBlocker.kind === 'wallet-disconnected' ? getWalletRequiredReason(walletRequiredReason) : getWrongNetworkReason(), walletBlocker }
}

export function getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): WalletActiveAppChainGuardState {
	return createGuardState(getActiveAppChainWalletBlocker({ accountAddress, isOnActiveAppChain }), walletRequiredReason)
}

export function getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected, walletRequiredReason }: WalletConnectionActiveAppChainGuardParameters): WalletActiveAppChainGuardState {
	return createGuardState(getWalletActionBlocker({ isOnActiveAppChain, targetChainName: getNetworkSwitchTarget(getActiveNetworkProfile()), walletConnected }), walletRequiredReason)
}

export function getWalletActiveAppChainActionAvailability({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): ActionAvailability | undefined {
	const guardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason })
	if (!guardState.blocked) return undefined
	return { disabled: true, reason: guardState.reason, walletBlocker: guardState.walletBlocker }
}
