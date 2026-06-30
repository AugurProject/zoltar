export const DEFAULT_RPC_URL = 'https://ethereum.dark.florist'
const RPC_URL_SEARCH_PARAM = 'rpcUrl'
const RPC_URL_STORAGE_KEY = 'zoltar.rpcUrl'
const LOCAL_HTTP_RPC_HOSTNAMES = new Set(['localhost', '::1', '[::1]'])

export type ConfiguredRpcSource = 'default' | 'environment' | 'global' | 'localStorage' | 'override' | 'url'
type ConfiguredRpcOverrideSource = Exclude<ConfiguredRpcSource, 'default'>

export type RejectedRpcOverride = {
	reason: string
	source: ConfiguredRpcOverrideSource
	url: string
}

export type ConfiguredRpcConfig = {
	rejectedOverride?: RejectedRpcOverride | undefined
	source: ConfiguredRpcSource
	url: string
}

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

function parseIpv4Byte(value: string) {
	if (!/^\d{1,3}$/.test(value)) return undefined
	const byte = Number(value)
	if (!Number.isInteger(byte) || byte < 0 || byte > 255) return undefined
	return byte
}

function isIpv4LoopbackHostname(hostname: string) {
	const parts = hostname.split('.')
	if (parts.length !== 4) return false
	const firstPart = parts[0]
	if (firstPart === undefined || parseIpv4Byte(firstPart) !== 127) return false

	for (const part of parts.slice(1)) {
		if (parseIpv4Byte(part) === undefined) return false
	}
	return true
}

function isLocalHttpRpcHostname(hostname: string) {
	return LOCAL_HTTP_RPC_HOSTNAMES.has(hostname) || isIpv4LoopbackHostname(hostname)
}

function getRpcUrlValidationError(url: string) {
	let parsedUrl: URL
	try {
		parsedUrl = new URL(url)
	} catch (error) {
		if (error instanceof TypeError) return 'RPC URL must be an absolute https:// URL, or http:// for local loopback.'
		throw error
	}

	if (parsedUrl.protocol === 'https:') return undefined
	if (parsedUrl.protocol === 'http:' && isLocalHttpRpcHostname(parsedUrl.hostname)) return undefined
	if (parsedUrl.protocol === 'http:') return 'RPC URL must use https:// unless it points to local loopback.'
	return 'RPC URL must use https://, or http:// for local loopback.'
}

function resolveConfiguredRpcOverride(source: ConfiguredRpcOverrideSource, value: unknown, fallbackRpcUrl: string): ConfiguredRpcConfig | undefined {
	const url = resolveNonEmptyString(value)
	if (url === undefined) return undefined

	const validationError = getRpcUrlValidationError(url)
	if (validationError === undefined) return { source, url }

	return {
		rejectedOverride: {
			reason: validationError,
			source,
			url,
		},
		source: 'default',
		url: fallbackRpcUrl,
	}
}

export function resolveConfiguredRpcConfig({ fallbackRpcUrl = DEFAULT_RPC_URL, location, overrideRpcUrl, storage }: { fallbackRpcUrl?: string; location?: LocationLike; overrideRpcUrl?: string; storage?: StorageLike } = {}): ConfiguredRpcConfig {
	const overrideConfig = resolveConfiguredRpcOverride('override', overrideRpcUrl, fallbackRpcUrl)
	if (overrideConfig !== undefined) return overrideConfig

	const globalWithRpcConfig = globalThis as GlobalWithRpcConfig
	const urlConfig = resolveConfiguredRpcOverride('url', readLocationParams(location ?? globalWithRpcConfig.location).get(RPC_URL_SEARCH_PARAM), fallbackRpcUrl)
	if (urlConfig !== undefined) return urlConfig

	const storedConfig = resolveConfiguredRpcOverride('localStorage', readStoredRpcUrl(storage ?? globalWithRpcConfig.localStorage), fallbackRpcUrl)
	if (storedConfig !== undefined) return storedConfig

	const globalConfig = resolveConfiguredRpcOverride('global', globalWithRpcConfig.__ZOLTAR_RPC_URL__, fallbackRpcUrl)
	if (globalConfig !== undefined) return globalConfig

	const environmentConfig = resolveConfiguredRpcOverride('environment', globalWithRpcConfig.process?.env?.['ZOLTAR_RPC_URL'], fallbackRpcUrl)
	if (environmentConfig !== undefined) return environmentConfig

	return { source: 'default', url: fallbackRpcUrl }
}

export function resolveConfiguredRpcUrl(options: Parameters<typeof resolveConfiguredRpcConfig>[0] = {}) {
	return resolveConfiguredRpcConfig(options).url
}
