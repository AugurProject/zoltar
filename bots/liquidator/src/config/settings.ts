import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'

export type CandidatePriority = 'largest-bonus' | 'largest-debt' | 'lowest-top-up'

export type StrategySettings = {
	allowAutomaticDeposits: boolean
	allowAutomaticVaultMigrations: boolean
	allowAutomaticWithdrawals: boolean
	candidatePriority: CandidatePriority
	fallbackRepPerEthPrice: bigint
	maximumGasCostEth: bigint
	maximumLiquidationDebtEth: bigint
	maximumOracleRequestCostEth: bigint
	maximumRepPerPool: bigint
	maximumTotalDeployedRep: bigint
	minimumLiquidationDebtEth: bigint
	minimumRepWithdrawal: bigint
	minimumRewardValueEth: bigint
	redeemFeesAboveEth: bigint
	stalePriceFundingBufferBps: bigint
	stagedOperationValidForSeconds: bigint
	vaultTargetHealthBps: bigint
	vaultTopUpHealthBps: bigint
	vaultWithdrawHealthBps: bigint
	walletRepReserve: bigint
}

export type StoredStrategySettings = {
	[K in keyof StrategySettings]: StrategySettings[K] extends bigint ? string | number : StrategySettings[K]
}

export type OperatorSettings = {
	approvedUniverses: bigint[]
	connectivity: ConnectivitySettings & {
		quorumRpcUrls: string[]
	}
	deployment: {
		securityPoolFactory: Address
		weth: Address
		zoltar: Address
	}
	network: {
		chainId: number
		explorerUrl: string
		name: NetworkName
	}
	paused: boolean
	privateKey: Hex | undefined
	runtime: {
		execute: boolean
		maxVaultsPerPool: number
		once: boolean
		pollMilliseconds: number
		stateFile: string
		ui: boolean
		uiHost: '0.0.0.0' | '127.0.0.1'
		uiPort: number
	}
	selectedPools: Address[]
	strategy: StrategySettings
	submission: SubmissionSettings
	version: 1
}

type JsonRecord = Record<string, unknown>

const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')
const UNIT = 10n ** 18n

function record(value: unknown, label: string): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as JsonRecord
}

function boolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
	return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`)
	return value
}

function string(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
	return value
}

export function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, '0'))
}

export function formatDecimalAmount(value: bigint) {
	const whole = value / UNIT
	const fraction = (value % UNIT).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

function parseNetworkName(value: unknown): NetworkName {
	if (value === 'mainnet' || value === 'sepolia') return value
	throw new Error('network.name must be mainnet or sepolia')
}

function parseCandidatePriority(value: unknown): CandidatePriority {
	if (value === 'largest-bonus' || value === 'largest-debt' || value === 'lowest-top-up') return value
	throw new Error('strategy.candidatePriority is invalid')
}

function universeId(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	const parsed = BigInt(value)
	if (parsed >= 2n ** 248n) throw new Error(`${label} must fit in uint248`)
	return parsed
}

export function parseStrategy(value: unknown): StrategySettings {
	const strategy = record(value, 'strategy')
	const parsed: StrategySettings = {
		allowAutomaticDeposits: boolean(strategy['allowAutomaticDeposits'], 'strategy.allowAutomaticDeposits'),
		allowAutomaticVaultMigrations: boolean(strategy['allowAutomaticVaultMigrations'], 'strategy.allowAutomaticVaultMigrations'),
		allowAutomaticWithdrawals: boolean(strategy['allowAutomaticWithdrawals'], 'strategy.allowAutomaticWithdrawals'),
		candidatePriority: parseCandidatePriority(strategy['candidatePriority']),
		fallbackRepPerEthPrice: parseDecimalAmount(strategy['fallbackRepPerEthPrice'], 'strategy.fallbackRepPerEthPrice'),
		maximumGasCostEth: parseDecimalAmount(strategy['maximumGasCostEth'], 'strategy.maximumGasCostEth'),
		maximumLiquidationDebtEth: parseDecimalAmount(strategy['maximumLiquidationDebtEth'], 'strategy.maximumLiquidationDebtEth'),
		maximumOracleRequestCostEth: parseDecimalAmount(strategy['maximumOracleRequestCostEth'], 'strategy.maximumOracleRequestCostEth'),
		maximumRepPerPool: parseDecimalAmount(strategy['maximumRepPerPool'], 'strategy.maximumRepPerPool'),
		maximumTotalDeployedRep: parseDecimalAmount(strategy['maximumTotalDeployedRep'], 'strategy.maximumTotalDeployedRep'),
		minimumLiquidationDebtEth: parseDecimalAmount(strategy['minimumLiquidationDebtEth'], 'strategy.minimumLiquidationDebtEth'),
		minimumRepWithdrawal: parseDecimalAmount(strategy['minimumRepWithdrawal'], 'strategy.minimumRepWithdrawal'),
		minimumRewardValueEth: parseDecimalAmount(strategy['minimumRewardValueEth'], 'strategy.minimumRewardValueEth'),
		redeemFeesAboveEth: parseDecimalAmount(strategy['redeemFeesAboveEth'], 'strategy.redeemFeesAboveEth'),
		stalePriceFundingBufferBps: BigInt(integer(strategy['stalePriceFundingBufferBps'], 'strategy.stalePriceFundingBufferBps', 10_000, 1_000_000)),
		stagedOperationValidForSeconds: BigInt(integer(strategy['stagedOperationValidForSeconds'], 'strategy.stagedOperationValidForSeconds', 1, 300)),
		vaultTargetHealthBps: BigInt(integer(strategy['vaultTargetHealthBps'], 'strategy.vaultTargetHealthBps', 10_001, 1_000_000)),
		vaultTopUpHealthBps: BigInt(integer(strategy['vaultTopUpHealthBps'], 'strategy.vaultTopUpHealthBps', 10_000, 1_000_000)),
		vaultWithdrawHealthBps: BigInt(integer(strategy['vaultWithdrawHealthBps'], 'strategy.vaultWithdrawHealthBps', 10_001, 1_000_000)),
		walletRepReserve: parseDecimalAmount(strategy['walletRepReserve'], 'strategy.walletRepReserve'),
	}
	if (parsed.minimumLiquidationDebtEth > parsed.maximumLiquidationDebtEth) throw new Error('Minimum liquidation debt cannot exceed the maximum')
	if (parsed.vaultTopUpHealthBps > parsed.vaultTargetHealthBps) throw new Error('Top-up health must not exceed target health')
	if (parsed.vaultTargetHealthBps >= parsed.vaultWithdrawHealthBps) throw new Error('Withdrawal health must exceed target health')
	if (parsed.maximumRepPerPool > parsed.maximumTotalDeployedRep) throw new Error('Per-pool REP limit cannot exceed the total deployed REP limit')
	return parsed
}

export function parseSettings(value: unknown): OperatorSettings {
	const root = record(value, 'operator settings')
	if (root['version'] !== 1) throw new Error('operator settings version must be 1')
	const deployment = record(root['deployment'], 'deployment')
	const network = record(root['network'], 'network')
	const runtime = record(root['runtime'], 'runtime')
	const connectivity = record(root['connectivity'], 'connectivity')
	const parsedConnectivity = validateConnectivitySettings({
		publicRpcUrls: connectivity['publicRpcUrls'],
		readRpcUrl: connectivity['readRpcUrl'],
	})
	const rawQuorumRpcUrls = connectivity['quorumRpcUrls']
	if (!Array.isArray(rawQuorumRpcUrls) || rawQuorumRpcUrls.some(value => typeof value !== 'string')) throw new Error('connectivity.quorumRpcUrls must be an array of RPC URLs')
	const quorumRpcUrls = validateIndependentReadRpcUrls(
		parsedConnectivity.readRpcUrl,
		rawQuorumRpcUrls.map(value => {
			if (typeof value !== 'string') throw new Error('connectivity.quorumRpcUrls must contain only strings')
			return value
		}),
	)
	const selectedPools = root['selectedPools']
	if (!Array.isArray(selectedPools)) throw new Error('selectedPools must be an array')
	const approvedUniverses = root['approvedUniverses']
	if (!Array.isArray(approvedUniverses)) throw new Error('approvedUniverses must be an array')
	const parsedApprovedUniverses = [...new Set(approvedUniverses.map(value => universeId(value, 'approved universe')))]
	const parsedSelectedPools = [
		...new Map(
			selectedPools.map(value => {
				const address = getAddress(string(value, 'selected pool'))
				return [address.toLowerCase(), address] as const
			}),
		).values(),
	]
	const privateKey = signerCandidate(root['privateKey']).privateKey
	const settings: OperatorSettings = {
		approvedUniverses: parsedApprovedUniverses,
		connectivity: {
			...parsedConnectivity,
			quorumRpcUrls,
		},
		deployment: {
			securityPoolFactory: getAddress(string(deployment['securityPoolFactory'], 'deployment.securityPoolFactory')),
			weth: getAddress(string(deployment['weth'], 'deployment.weth')),
			zoltar: getAddress(string(deployment['zoltar'], 'deployment.zoltar')),
		},
		network: {
			chainId: integer(network['chainId'], 'network.chainId', 1, 2 ** 31 - 1),
			explorerUrl: string(network['explorerUrl'], 'network.explorerUrl'),
			name: parseNetworkName(network['name']),
		},
		paused: boolean(root['paused'], 'paused'),
		privateKey,
		runtime: {
			execute: boolean(runtime['execute'], 'runtime.execute'),
			maxVaultsPerPool: integer(runtime['maxVaultsPerPool'], 'runtime.maxVaultsPerPool', 1, 100_000),
			once: boolean(runtime['once'], 'runtime.once'),
			pollMilliseconds: integer(runtime['pollMilliseconds'], 'runtime.pollMilliseconds', 1_000, 3_600_000),
			stateFile: resolve(string(runtime['stateFile'], 'runtime.stateFile')),
			ui: boolean(runtime['ui'], 'runtime.ui'),
			uiHost:
				runtime['uiHost'] === '0.0.0.0'
					? '0.0.0.0'
					: runtime['uiHost'] === '127.0.0.1'
						? '127.0.0.1'
						: (() => {
								throw new Error('runtime.uiHost must be 127.0.0.1 or 0.0.0.0')
							})(),
			uiPort: integer(runtime['uiPort'], 'runtime.uiPort', 1, 65_535),
		},
		selectedPools: parsedSelectedPools,
		strategy: parseStrategy(root['strategy']),
		submission: validateSubmissionSettings(root['submission']),
		version: 1,
	}
	if (settings.runtime.execute && settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
	if (settings.runtime.execute && settings.connectivity.quorumRpcUrls.length === 0) throw new Error('Live execution requires at least one independent quorum RPC')
	if (settings.submission.mode === 'public' && settings.submission.minimumRelaySuccesses > settings.connectivity.publicRpcUrls.length) {
		throw new Error('Public submission minimumRelaySuccesses cannot exceed the configured public RPC count')
	}
	if (settings.runtime.execute && settings.deployment.securityPoolFactory === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed security-pool factory')
	if (settings.runtime.execute && settings.deployment.weth === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed WETH contract')
	if (settings.runtime.execute && settings.deployment.zoltar === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed Zoltar contract')
	return settings
}

export function serializedSettings(settings: OperatorSettings, redactPrivateKey = false) {
	return {
		approvedUniverses: settings.approvedUniverses.map(value => value.toString()),
		connectivity: {
			...settings.connectivity,
		},
		deployment: settings.deployment,
		network: settings.network,
		paused: settings.paused,
		privateKey: redactPrivateKey || settings.privateKey === undefined ? null : settings.privateKey,
		runtime: settings.runtime,
		selectedPools: settings.selectedPools,
		strategy: {
			...settings.strategy,
			fallbackRepPerEthPrice: formatDecimalAmount(settings.strategy.fallbackRepPerEthPrice),
			maximumGasCostEth: formatDecimalAmount(settings.strategy.maximumGasCostEth),
			maximumLiquidationDebtEth: formatDecimalAmount(settings.strategy.maximumLiquidationDebtEth),
			maximumOracleRequestCostEth: formatDecimalAmount(settings.strategy.maximumOracleRequestCostEth),
			maximumRepPerPool: formatDecimalAmount(settings.strategy.maximumRepPerPool),
			maximumTotalDeployedRep: formatDecimalAmount(settings.strategy.maximumTotalDeployedRep),
			minimumLiquidationDebtEth: formatDecimalAmount(settings.strategy.minimumLiquidationDebtEth),
			minimumRepWithdrawal: formatDecimalAmount(settings.strategy.minimumRepWithdrawal),
			minimumRewardValueEth: formatDecimalAmount(settings.strategy.minimumRewardValueEth),
			redeemFeesAboveEth: formatDecimalAmount(settings.strategy.redeemFeesAboveEth),
			stalePriceFundingBufferBps: Number(settings.strategy.stalePriceFundingBufferBps),
			stagedOperationValidForSeconds: Number(settings.strategy.stagedOperationValidForSeconds),
			vaultTargetHealthBps: Number(settings.strategy.vaultTargetHealthBps),
			vaultTopUpHealthBps: Number(settings.strategy.vaultTopUpHealthBps),
			vaultWithdrawHealthBps: Number(settings.strategy.vaultWithdrawHealthBps),
			walletRepReserve: formatDecimalAmount(settings.strategy.walletRepReserve),
		},
		submission: settings.submission,
		version: 1,
	}
}

function revision(contents: string) {
	return createHash('sha256').update(contents).digest('hex')
}

export async function loadSettings(path = resolve(process.env['ZOLTAR_LIQUIDATOR_CONFIG'] ?? defaultSettingsPath)) {
	const contents = await readFile(path, 'utf8').catch(error => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	})
	if (contents === undefined) throw new Error(`Missing liquidator configuration at ${path}. Copy config/operator.example.json there and edit it.`)
	return { path, revision: revision(contents), settings: parseSettings(JSON.parse(contents)) }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision: string) {
	const contents = `${JSON.stringify(serializedSettings(settings), undefined, 2)}\n`
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	const current = await readFile(path, 'utf8')
	if (revision(current) !== expectedRevision) throw new Error('Configuration changed on disk; reload before saving')
	const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
	const handle = await open(temporaryPath, 'wx', 0o600)
	try {
		await handle.writeFile(contents, { encoding: 'utf8' })
		await handle.sync()
		await handle.close()
		await rename(temporaryPath, path)
	} catch (error) {
		await handle.close().catch(() => undefined)
		await rm(temporaryPath, { force: true })
		throw error
	}
	return revision(contents)
}
