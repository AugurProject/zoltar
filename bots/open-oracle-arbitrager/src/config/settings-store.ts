import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getAddress, type Address, type Hex } from '#ethereum'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '#monitoring/connectivity'
import { decimalWeth, parseDecimalWeth, updateStrategyFromRequest, type MutableStrategy, type StrategySettings } from '#state/operator-state'
import { signerCandidate } from '#config/signer'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
import type { RiskLimits } from '#core/safety-controls'
import { parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { configuredQuorumRpcUrlMinimum, rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export const PRESERVE_PRIVATE_KEY = '__PRESERVE_SAVED_PRIVATE_KEY__'
export const CONFIGURATION_REVISION_CONFLICT = 'ConfigurationRevisionConflict'

export type RuntimeSettings = {
	execute: boolean
	historyFile: string
	lookbackBlocks: bigint
	maxHedgeSlippageBps: bigint
	once: boolean
	positionFile: string
	priceHistoryFile: string
	riskLimits: RiskLimits
	ui: boolean
	uiHost: '0.0.0.0' | '127.0.0.1'
	uiPort: number
}

export type PersistedOperatorSettings = {
	centralizedMarkets: CentralizedMarketSettings
	connectivity: ConnectivitySettings
	deployment: DeploymentSettings
	network: NetworkName
	networkConfigured: boolean
	paused: boolean
	privateKey: Hex | undefined
	runtime: RuntimeSettings
	strategy: MutableStrategy
	submission: SubmissionSettings
	tokenAddresses: readonly Address[]
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

function defaultCentralizedMarkets(assetAddress: `0x${string}`, assetChainId: number) {
	return {
		assetAddress,
		assetChainId,
		assetSymbol: 'REP',
		depthBps: 500,
		maximumDexDeviationBps: 1_000,
		maximumObservationAgeMilliseconds: 30_000,
		maximumVenueDispersionBps: 500,
		minimumAskDepthEth: '0',
		minimumBidDepthEth: '0',
		minimumSourceCount: 1,
		orderBookLimit: 20,
		requestTimeoutMilliseconds: 5_000,
		requiredForExecution: false,
		sources: [],
	}
}

type StoredRuntimeSettings = Omit<RuntimeSettings, 'lookbackBlocks' | 'maxHedgeSlippageBps' | 'riskLimits'> & {
	lookbackBlocks: string
	maxHedgeSlippageBps: string
	riskLimits: {
		lifecycleGasReserveWeth: string
		maxConcurrentPositions: number
		maxDailyGasSpendWeth: string
		maxPositionNotionalWeth: string
		maxTotalLockedWeth: string
	}
}

export type StoredOperatorSettings = {
	centralizedMarkets: ReturnType<typeof serializeCentralizedMarketSettings>
	connectivity?: ConnectivitySettings | undefined
	deployment: DeploymentSettings
	network?: NetworkName | undefined
	paused: boolean
	privateKey?: Hex | typeof PRESERVE_PRIVATE_KEY | undefined
	runtime: StoredRuntimeSettings
	strategy: StrategySettings
	submission: SubmissionSettings
	tokenAddresses: readonly Address[]
	version: 4
}

function requiredRecord(value: unknown, name = 'Operator configuration') {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be a JSON object`)
	return value as Record<string, unknown>
}

function validatedKeys(record: Record<string, unknown>) {
	const allowed = new Set(['centralizedMarkets', 'connectivity', 'deployment', 'network', 'paused', 'privateKey', 'runtime', 'strategy', 'submission', 'tokenAddresses', 'version'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Unknown operator configuration field: ${key}`)
	}
	for (const key of ['deployment', 'paused', 'runtime', 'strategy', 'submission', 'tokenAddresses', 'version']) {
		if (!(key in record)) throw new Error(`Operator configuration is missing ${key}`)
	}
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum.toString()} to ${maximum.toString()}`)
	return value
}

function nonnegativeBigInt(value: unknown, name: string) {
	if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${name} must be a nonnegative integer string`)
	return BigInt(value)
}

