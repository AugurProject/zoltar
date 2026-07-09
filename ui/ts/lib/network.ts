import { getActiveNetworkProfile } from './activeEnvironment.js'
import { UI_STRINGS } from './uiStrings.js'

export function isSupportedAppChain(chainId: string | undefined) {
	const profile = getActiveNetworkProfile()
	return profile.isSupportedAppChain && chainId === profile.chainIdHex
}

export function isMainnetChain(chainId: string | undefined) {
	return isSupportedAppChain(chainId)
}

export function getWrongNetworkMessage() {
	const profile = getActiveNetworkProfile()
	if (profile.id === 'simulation') return undefined
	return UI_STRINGS.userCopy.wallet.switchToMainnetDetail
}
