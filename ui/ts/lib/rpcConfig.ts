export const DEFAULT_RPC_URL = 'https://ethereum.dark.florist'
const RPC_URL_SEARCH_PARAM = 'rpcUrl'
const RPC_URL_STORAGE_KEY = 'zoltar.rpcUrl'

type LocationLike = {
	hash?: string
	search?: string
}

type StorageLike = {
	getItem(key: string): string | null
}

type GlobalWithRpcConfig = typeof globalThis & {
	__ZOLTAR_RPC_URL__?: unknown
	location?: LocationLike
	localStorage?: StorageLike
	process?: {
		env?: Record<string, string | undefined>
	}
}

function resolveNonEmptyString(value: unknown) {
	if (typeof value !== 'string') return undefined
	const normalizedValue = value.trim()
	return normalizedValue === '' ? undefined : normalizedValue
}

function readLocationParams(location: LocationLike | undefined) {
	const params = new URLSearchParams(location?.search ?? '')
	const hash = location?.hash ?? ''
	const hashQueryIndex = hash.indexOf('?')
	if (hashQueryIndex === -1) return params
	for (const [key, value] of new URLSearchParams(hash.slice(hashQueryIndex))) {
		params.set(key, value)
	}
	return params
}

function readStoredRpcUrl(storage: StorageLike | undefined) {
	if (storage === undefined) return undefined
	try {
		return storage.getItem(RPC_URL_STORAGE_KEY)
	} catch (error) {
		if (error instanceof Error) return undefined
		return undefined
	}
}

export function resolveConfiguredRpcUrl({ fallbackRpcUrl = DEFAULT_RPC_URL, location, overrideRpcUrl, storage }: { fallbackRpcUrl?: string; location?: LocationLike; overrideRpcUrl?: string; storage?: StorageLike } = {}) {
	const normalizedOverrideRpcUrl = resolveNonEmptyString(overrideRpcUrl)
	if (normalizedOverrideRpcUrl !== undefined) return normalizedOverrideRpcUrl

	const globalWithRpcConfig = globalThis as GlobalWithRpcConfig
	const rpcUrlSearchParam = resolveNonEmptyString(readLocationParams(location ?? globalWithRpcConfig.location).get(RPC_URL_SEARCH_PARAM))
	if (rpcUrlSearchParam !== undefined) return rpcUrlSearchParam

	const storedRpcUrl = resolveNonEmptyString(readStoredRpcUrl(storage ?? globalWithRpcConfig.localStorage))
	if (storedRpcUrl !== undefined) return storedRpcUrl

	const globalRpcUrl = resolveNonEmptyString(globalWithRpcConfig.__ZOLTAR_RPC_URL__)
	if (globalRpcUrl !== undefined) return globalRpcUrl

	const environmentRpcUrl = resolveNonEmptyString(globalWithRpcConfig.process?.env?.['ZOLTAR_RPC_URL'])
	if (environmentRpcUrl !== undefined) return environmentRpcUrl

	return fallbackRpcUrl
}