function weth(value: unknown, name: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${name} must be a nonnegative decimal WETH string with at most 18 decimal places`)
	return parseDecimalWeth(value)
}

function filePath(value: unknown, name: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty path`)
	return value
}

function validateRuntimeSettings(value: unknown): RuntimeSettings {
	const runtime = requiredRecord(value, 'Runtime settings')
	const keys = ['execute', 'historyFile', 'lookbackBlocks', 'maxHedgeSlippageBps', 'once', 'positionFile', 'priceHistoryFile', 'riskLimits', 'ui', 'uiHost', 'uiPort']
	if (Object.keys(runtime).some(key => !keys.includes(key)) || keys.some(key => !(key in runtime))) throw new Error('Runtime settings require exactly the supported runtime fields')
	if (typeof runtime['execute'] !== 'boolean' || typeof runtime['once'] !== 'boolean' || typeof runtime['ui'] !== 'boolean') throw new Error('Runtime execute, once, and ui settings must be booleans')
	if (runtime['uiHost'] !== '127.0.0.1' && runtime['uiHost'] !== '0.0.0.0') throw new Error('Runtime uiHost must be 127.0.0.1 or 0.0.0.0')
	const risk = requiredRecord(runtime['riskLimits'], 'Runtime risk limits')
	const riskKeys = ['lifecycleGasReserveWeth', 'maxConcurrentPositions', 'maxDailyGasSpendWeth', 'maxPositionNotionalWeth', 'maxTotalLockedWeth']
	if (Object.keys(risk).some(key => !riskKeys.includes(key)) || riskKeys.some(key => !(key in risk))) throw new Error('Runtime risk limits require exactly the supported risk fields')
	const maxPositionNotionalAttoWeth = weth(risk['maxPositionNotionalWeth'], 'Runtime maxPositionNotionalWeth')
	const maxTotalLockedAttoWeth = weth(risk['maxTotalLockedWeth'], 'Runtime maxTotalLockedWeth')
	if (maxPositionNotionalAttoWeth > maxTotalLockedAttoWeth) throw new Error('Runtime maxPositionNotionalAttoWeth cannot exceed maxTotalLockedAttoWeth')
	const maxHedgeSlippageBps = nonnegativeBigInt(runtime['maxHedgeSlippageBps'], 'Runtime maxHedgeSlippageBps')
	if (maxHedgeSlippageBps > 1_000n) throw new Error('Runtime maxHedgeSlippageBps must be from 0 to 1000')
	if (runtime['once'] && runtime['ui']) throw new Error('Runtime once and ui cannot both be enabled')
	const historyFile = filePath(runtime['historyFile'], 'Runtime historyFile')
	const positionFile = filePath(runtime['positionFile'], 'Runtime positionFile')
	const priceHistoryFile = filePath(runtime['priceHistoryFile'], 'Runtime priceHistoryFile')
	const persistentPaths = [historyFile, positionFile, priceHistoryFile].map(path => resolve(path))
	if (new Set(persistentPaths).size !== persistentPaths.length) throw new Error('Runtime historyFile, positionFile, and priceHistoryFile must use distinct paths')
	return {
		execute: runtime['execute'],
		historyFile,
		lookbackBlocks: nonnegativeBigInt(runtime['lookbackBlocks'], 'Runtime lookbackBlocks'),
		maxHedgeSlippageBps,
		once: runtime['once'],
		positionFile,
		priceHistoryFile,
		riskLimits: {
			lifecycleGasReserveAttoWeth: weth(risk['lifecycleGasReserveWeth'], 'Runtime lifecycleGasReserveWeth'),
			maxConcurrentPositions: integer(risk['maxConcurrentPositions'], 'Runtime maxConcurrentPositions', 1, 1_000),
			maxDailyGasSpendAttoWeth: weth(risk['maxDailyGasSpendWeth'], 'Runtime maxDailyGasSpendWeth'),
			maxPositionNotionalAttoWeth,
			maxTotalLockedAttoWeth,
		},
		ui: runtime['ui'],
		uiHost: runtime['uiHost'],
		uiPort: integer(runtime['uiPort'], 'Runtime uiPort', 1, 65_535),
	}
}

