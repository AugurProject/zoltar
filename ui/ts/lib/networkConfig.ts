import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE, type NetworkProfile } from './networkProfile.js'

const NETWORK_SEARCH_PARAM = 'network'
const NETWORK_STORAGE_KEY = 'zoltar.network'

type LocationLike = {
	hash?: string
	search?: string
}

type StorageLike = {
	getItem(key: string): string | null
}

type GlobalWithNetworkConfig = typeof globalThis & {
	__ZOLTAR_NETWORK__?: unknown
	location?: LocationLike
	localStorage?: StorageLike
	process?: {
		env?: Record<string, string | undefined>
	}
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

function readStoredNetwork(storage: StorageLike | undefined) {
	if (storage === undefined) return undefined
	try {
		return storage.getItem(NETWORK_STORAGE_KEY) ?? undefined
	} catch (error) {
		if (error instanceof Error) return undefined
		return undefined
	}
}

function getNetworkProfile(value: unknown): NetworkProfile | undefined {
	if (typeof value !== 'string') return undefined
	switch (value.trim().toLowerCase()) {
		case 'mainnet':
			return MAINNET_NETWORK_PROFILE
		case 'sepolia':
			return SEPOLIA_NETWORK_PROFILE
		default:
			return undefined
	}
}

export function resolveConfiguredNetworkProfile({ location, network, storage }: { location?: LocationLike; network?: string; storage?: StorageLike } = {}) {
	const directProfile = getNetworkProfile(network)
	if (directProfile !== undefined) return directProfile

	const globalWithNetworkConfig = globalThis as GlobalWithNetworkConfig
	const urlProfile = getNetworkProfile(readLocationParams(location ?? globalWithNetworkConfig.location).get(NETWORK_SEARCH_PARAM))
	if (urlProfile !== undefined) return urlProfile
	const storedProfile = getNetworkProfile(readStoredNetwork(storage ?? globalWithNetworkConfig.localStorage))
	if (storedProfile !== undefined) return storedProfile
	const globalProfile = getNetworkProfile(globalWithNetworkConfig.__ZOLTAR_NETWORK__)
	if (globalProfile !== undefined) return globalProfile
	const environmentProfile = getNetworkProfile(globalWithNetworkConfig.process?.env?.['ZOLTAR_NETWORK'])
	return environmentProfile ?? MAINNET_NETWORK_PROFILE
}
