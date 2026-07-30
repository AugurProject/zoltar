import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAddress, type Address, type Hex } from '#ethereum'
import { validateConnectivitySettings, type ConnectivitySettings, type NetworkName } from '#monitoring/connectivity'
import { decimalWeth, updateStrategyFromRequest, type MutableStrategy, type StrategySettings } from '#state/operator-state'
import { signerCandidate } from '#config/signer'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'

export type PersistedOperatorSettings = {
	connectivity: ConnectivitySettings
	deployment?: DeploymentSettings | undefined
	paused: boolean
	privateKey: Hex | undefined
	strategy: MutableStrategy
	submission: SubmissionSettings
	tokenAddresses?: readonly Address[]
}

type OperatorSettingsFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type OperatorSettingsFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<OperatorSettingsFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

const operatorSettingsFilesystem: OperatorSettingsFilesystem = {
	mkdir,
	open,
	readFile,
	rename,
	rm,
}

type StoredOperatorSettings = {
	connectivity: ConnectivitySettings
	deployment?: DeploymentSettings | undefined
	network: NetworkName
	paused: boolean
	privateKey?: Hex | undefined
	strategy: StrategySettings
	submission: SubmissionSettings
	tokenAddresses: readonly Address[]
	version: 3
}

function requiredRecord(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Saved operator settings must be a JSON object')
	return value as Record<string, unknown>
}

function validatedKeys(record: Record<string, unknown>) {
	const allowed = new Set(['connectivity', 'deployment', 'network', 'paused', 'privateKey', 'strategy', 'submission', 'tokenAddresses', 'version'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Unknown saved operator setting: ${key}`)
	}
	for (const key of ['connectivity', 'network', 'paused', 'strategy', 'submission', 'version']) {
		if (!(key in record)) throw new Error(`Saved operator settings are missing ${key}`)
	}
}

export async function loadOperatorSettings(path: string, expectedNetwork: NetworkName, filesystem: OperatorSettingsFilesystem = operatorSettingsFilesystem): Promise<PersistedOperatorSettings | undefined> {
	let contents: string
	try {
		contents = await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	}
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Saved operator settings are not valid JSON: ${error.message}`)
		throw error
	}
	const record = requiredRecord(value)
	validatedKeys(record)
	if (record['version'] !== 1 && record['version'] !== 2 && record['version'] !== 3) throw new Error('Saved operator settings use an unsupported version')
	if (record['network'] !== expectedNetwork) throw new Error(`Saved operator settings are for ${String(record['network'])}, not ${expectedNetwork}`)
	if (typeof record['paused'] !== 'boolean') throw new Error('Saved pause setting must be a boolean')
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 0n,
		minimumProfitBps: 0n,
		minimumProfitWeth: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		pollMilliseconds: 1_000,
		twapSeconds: 60,
	}
	updateStrategyFromRequest(strategy, record['strategy'])
	const candidate = signerCandidate(record['privateKey'] ?? null)
	return {
		connectivity: validateConnectivitySettings(record['connectivity']),
		deployment: record['deployment'] === undefined ? undefined : validateDeploymentSettings(record['deployment']),
		paused: record['paused'],
		privateKey: candidate.privateKey,
		strategy,
		submission: validateSubmissionSettings(record['submission']),
		tokenAddresses:
			record['tokenAddresses'] === undefined
				? []
				: (() => {
						if (!Array.isArray(record['tokenAddresses']) || record['tokenAddresses'].some(value => typeof value !== 'string')) throw new Error('Saved token addresses must be an array of addresses')
						return record['tokenAddresses'].map(value => getAddress(String(value)))
					})(),
	}
}

export async function saveOperatorSettings(path: string, network: NetworkName, settings: PersistedOperatorSettings, filesystem: OperatorSettingsFilesystem = operatorSettingsFilesystem) {
	const stored: StoredOperatorSettings = {
		connectivity: settings.connectivity,
		deployment: settings.deployment,
		network,
		paused: settings.paused,
		privateKey: settings.privateKey,
		strategy: {
			maxSpotTwapTicks: settings.strategy.maxSpotTwapTicks.toString(),
			minimumProfitBps: settings.strategy.minimumProfitBps.toString(),
			minimumProfitWeth: decimalWeth(settings.strategy.minimumProfitWeth),
			minimumRemainingBlocks: settings.strategy.minimumRemainingBlocks.toString(),
			minimumRemainingSeconds: settings.strategy.minimumRemainingSeconds.toString(),
			pollMilliseconds: settings.strategy.pollMilliseconds,
			twapSeconds: settings.strategy.twapSeconds,
		},
		submission: settings.submission,
		tokenAddresses: settings.tokenAddresses ?? [],
		version: 3,
	}
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const fileHandle = await filesystem.open(temporaryPath, 'wx', 0o600)
		try {
			await fileHandle.writeFile(`${JSON.stringify(stored, undefined, 2)}\n`, { encoding: 'utf8' })
			await fileHandle.chmod(0o600)
			await fileHandle.sync()
		} finally {
			await fileHandle.close()
		}
		await filesystem.rename(temporaryPath, path)
		const directoryHandle = await filesystem.open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
}
