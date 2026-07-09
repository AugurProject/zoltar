import type { Address } from '@zoltar/shared/ethereum'
import type { ActionAvailability } from '../types/components.js'
import { UI_STRINGS } from './uiStrings.js'

type WalletMainnetGuardParameters = {
	accountAddress: Address | string | undefined
	isMainnet: boolean
	walletRequiredReason?: string | undefined
}

type WalletConnectionMainnetGuardParameters = {
	isMainnet: boolean
	walletConnected: boolean
	walletRequiredReason?: string | undefined
}

type WalletMainnetGuardState = {
	blocked: boolean
	reason: string | undefined
}

function getWalletRequiredReason(walletRequiredReason: string | undefined) {
	return walletRequiredReason ?? UI_STRINGS.common.connectWalletToContinueDetail
}

export function getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason }: WalletMainnetGuardParameters): WalletMainnetGuardState {
	if (accountAddress === undefined) return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) }
	if (!isMainnet) return { blocked: true, reason: undefined }
	return { blocked: false, reason: undefined }
}

export function getWalletMainnetGuardMessage(parameters: WalletMainnetGuardParameters) {
	const guardState = getWalletMainnetGuardState(parameters)
	return guardState.reason
}

export function getWalletConnectionMainnetGuardState({ isMainnet, walletConnected, walletRequiredReason }: WalletConnectionMainnetGuardParameters): WalletMainnetGuardState {
	if (!walletConnected) return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) }
	if (!isMainnet) return { blocked: true, reason: undefined }
	return { blocked: false, reason: undefined }
}

export function getWalletMainnetActionAvailability({ accountAddress, isMainnet, walletRequiredReason }: WalletMainnetGuardParameters): ActionAvailability | undefined {
	const guardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason })
	if (!guardState.blocked) return undefined
	return { disabled: true, reason: guardState.reason }
}