export function parseOperatorSettings(value: unknown, preservedPrivateKey?: Hex): PersistedOperatorSettings {
	rpcQuorumRequirement()
	const record = requiredRecord(value)
	validatedKeys(record)
	if (record['version'] !== 4) throw new Error('Operator configuration uses an unsupported version; expected version 4')
	const networkConfigured = record['network'] !== undefined || record['connectivity'] !== undefined
	if ((record['network'] === undefined) !== (record['connectivity'] === undefined)) throw new Error('Operator configuration must set network and connectivity together')
	if (networkConfigured && record['network'] !== 'mainnet' && record['network'] !== 'sepolia') throw new Error('Operator configuration network must be mainnet or sepolia')
	if (typeof record['paused'] !== 'boolean') throw new Error('Operator pause setting must be a boolean')
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 0n,
		minimumProfitBps: 0n,
		minimumProfitAttoWeth: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		pollMilliseconds: 1_000,
		twapSeconds: 60,
	}
	updateStrategyFromRequest(strategy, record['strategy'])
	const privateKeyValue = record['privateKey'] === PRESERVE_PRIVATE_KEY ? preservedPrivateKey : record['privateKey']
	const candidate = signerCandidate(privateKeyValue ?? null)
	if (!Array.isArray(record['tokenAddresses']) || record['tokenAddresses'].some(address => typeof address !== 'string')) throw new Error('Operator tokenAddresses must be an array of addresses')
	const deployment = validateDeploymentSettings(record['deployment'])
	const connectivity = networkConfigured ? validateConnectivitySettings(record['connectivity']) : { publicRpcUrls: [], readRpcUrl: 'http://127.0.0.1:1' }
	validateIndependentReadRpcUrls(connectivity.readRpcUrl, deployment.quorumRpcUrls)
	const network = record['network'] === 'sepolia' ? 'sepolia' : 'mainnet'
	const chainId = network === 'mainnet' ? 1 : 11_155_111
	const centralizedMarkets = parseCentralizedMarketSettings(record['centralizedMarkets'] ?? defaultCentralizedMarkets(deployment.rep, chainId))
	if (centralizedMarkets.assetAddress.toLowerCase() !== deployment.rep.toLowerCase() || centralizedMarkets.assetChainId !== chainId) throw new Error('Centralized market configuration must target the configured REP deployment and chain')
	const submission = validateSubmissionSettings(record['submission'])
	const runtime = validateRuntimeSettings(record['runtime'])
	if (!networkConfigured && (!record['paused'] || runtime.execute)) throw new Error('An unconfigured network requires paused dry-run mode')
	if (runtime.execute && deployment.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum()) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
	return {
		centralizedMarkets,
		connectivity,
		deployment,
		network,
		networkConfigured,
		paused: record['paused'],
		privateKey: candidate.privateKey,
		runtime,
		strategy,
		submission,
		tokenAddresses: record['tokenAddresses'].map(address => getAddress(String(address))),
	}
}

