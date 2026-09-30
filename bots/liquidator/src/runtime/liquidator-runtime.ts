import type { OperatorSettings } from '#config/settings'
import { saveSettings, type loadSettings } from '#config/settings-store'
import { createConfigurationMutationGate } from '#core/configuration-gate'
import { createSystemDeploymentGate } from '#core/deployment-gate'
import { createSettingsUpdateQueue } from '#core/settings-update-queue'
import { setExecutionShutdownCheck } from '#execution/execution-safety'
import { chainFor } from '#monitoring/operator-chain'
import { createPoolMonitorIndex } from '#monitoring/vault-positions'
import { initialRuntimeState, loadDurableState, type RuntimeState } from '#state/operator-state'
import { createPoolDeploymentDateCache } from '../monitoring/pool-deployment-date.ts'
import { readBotEnvironment, type DashboardEnvironment } from '@zoltar/bot-shared/config/environment'
import { createPublicClient, createRpcEndpointPool, createWalletClient, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import type { BotProcessLocks, BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'

export type LoadedSettings = Awaited<ReturnType<typeof loadSettings>>
type OperatorChain = ReturnType<typeof chainFor>
type ReadPool = ReturnType<typeof createRpcEndpointPool>
type PoolMonitorIndex = ReturnType<typeof createPoolMonitorIndex>

function primaryClientFor(chain: OperatorChain, readPool: ReadPool) {
	return createPublicClient({ chain, transport: readPool.transport })
}

/** The wallet client for `privateKey` on the given chain, sending through the shared read pool. */
export function signerWalletFor(privateKey: Hex, chain: OperatorChain, readPool: ReadPool) {
	return createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: readPool.transport })
}

type LiquidatorClient = ReturnType<typeof primaryClientFor>
type LiquidatorWallet = ReturnType<typeof signerWalletFor>

/**
 * The mutable operator state one `runOperator` run shares between the dashboard handlers and the scan loop. Every
 * collaborator reads these fields at the moment it acts, so a saved configuration change reaches the next read.
 */
export type LiquidatorRuntime = {
	activePrivateKey: Hex | undefined
	chain: OperatorChain
	client: LiquidatorClient
	lastDryRunKey: string | undefined
	missingDeploymentAddress: string | undefined
	poolMonitorIndexes: Map<string, PoolMonitorIndex>
	profileSwitchRequested: boolean
	readPool: ReadPool
	settings: OperatorSettings
	settingsRevision: LoadedSettings['revision']
	wakeProfileSwitchWait: (() => void) | undefined
	wallet: LiquidatorWallet | undefined
}

/** The fixed collaborators of one operator run; none of these are replaced while it runs. */
export type LiquidatorDeps = {
	/** `SCAN_BLOCK_TIME_MS`, read once when the operator starts. */
	blockTimeOverrideMs: number | undefined
	checkSystemDeployment: ReturnType<typeof createSystemDeploymentGate>
	configurationMutationGate: ReturnType<typeof createConfigurationMutationGate>
	dashboardEnvironment: DashboardEnvironment
	poolDeploymentDates: ReturnType<typeof createPoolDeploymentDateCache>
	preflightNetworkProfile: (target: OperatorSettings) => Promise<void>
	processLocks: BotProcessLocks
	queueSettingsUpdate: ReturnType<typeof createSettingsUpdateQueue>
	settingsPath: string
	shutdown: BotShutdownController
	state: RuntimeState
}

type OperatorCollaborators = Pick<LiquidatorDeps, 'preflightNetworkProfile' | 'processLocks' | 'shutdown'>

export function createPrimaryClient(runtime: Pick<LiquidatorRuntime, 'chain' | 'readPool'>) {
	return primaryClientFor(runtime.chain, runtime.readPool)
}

export function createReadPool(settings: OperatorSettings) {
	return createRpcEndpointPool(readEndpoints(settings))
}

