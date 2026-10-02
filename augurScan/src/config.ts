import path from 'node:path'
import { getUniswapNetworkDeployment } from '@zoltar/core-shared/deployment/uniswapDeployments'
import { assertAbiCoverage } from './abi-catalog.ts'
import { blockExplorerUrl, getAddress, isAddress } from './ethereum.ts'
import { parseBasicAccessCredentials } from './http.ts'
import { parseManifestValue } from './manifest.ts'
import type { ManifestContract, NetworkConfig } from './types.ts'

type NetworkFile = {
	readonly id: string
	readonly name: string
	readonly chainId: number
	readonly rpcUrlEnv: string
	readonly startBlockEnv: string
	readonly ammFactoryAddressEnv: string
	readonly uniswapV2FactoryAddressEnv: string
	readonly uniswapV3FactoryAddressEnv: string
	readonly uniswapV4PoolManagerAddressEnv: string
	readonly defaultUniswapV2FactoryAddress: string | undefined
	readonly defaultRpcUrl: string
	readonly nativeSymbol: string
	readonly confirmationDepth: number
	readonly manifest: string
}

/** An empty activity-source override selects the network default; this value disables the source. */
const DISABLED_ACTIVITY_SOURCE = 'none'

const NETWORK_FILE_KEYS = new Set(['id', 'name', 'chainId', 'rpcUrlEnv', 'startBlockEnv', 'ammFactoryAddressEnv', 'uniswapV2FactoryAddressEnv', 'uniswapV3FactoryAddressEnv', 'uniswapV4PoolManagerAddressEnv', 'defaultUniswapV2FactoryAddress', 'defaultRpcUrl', 'nativeSymbol', 'confirmationDepth', 'manifest'])

const parseNetworkFile = (value: unknown, index: number): NetworkFile => {
	const label = `networks.json entry ${index.toString()}`
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	for (const key of Object.keys(value)) if (!NETWORK_FILE_KEYS.has(key)) throw new Error(`${label} has unknown field ${key}`)
	const string = (key: string) => {
		const field: unknown = Reflect.get(value, key)
		if (typeof field !== 'string' || field.trim() === '') throw new Error(`${label} ${key} must be a non-empty string`)
		return field
	}
	const optionalAddress = (key: string) => {
		const field: unknown = Reflect.get(value, key)
		if (field === undefined) return undefined
		if (typeof field !== 'string' || !isAddress(field)) throw new Error(`${label} ${key} must be a complete 20-byte EVM address`)
		return field
	}
	const positiveInteger = (key: string) => {
		const field: unknown = Reflect.get(value, key)
		if (typeof field !== 'number' || !Number.isSafeInteger(field) || field <= 0) throw new Error(`${label} ${key} must be a positive safe integer`)
		return field
	}
	return {
		id: string('id'),
		name: string('name'),
		chainId: positiveInteger('chainId'),
		rpcUrlEnv: string('rpcUrlEnv'),
		startBlockEnv: string('startBlockEnv'),
		ammFactoryAddressEnv: string('ammFactoryAddressEnv'),
		uniswapV2FactoryAddressEnv: string('uniswapV2FactoryAddressEnv'),
		uniswapV3FactoryAddressEnv: string('uniswapV3FactoryAddressEnv'),
		uniswapV4PoolManagerAddressEnv: string('uniswapV4PoolManagerAddressEnv'),
		defaultUniswapV2FactoryAddress: optionalAddress('defaultUniswapV2FactoryAddress'),
		defaultRpcUrl: string('defaultRpcUrl'),
		nativeSymbol: string('nativeSymbol'),
		confirmationDepth: positiveInteger('confirmationDepth'),
		manifest: string('manifest'),
	}
}

const parseNetworkFiles = (value: unknown): readonly NetworkFile[] => {
	if (!Array.isArray(value) || value.length === 0) throw new Error('At least one network must be configured')
	const definitions = value.map(parseNetworkFile)
	if (new Set(definitions.map(({ id }) => id)).size !== definitions.length) throw new Error('networks.json network ids must be unique')
	return definitions
}

const configRoot = path.resolve(import.meta.dir, '../config')

const resolveRpcLogPath = (configuredPath: string | undefined): string => (configuredPath === undefined ? path.resolve(import.meta.dir, '../logs/rpc.jsonl') : path.resolve(configuredPath))

const requirePositiveInteger = (value: string, name: string, allowZero = false): number => {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) throw new Error(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
	return parsed
}

const parseManifest = async (filename: string): Promise<readonly ManifestContract[]> => parseManifestValue(await Bun.file(path.join(configRoot, 'manifests', filename)).json(), filename)

