import path from 'node:path'
import { getAddress, isAddress } from './ethereum.ts'
import type { ManifestContract, NetworkConfig } from './types.ts'

type NetworkFile = {
	readonly id: string
	readonly name: string
	readonly chainId: number
	readonly rpcUrlEnv: string
	readonly startBlockEnv: string
	readonly defaultRpcUrl: string
	readonly explorerBaseUrl: string
	readonly nativeSymbol: string
	readonly confirmationDepth: number
	readonly manifest: string
}

const configRoot = path.resolve(import.meta.dir, '../config')

const requirePositiveInteger = (value: string, name: string, allowZero = false): number => {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0))
		throw new Error(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`)
	return parsed
}

const parseManifest = async (filename: string): Promise<readonly ManifestContract[]> => {
	const value = (await Bun.file(path.join(configRoot, 'manifests', filename)).json()) as { contracts?: unknown }
	if (!Array.isArray(value.contracts)) throw new Error(`${filename} must contain a contracts array`)
	return value.contracts.map((entry, index) => {
		if (
			!Array.isArray(entry) ||
			entry.length !== 3 ||
			typeof entry[0] !== 'string' ||
			!isAddress(entry[0]) ||
			typeof entry[1] !== 'string' ||
			typeof entry[2] !== 'string'
		) {
			throw new Error(`${filename} contract ${index} is invalid`)
		}
		return [getAddress(entry[0]), entry[1], entry[2]] as const
	})
}

export const loadNetworks = async (): Promise<readonly NetworkConfig[]> => {
	const definitions = (await Bun.file(path.join(configRoot, 'networks.json')).json()) as readonly NetworkFile[]
	if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('At least one network must be configured')
	const enabled = new Set((process.env['NETWORKS'] ?? definitions.map(({ id }) => id).join(',')).split(',').map((value) => value.trim()))
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
				return {
					id: definition.id,
					name: definition.name,
					chainId: definition.chainId,
					rpcUrls,
					startBlock,
					explorerBaseUrl: definition.explorerBaseUrl,
					nativeSymbol: definition.nativeSymbol,
					confirmationDepth: BigInt(definition.confirmationDepth),
					contracts: await parseManifest(definition.manifest),
				} satisfies NetworkConfig
			}),
	)
	if (networks.length === 0) throw new Error('NETWORKS did not select a configured network')
	return networks
}

export const runtimeConfig = {
	port: requirePositiveInteger(process.env['PORT'] ?? '3000', 'PORT'),
	pollIntervalMs: requirePositiveInteger(process.env['POLL_INTERVAL_MS'] ?? '12000', 'POLL_INTERVAL_MS'),
	blockBatchSize: requirePositiveInteger(process.env['BLOCK_BATCH_SIZE'] ?? '20', 'BLOCK_BATCH_SIZE'),
	postgresUrl: process.env['POSTGRES_URL'] ?? 'postgres://augurscan:augurscan@localhost:5432/augurscan',
	disableIndexer: process.env['DISABLE_INDEXER'] === '1',
}
