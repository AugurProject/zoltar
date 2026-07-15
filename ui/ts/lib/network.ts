import * as commonCopy from '../copy/common.js'
import type { Address } from '@zoltar/shared/ethereum'
import { getActiveNetworkProfile } from './activeEnvironment.js'

export function isSupportedAppChain(chainId: string | undefined) {
	const profile = getActiveNetworkProfile()
	return profile.isSupportedAppChain && chainId === profile.chainIdHex
}

export function isMainnetChain(chainId: string | undefined) {
	return isSupportedAppChain(chainId)
}

export function getWalletScopedAccountAddress(accountAddress: Address | undefined, chainId: string | undefined) {
	if (accountAddress === undefined || chainId === undefined) return undefined
	return isSupportedAppChain(chainId) ? accountAddress : undefined
}

export function getWrongNetworkMessage() {
	const profile = getActiveNetworkProfile()
	if (profile.id === 'simulation') return undefined
	return commonCopy.mainnetRequiredReason
}
