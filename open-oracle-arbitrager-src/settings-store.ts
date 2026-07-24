import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Hex } from '@zoltar/shared/ethereum'
import { validateConnectivitySettings, type ConnectivitySettings, type NetworkName } from './connectivity.js'
import { decimalWeth, updateStrategyFromRequest, type MutableStrategy, type StrategySettings } from './operator-state.js'
import { signerCandidate } from './signer.js'
import { validateSubmissionSettings, type SubmissionSettings } from './transaction-submission.js'

export type PersistedOperatorSettings = {
	connectivity: ConnectivitySettings
	paused: boolean
	privateKey: Hex | undefined
	strategy: MutableStrategy
	submission: SubmissionSettings
}

type StoredOperatorSettings = {
	connectivity: ConnectivitySettings
	network: NetworkName
	paused: boolean
	privateKey?: Hex | undefined
	strategy: StrategySettings
	submission: SubmissionSettings
	version: 1
}

function requiredRecord(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Saved operator settings must be a JSON object')
	return value as Record<string, unknown>
}

function validatedKeys(record: Record<string, unknown>) {
	const allowed = new Set(['connectivity', 'network', 'paused', 'privateKey', 'strategy', 'submission', 'version'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Unknown saved operator setting: ${key}`)
	}
	for (const key of ['connectivity', 'network', 'paused', 'strategy', 'submission', 'version']) {
		if (!(key in record)) throw new Error(`Saved operator settings are missing ${key}`)
	}
}

export async function loadOperatorSettings(path: string, expectedNetwork: NetworkName): Promise<PersistedOperatorSettings | undefined> {
	let contents: string
	try {
		contents = await readFile(path, 'utf8')
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
	if (record['version'] !== 1) throw new Error('Saved operator settings use an unsupported version')
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
		paused: record['paused'],
		privateKey: candidate.privateKey,
		strategy,
		submission: validateSubmissionSettings(record['submission']),
	}
}

export async function saveOperatorSettings(path: string, network: NetworkName, settings: PersistedOperatorSettings) {
	const stored: StoredOperatorSettings = {
		connectivity: settings.connectivity,
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
		version: 1,
	}
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		await writeFile(temporaryPath, `${JSON.stringify(stored, undefined, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
		await chmod(temporaryPath, 0o600)
		await rename(temporaryPath, path)
	} catch (error) {
		await rm(temporaryPath, { force: true })
		throw error
	}
}