export const loadNetworks = async (): Promise<readonly NetworkConfig[]> => {
	const definitions = parseNetworkFiles(await Bun.file(path.join(configRoot, 'networks.json')).json())
	const enabled = new Set((process.env['NETWORKS'] ?? definitions.map(({ id }) => id).join(',')).split(',').map((value: string) => value.trim()))
	const configuredIds = new Set(definitions.map(({ id }) => id))
	const unknownIds = [...enabled].filter(id => !configuredIds.has(id))
	if (unknownIds.length > 0) throw new Error(`NETWORKS contains unknown network${unknownIds.length === 1 ? '' : 's'}: ${unknownIds.join(', ')}`)
	const networks = await Promise.all(
		definitions
			.filter(({ id }) => enabled.has(id))
			.map(async definition => {
				const rpcUrls = (process.env[definition.rpcUrlEnv] ?? definition.defaultRpcUrl)
					.split(',')
					.map((value: string) => value.trim())
					.filter(Boolean)
				if (rpcUrls.length === 0) throw new Error(`${definition.rpcUrlEnv} must contain at least one RPC URL`)
				for (const rpcUrl of rpcUrls) {
					const parsed = new URL(rpcUrl)
					if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${definition.rpcUrlEnv} must contain HTTP(S) URLs`)
				}
				const startBlock = BigInt(process.env[definition.startBlockEnv] ?? '0')
				if (startBlock < 0n) throw new Error(`${definition.startBlockEnv} must not be negative`)
				const contracts = [...(await parseManifest(definition.manifest))]
				for (const [, label, , deploymentBlock] of contracts) {
					if (deploymentBlock !== undefined && deploymentBlock < startBlock) throw new Error(`${definition.manifest} deployment block for ${label} must not precede ${definition.startBlockEnv}`)
				}
				const ammFactoryAddress = process.env[definition.ammFactoryAddressEnv]?.trim()
				if (ammFactoryAddress !== undefined && ammFactoryAddress !== '') {
					if (!isAddress(ammFactoryAddress)) throw new Error(`${definition.ammFactoryAddressEnv} must be a complete 20-byte EVM address`)
					const normalized = getAddress(ammFactoryAddress)
					if (!contracts.some(([address]) => address.toLowerCase() === normalized.toLowerCase())) contracts.push([normalized, 'Augur AMM Factory', 'ammFactory'])
				}
				// Uniswap V3 and V4 defaults come from the registry shared with the UIs, bots, and deployer.
				const uniswapDeployment = getUniswapNetworkDeployment(definition.chainId)
				for (const [environmentName, defaultAddress, label, kind] of [
					[definition.uniswapV2FactoryAddressEnv, definition.defaultUniswapV2FactoryAddress, 'Uniswap V2 Factory', 'uniswapV2Factory'],
					[definition.uniswapV3FactoryAddressEnv, uniswapDeployment.uniswapV3FactoryAddress, 'Uniswap V3 Factory', 'uniswapV3Factory'],
					[definition.uniswapV4PoolManagerAddressEnv, uniswapDeployment.uniswapV4PoolManagerAddress, 'Uniswap V4 PoolManager', 'uniswapV4PoolManager'],
				] as const) {
					const override = process.env[environmentName]?.trim()
					if (override === DISABLED_ACTIVITY_SOURCE) continue
					const configuredAddress = override === undefined || override === '' ? defaultAddress : override
					if (configuredAddress === undefined) continue
					if (!isAddress(configuredAddress)) throw new Error(`${environmentName} must be a complete 20-byte EVM address`)
					const normalized = getAddress(configuredAddress)
					if (!contracts.some(([address]) => address.toLowerCase() === normalized.toLowerCase())) contracts.push([normalized, label, kind])
				}
				assertAbiCoverage(contracts.map(([, , kind]) => kind))
				// The block explorer comes from the chain definitions shared with the UIs and bots.
				const explorerBaseUrl = blockExplorerUrl(definition.chainId)
				if (explorerBaseUrl === undefined) throw new Error(`networks.json network ${definition.id} uses chain ${definition.chainId.toString()}, which has no shared block explorer`)
				return {
					id: definition.id,
					name: definition.name,
					chainId: definition.chainId,
					rpcUrls,
					startBlock,
					explorerBaseUrl,
					nativeSymbol: definition.nativeSymbol,
					confirmationDepth: BigInt(definition.confirmationDepth),
					contracts,
				} satisfies NetworkConfig
			}),
	)
	if (networks.length === 0) throw new Error('NETWORKS did not select a configured network')
	return networks
}

export const runtimeConfig = {
	port: requirePositiveInteger(process.env['PORT'] ?? '3000', 'PORT'),
	pollIntervalMs: requirePositiveInteger(process.env['POLL_INTERVAL_MS'] ?? '12000', 'POLL_INTERVAL_MS'),
	logScanRangeSize: requirePositiveInteger(process.env['LOG_SCAN_RANGE_SIZE'] ?? '100000', 'LOG_SCAN_RANGE_SIZE'),
	postgresUrl: process.env['POSTGRES_URL'] ?? 'postgres://augurscan:augurscan@localhost:5432/augurscan',
	rpcLogPath: resolveRpcLogPath(process.env['RPC_LOG_PATH']),
	disableIndexer: process.env['DISABLE_INDEXER'] === '1',
	accessCredentials: parseBasicAccessCredentials(process.env['AUGURSCAN_ACCESS_USERNAME'], process.env['AUGURSCAN_ACCESS_PASSWORD']),
	apiRateLimitPerMinute: requirePositiveInteger(process.env['API_RATE_LIMIT_PER_MINUTE'] ?? '600', 'API_RATE_LIMIT_PER_MINUTE', true),
	liveBackpressureTimeoutMs: requirePositiveInteger(process.env['LIVE_BACKPRESSURE_TIMEOUT_MS'] ?? '60000', 'LIVE_BACKPRESSURE_TIMEOUT_MS'),
	/** Raw lagging-report block interval override; `scanBlockTimeMs` validates it and applies per-chain defaults. */
	scanBlockTimeMsOverride: process.env['SCAN_BLOCK_TIME_MS'],
}
