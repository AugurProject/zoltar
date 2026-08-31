import path from 'node:path'
import { getAddress, isAddress } from './ethereum.ts'
import { parseBasicAccessCredentials } from './http.ts'
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
	readonly defaultUniswapV2FactoryAddress?: string
	readonly defaultUniswapV3FactoryAddress?: string
	readonly defaultUniswapV4PoolManagerAddress?: string
	readonly defaultRpcUrl: string
	readonly explorerBaseUrl: string
	readonly nativeSymbol: string
	readonly confirmationDepth: number
	readonly manifest: string
}

const configRoot = path.resolve(import.meta.dir, '../config')

export const resolveRpcLogPath = (configuredPath: string | undefined): string =>
	configuredPath === undefined ? path.resolve(import.meta.dir, '../logs/rpc.jsonl') : path.resolve(configuredPath)

const requirePositiveInteger = (value: string, name: string, allowZero = false): number => {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0))
		throw new Error(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
	return parsed
}

export const parseManifestValue = (value: { contracts?: unknown }, filename: string): readonly ManifestContract[] => {
	if (!Array.isArray(value.contracts)) throw new Error(`${filename} must contain a contracts array`)
	const addresses = new Set<string>()
	return value.contracts.map((entry, index) => {
		if (
			!Array.isArray(entry) ||
			(entry.length !== 3 && entry.length !== 4) ||
			typeof entry[0] !== 'string' ||
			!isAddress(entry[0]) ||
			typeof entry[1] !== 'string' ||
			typeof entry[2] !== 'string' ||
			(entry[3] !== undefined && (typeof entry[3] !== 'string' || !/^\d+$/.test(entry[3])))
		) {
			throw new Error(`${filename} contract ${index} is invalid`)
		}
		const address = getAddress(entry[0])
		const key = address.toLowerCase()
		if (addresses.has(key)) throw new Error(`${filename} contract ${index} duplicates address ${address}`)
		addresses.add(key)
		return entry[3] === undefined ? ([address, entry[1], entry[2]] as const) : ([address, entry[1], entry[2], BigInt(entry[3])] as const)
	})
}

const parseManifest = async (filename: string): Promise<readonly ManifestContract[]> =>
	parseManifestValue((await Bun.file(path.join(configRoot, 'manifests', filename)).json()) as { contracts?: unknown }, filename)

export const loadNetworks = async (): Promise<readonly NetworkConfig[]> => {
	const definitions = (await Bun.file(path.join(configRoot, 'networks.json')).json()) as readonly NetworkFile[]
	if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('At least one network must be configured')
	const enabled = new Set((process.env['NETWORKS'] ?? definitions.map(({ id }) => id).join(',')).split(',').map((value) => value.trim()))
	const configuredIds = new Set(definitions.map(({ id }) => id))
	const unknownIds = [...enabled].filter((id) => !configuredIds.has(id))
	if (unknownIds.length > 0) throw new Error(`NETWORKS contains unknown network${unknownIds.length === 1 ? '' : 's'}: ${unknownIds.join(', ')}`)
	const networks = await Promise.all(
		definitions
			.filter(({ id }) => enabled.has(id))
			.map(async (definition) => {
				const rpcUrls = (process.env[definition.rpcUrlEnv] ?? definition.defaultRpcUrl)
					.split(',')
					.map((value) => value.trim())
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
					if (deploymentBlock !== undefined && deploymentBlock < startBlock)
						throw new Error(`${definition.manifest} deployment block for ${label} must not precede ${definition.startBlockEnv}`)
				}
				const ammFactoryAddress = process.env[definition.ammFactoryAddressEnv]?.trim()
				if (ammFactoryAddress !== undefined && ammFactoryAddress !== '') {
					if (!isAddress(ammFactoryAddress)) throw new Error(`${definition.ammFactoryAddressEnv} must be a complete 20-byte EVM address`)
					const normalized = getAddress(ammFactoryAddress)
					if (!contracts.some(([address]) => address.toLowerCase() === normalized.toLowerCase()))
						contracts.push([normalized, 'Augur AMM Factory', 'ammFactory'])
				}
				for (const [environmentName, defaultAddress, label, kind] of [
					[definition.uniswapV2FactoryAddressEnv, definition.defaultUniswapV2FactoryAddress, 'Uniswap V2 Factory', 'uniswapV2Factory'],
					[definition.uniswapV3FactoryAddressEnv, definition.defaultUniswapV3FactoryAddress, 'Uniswap V3 Factory', 'uniswapV3Factory'],
					[definition.uniswapV4PoolManagerAddressEnv, definition.defaultUniswapV4PoolManagerAddress, 'Uniswap V4 PoolManager', 'uniswapV4PoolManager'],
				] as const) {
					const configuredAddress = process.env[environmentName]?.trim() ?? defaultAddress
					if (configuredAddress === undefined || configuredAddress === '') continue
					if (!isAddress(configuredAddress)) throw new Error(`${environmentName} must be a complete 20-byte EVM address`)
					const normalized = getAddress(configuredAddress)
					if (!contracts.some(([address]) => address.toLowerCase() === normalized.toLowerCase())) contracts.push([normalized, label, kind])
				}
				return {
					id: definition.id,
					name: definition.name,
					chainId: definition.chainId,
					rpcUrls,
					startBlock,
					explorerBaseUrl: definition.explorerBaseUrl,
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
	logScanRangeSize: requirePositiveInteger(process.env['LOG_SCAN_RANGE_SIZE'] ?? '10000', 'LOG_SCAN_RANGE_SIZE'),
	postgresUrl: process.env['POSTGRES_URL'] ?? 'postgres://augurscan:augurscan@localhost:5432/augurscan',
	rpcLogPath: resolveRpcLogPath(process.env['RPC_LOG_PATH']),
	disableIndexer: process.env['DISABLE_INDEXER'] === '1',
	accessCredentials: parseBasicAccessCredentials(process.env['AUGURSCAN_ACCESS_USERNAME'], process.env['AUGURSCAN_ACCESS_PASSWORD']),
	apiRateLimitPerMinute: requirePositiveInteger(process.env['API_RATE_LIMIT_PER_MINUTE'] ?? '600', 'API_RATE_LIMIT_PER_MINUTE', true),
}