/** The primary read RPC followed by every quorum RPC. */
export function readEndpoints(settings: OperatorSettings) {
	return [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
}

/** Builds the runtime from the loaded settings, reads the operator environment once, and restores durable state. */
export async function createLiquidatorRuntime(loaded: LoadedSettings, collaborators: OperatorCollaborators) {
	const environment = readBotEnvironment()
	const settings = loaded.settings
	const activePrivateKey = settings.privateKey
	const queueSettingsUpdate = createSettingsUpdateQueue()
	const chain = chainFor(settings)
	const readPool = createReadPool(settings)
	const runtime: LiquidatorRuntime = {
		activePrivateKey,
		chain,
		client: primaryClientFor(chain, readPool),
		lastDryRunKey: undefined,
		missingDeploymentAddress: undefined,
		poolMonitorIndexes: new Map(),
		profileSwitchRequested: false,
		readPool,
		settings,
		settingsRevision: loaded.revision,
		wakeProfileSwitchWait: undefined,
		wallet: activePrivateKey === undefined ? undefined : signerWalletFor(activePrivateKey, chain, readPool),
	}
	const state = initialRuntimeState(settings.paused, runtime.wallet?.account.address, settings.network.chainId)
	setExecutionShutdownCheck(state, collaborators.shutdown.isRequested)
	const durable = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
	state.activities = durable.activities
	state.lastScannedBlock = durable.lastScannedBlock === undefined ? undefined : BigInt(durable.lastScannedBlock)
	state.pendingStagedOperations = durable.pendingStagedOperations
	state.pendingTransactions = durable.pendingTransactions
	const deps: LiquidatorDeps = {
		...collaborators,
		blockTimeOverrideMs: environment.scanBlockTimeMs,
		dashboardEnvironment: environment.dashboard,
		checkSystemDeployment: createSystemDeploymentGate(),
		configurationMutationGate: createConfigurationMutationGate(
			() => state.scanning,
			() => runtime.profileSwitchRequested,
		),
		poolDeploymentDates: createPoolDeploymentDateCache(),
		queueSettingsUpdate,
		settingsPath: loaded.path,
		state,
	}
	return { deps, runtime }
}

/** Saves `update(current settings)` in queue order, then installs it as the running settings and revision. */
export async function persistSettings(runtime: LiquidatorRuntime, deps: LiquidatorDeps, update: (current: OperatorSettings) => OperatorSettings) {
	return await deps.queueSettingsUpdate(async () => {
		const next = update(runtime.settings)
		runtime.settingsRevision = await saveSettings(deps.settingsPath, next, runtime.settingsRevision)
		runtime.settings = next
		return next
	})
}

export function poolMonitorIndexFor(runtime: LiquidatorRuntime, endpoint: string) {
	const key = `${runtime.settings.network.chainId.toString()}:${runtime.settings.deployment.securityPoolFactory.toLowerCase()}:${endpoint}`
	const existing = runtime.poolMonitorIndexes.get(key)
	if (existing !== undefined) return existing
	const created = createPoolMonitorIndex()
	runtime.poolMonitorIndexes.set(key, created)
	return created
}

export function requestProfileSwitch(runtime: LiquidatorRuntime) {
	runtime.profileSwitchRequested = true
	runtime.wakeProfileSwitchWait?.()
}

/** Waits out the retry delay, returning early on shutdown or a requested chain profile switch. */
export async function waitForProfileSwitchOrDelay(runtime: LiquidatorRuntime, deps: LiquidatorDeps, milliseconds: number) {
	if (runtime.profileSwitchRequested) return
	const delay = deps.shutdown.wait(milliseconds)
	const profileSwitch = new Promise<void>(resolve => {
		runtime.wakeProfileSwitchWait = resolve
	})
	if (runtime.profileSwitchRequested) runtime.wakeProfileSwitchWait?.()
	await Promise.race([delay, profileSwitch])
	runtime.wakeProfileSwitchWait = undefined
}
