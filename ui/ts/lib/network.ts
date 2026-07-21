import * as commonCopy from '../copy/common.js'
import type { Address } from '@zoltar/shared/ethereum'
import { getActiveNetworkProfile } from './activeEnvironment.js'

const COMMON_CHAIN_NAMES = new Map<bigint, string>([
	[1n, 'Ethereum'],
	[10n, 'Optimism'],
	[25n, 'Cronos'],
	[56n, 'BNB Smart Chain'],
	[100n, 'Gnosis'],
	[137n, 'Polygon'],
	[169n, 'Manta Pacific'],
	[250n, 'Fantom'],
	[324n, 'zkSync Era'],
	[1101n, 'Polygon zkEVM'],
	[1284n, 'Moonbeam'],
	[5000n, 'Mantle'],
	[8453n, 'Base'],
	[42161n, 'Arbitrum One'],
	[42170n, 'Arbitrum Nova'],
	[42220n, 'Celo'],
	[43114n, 'Avalanche'],
	[59144n, 'Linea'],
	[81457n, 'Blast'],
	[534352n, 'Scroll'],
])

function parseChainId(chainId: string) {
	try {
		return BigInt(chainId)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

export function getChainIdDecimalLabel(chainId: string | undefined) {
	if (chainId === undefined) return undefined
	return parseChainId(chainId)?.toString()
}

export function getChainDisplayLabel(chainId: string | undefined) {
	if (chainId === undefined) return undefined
	const numericChainId = parseChainId(chainId)
	if (numericChainId === undefined) return chainId
	return COMMON_CHAIN_NAMES.get(numericChainId) ?? numericChainId.toString()
}

export function getKnownChainName(chainId: string | undefined) {
	if (chainId === undefined) return undefined
	const numericChainId = parseChainId(chainId)
	if (numericChainId === undefined) return undefined
	return COMMON_CHAIN_NAMES.get(numericChainId)
}

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
