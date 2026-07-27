import { getAddress, type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '../abis.js'
import { getActiveBackend } from './activeEnvironment.js'
import type { ChainBackend } from './chainBackend.js'
import { hasErrorCode } from './errors.js'

export type WalletAssetWatchResult = { status: 'accepted' } | { status: 'declined' } | { status: 'dismissed' } | { status: 'failed' } | { status: 'stale' } | { status: 'unavailable' } | { status: 'unsupported' } | { status: 'wrong-network' }

export type WalletAssetMetadata = {
	decimals: number
	symbol: string
}

export type WalletAssetRequest = {
	method: 'wallet_watchAsset'
	params: {
		options: {
			address: Address
			decimals: number
			symbol: string
		}
		type: 'ERC20'
	}
}

type WalletAssetRequestDependencies = {
	expectedChainId: string
	expectedAccount: Address
	getActiveAccount: () => Promise<Address | undefined>
	getActiveChainId: () => Promise<string>
	isCurrent: () => boolean
	readTokenMetadata: (address: Address) => Promise<WalletAssetMetadata>
	request: (request: WalletAssetRequest) => Promise<unknown>
}

function isMatchingChainId(activeChainId: string, expectedChainId: string) {
	try {
		return BigInt(activeChainId) === BigInt(expectedChainId)
	} catch (error) {
		if (error instanceof SyntaxError) return false
		throw error
	}
}

function normalizeTokenMetadata(metadata: WalletAssetMetadata) {
	const symbol = metadata.symbol.trim()
	if (symbol === '' || symbol.length > 11) return undefined
	if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) return undefined
	return { decimals: metadata.decimals, symbol }
}

function getProviderErrorCode(error: unknown) {
	return hasErrorCode(error) ? String(error.code) : undefined
}

function isUserDismissal(error: unknown) {
	return getProviderErrorCode(error) === '4001'
}

function isUnsupportedMethod(error: unknown) {
	const code = getProviderErrorCode(error)
	return code === '-32601' || code === '4200'
}

export function normalizeWalletAssetFailure(_reason: unknown): WalletAssetWatchResult {
	return { status: 'failed' }
}

export async function requestWalletWatchAsset(address: Address, dependencies: WalletAssetRequestDependencies): Promise<WalletAssetWatchResult> {
	let activeChainId: string
	try {
		activeChainId = await dependencies.getActiveChainId()
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}
	if (!isMatchingChainId(activeChainId, dependencies.expectedChainId)) return { status: 'wrong-network' }

	let normalizedAddress: Address
	try {
		normalizedAddress = getAddress(address)
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}

	let metadata: WalletAssetMetadata
	try {
		metadata = await dependencies.readTokenMetadata(normalizedAddress)
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}
	const normalizedMetadata = normalizeTokenMetadata(metadata)
	if (normalizedMetadata === undefined) return { status: 'failed' }

	const request = {
		method: 'wallet_watchAsset',
		params: {
			options: {
				address: normalizedAddress,
				decimals: normalizedMetadata.decimals,
				symbol: normalizedMetadata.symbol,
			},
			type: 'ERC20',
		},
	} satisfies WalletAssetRequest

	try {
		activeChainId = await dependencies.getActiveChainId()
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}
	if (!isMatchingChainId(activeChainId, dependencies.expectedChainId)) return { status: 'wrong-network' }
	if (!dependencies.isCurrent()) return { status: 'stale' }
	let activeAccount: Address | undefined
	try {
		activeAccount = await dependencies.getActiveAccount()
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}
	if (activeAccount !== dependencies.expectedAccount || !dependencies.isCurrent()) return { status: 'stale' }
	try {
		activeChainId = await dependencies.getActiveChainId()
	} catch (error) {
		return normalizeWalletAssetFailure(error)
	}
	if (!isMatchingChainId(activeChainId, dependencies.expectedChainId)) return { status: 'wrong-network' }
	if (!dependencies.isCurrent()) return { status: 'stale' }

	let result: unknown
	try {
		result = await dependencies.request(request)
	} catch (error) {
		if (isUserDismissal(error)) return { status: 'dismissed' }
		if (isUnsupportedMethod(error)) return { status: 'unsupported' }
		return normalizeWalletAssetFailure(error)
	}
	if (result === true) return { status: 'accepted' }
	if (result === false) return { status: 'declined' }
	return { status: 'failed' }
}

async function readTokenMetadata(backend: ChainBackend, address: Address): Promise<WalletAssetMetadata> {
	const client = backend.createReadClient()
	const [symbol, decimals] = await Promise.all([
		client.readContract({
			abi: ABIS.mainnet.erc20,
			address,
			functionName: 'symbol',
		}),
		client.readContract({
			abi: ABIS.mainnet.erc20,
			address,
			functionName: 'decimals',
		}),
	])
	return {
		decimals: Number(decimals),
		symbol: String(symbol),
	}
}

export async function watchActiveWalletAsset(address: Address, expectedAccount: Address, isCurrent: () => boolean): Promise<WalletAssetWatchResult> {
	const backend = getActiveBackend()
	if (backend.id !== 'injected' || !backend.hasWallet()) return { status: 'unavailable' }
	const provider = backend.getProvider()
	if (provider === undefined) return { status: 'unavailable' }

	return await requestWalletWatchAsset(address, {
		expectedChainId: backend.profile.chainIdHex,
		expectedAccount,
		getActiveAccount: async () => (await backend.getAccounts())[0],
		getActiveChainId: async () => await backend.getChainId(),
		isCurrent,
		readTokenMetadata: async tokenAddress => await readTokenMetadata(backend, tokenAddress),
		request: async request => await provider.request(request),
	})
}
