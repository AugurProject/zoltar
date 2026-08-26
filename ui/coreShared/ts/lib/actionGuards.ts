import * as commonCopy from '../copy/common.js'
import type { Address } from '@zoltar/shared/ethereum'
import type { ActionAvailability } from '../types/components.js'
import { getWrongNetworkReason } from './network.js'

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
}

function getWalletRequiredReason(walletRequiredReason: string | undefined) {
	return walletRequiredReason ?? commonCopy.walletConnectionRequired
}

export function getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): WalletActiveAppChainGuardState {
	if (accountAddress === undefined) return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) }
	if (!isOnActiveAppChain) return { blocked: true, reason: getWrongNetworkReason() }
	return { blocked: false, reason: undefined }
}

export function getWalletActiveAppChainGuardMessage(parameters: WalletActiveAppChainGuardParameters) {
	const guardState = getWalletActiveAppChainGuardState(parameters)
	return guardState.reason
}

export function getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected, walletRequiredReason }: WalletConnectionActiveAppChainGuardParameters): WalletActiveAppChainGuardState {
	if (!walletConnected) return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) }
	if (!isOnActiveAppChain) return { blocked: true, reason: getWrongNetworkReason() }
	return { blocked: false, reason: undefined }
}

export function getWalletActiveAppChainActionAvailability({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): ActionAvailability | undefined {
	const guardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason })
	if (!guardState.blocked) return undefined
	return { disabled: true, reason: guardState.reason }
}