export function serializeOperatorSettings(settings: PersistedOperatorSettings, redactPrivateKey = false): StoredOperatorSettings {
	return {
		centralizedMarkets: serializeCentralizedMarketSettings(settings.centralizedMarkets),
		connectivity: settings.networkConfigured ? settings.connectivity : undefined,
		deployment: settings.deployment,
		network: settings.networkConfigured ? settings.network : undefined,
		paused: settings.paused,
		privateKey: redactPrivateKey && settings.privateKey !== undefined ? PRESERVE_PRIVATE_KEY : settings.privateKey,
		runtime: {
			execute: settings.runtime.execute,
			historyFile: settings.runtime.historyFile,
			lookbackBlocks: settings.runtime.lookbackBlocks.toString(),
			maxHedgeSlippageBps: settings.runtime.maxHedgeSlippageBps.toString(),
			once: settings.runtime.once,
			positionFile: settings.runtime.positionFile,
			priceHistoryFile: settings.runtime.priceHistoryFile,
			riskLimits: {
				lifecycleGasReserveWeth: decimalWeth(settings.runtime.riskLimits.lifecycleGasReserveAttoWeth),
				maxConcurrentPositions: settings.runtime.riskLimits.maxConcurrentPositions,
				maxDailyGasSpendWeth: decimalWeth(settings.runtime.riskLimits.maxDailyGasSpendAttoWeth),
				maxPositionNotionalWeth: decimalWeth(settings.runtime.riskLimits.maxPositionNotionalAttoWeth),
				maxTotalLockedWeth: decimalWeth(settings.runtime.riskLimits.maxTotalLockedAttoWeth),
			},
			ui: settings.runtime.ui,
			uiHost: settings.runtime.uiHost,
			uiPort: settings.runtime.uiPort,
		},
		strategy: {
			maxSpotTwapTicks: settings.strategy.maxSpotTwapTicks.toString(),
			minimumProfitBps: settings.strategy.minimumProfitBps.toString(),
			minimumProfitWeth: decimalWeth(settings.strategy.minimumProfitAttoWeth),
			minimumRemainingBlocks: settings.strategy.minimumRemainingBlocks.toString(),
			minimumRemainingSeconds: settings.strategy.minimumRemainingSeconds.toString(),
			pollMilliseconds: settings.strategy.pollMilliseconds,
			twapSeconds: settings.strategy.twapSeconds,
		},
		submission: settings.submission,
		tokenAddresses: settings.tokenAddresses,
		version: 4,
	}
}

function revision(contents: string) {
	return `sha256:${createHash('sha256').update(contents).digest('hex')}`
}

export async function loadOperatorSettingsWithRevision(path: string, filesystem: OperatorSettingsFilesystem = operatorSettingsFilesystem): Promise<{ revision: string; settings: PersistedOperatorSettings } | undefined> {
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
		if (error instanceof SyntaxError) throw new Error(`Operator configuration is not valid JSON: ${error.message}`)
		throw error
	}
	return { revision: revision(contents), settings: parseOperatorSettings(value) }
}

export async function loadOperatorSettings(path: string, filesystem: OperatorSettingsFilesystem = operatorSettingsFilesystem): Promise<PersistedOperatorSettings | undefined> {
	return (await loadOperatorSettingsWithRevision(path, filesystem))?.settings
}

export function configurationRevisionConflict() {
	const error = new Error('The operator configuration changed after this editor loaded. Reload it, review the newer values, and apply your change again.')
	error.name = CONFIGURATION_REVISION_CONFLICT
	return error
}

export async function saveOperatorSettings(path: string, settings: PersistedOperatorSettings, filesystem: OperatorSettingsFilesystem = operatorSettingsFilesystem, expectedRevision?: string) {
	const stored = serializeOperatorSettings(settings)
	const contents = `${JSON.stringify(stored, undefined, 2)}\n`
	const savedRevision = revision(contents)
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const fileHandle = await filesystem.open(temporaryPath, 'wx', 0o600)
		try {
			await fileHandle.writeFile(contents, { encoding: 'utf8' })
			await fileHandle.chmod(0o600)
			await fileHandle.sync()
		} finally {
			await fileHandle.close()
		}
		if (expectedRevision !== undefined) {
			let currentContents: string
			try {
				currentContents = await filesystem.readFile(path, 'utf8')
			} catch (error) {
				if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') throw configurationRevisionConflict()
				throw error
			}
			if (revision(currentContents) !== expectedRevision) throw configurationRevisionConflict()
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
	return savedRevision
}
