import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { acquireExecutionSignerLock, acquireFileProcessLock } from '@zoltar/bot-shared/execution/process-lock'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { assertDurableDeploymentFactory, assertDurableStateFactories } from '../config/deployment-state.ts'
import { executionProfileId } from '../config/execution-profile.ts'
import { assertSettingsProfileIsolation, saveSettings, type OperatorSettings } from '../config/settings.ts'
import { initialDurableState, initialRuntimeState } from '../state/initial-state.ts'
import { loadRuntimeState, saveDurableState, type RuntimeState } from '../state/operator-state.ts'
import { isPristineBootstrapState } from '../state/pristine.ts'
import type { ChaosProcessLocks, ConfigurationState } from './dashboard-controller.ts'
import { assertSettingsUpdatePaused, assertSignerCompatibleWithPending, restartSafeSettings, signerAddress } from './configuration-candidates.ts'
import { ConfigurationCommitIndeterminate, latchSafetyPause, safelyPausedSettings } from './configuration-commit.ts'
import { assertDurableSignerScope } from './operator-context.ts'

export type RestartConfiguration = ConfigurationState

type RestartOptions = {
	configuration: ConfigurationState
	locks: ChaosProcessLocks
	state: RuntimeState
	saveConfiguration?: typeof saveSettings | undefined
	saveState?: ((path: string, state: RuntimeState) => Promise<void>) | undefined
	loopbackPublished?: boolean | undefined
}

async function exists(path: string) {
	try {
		await lstat(path)
		return true
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return false
		throw error
	}
}

/** Save a paused configuration for the next operator run without repointing the current run's state or locks. */
export async function prepareConfigurationRestart(options: RestartOptions, requested: OperatorSettings, rememberSigner: boolean): Promise<RestartConfiguration> {
	const { configuration, state, locks } = options
	const persistConfiguration = options.saveConfiguration ?? saveSettings
	const persistState = options.saveState ?? saveDurableState
	assertSettingsUpdatePaused(configuration.settings, state.paused)
	const address = signerAddress(requested)
	const identityChanged =
		requested.network.chainId !== state.chainId ||
		executionProfileId(requested) !== state.profileId ||
		requested.deployment.uniswapV3Factory?.toLowerCase() !== state.uniswapV3Factory?.toLowerCase() ||
		(address !== undefined && state.signerAddress !== undefined && address.toLowerCase() !== state.signerAddress.toLowerCase())
	const requestedStateChange = resolve(requested.runtime.stateFile) !== resolve(configuration.settings.runtime.stateFile)
	if ((identityChanged || requestedStateChange) && state.pendingTransactions.length !== 0) throw new Error('Resolve pending transaction recovery before switching the signer, chain, deployment, or state file')
	assertSignerCompatibleWithPending(state.pendingTransactions[0]?.sender, address)
	let next = safelyPausedSettings(requested)
	if (identityChanged && resolve(next.runtime.stateFile) === resolve(configuration.settings.runtime.stateFile)) {
		next = { ...next, runtime: { ...next.runtime, stateFile: join(dirname(next.runtime.stateFile), `chaos.${randomUUID()}.json`) } }
	}
	if (options.loopbackPublished) {
		const stateRelative = relative(resolve('.state'), next.runtime.stateFile)
		if (stateRelative === '' || stateRelative.startsWith('..')) throw new Error('Container state files must remain inside the protected .state directory')
	}
	if (next.runtime.ui && next.runtime.uiHost === '0.0.0.0' && options.loopbackPublished !== true) throw new Error('Bind the chaos dashboard to 127.0.0.1 unless its container port is published only on host loopback')
	await assertSettingsProfileIsolation(configuration.path, next)
	const stateChanged = resolve(next.runtime.stateFile) !== resolve(configuration.settings.runtime.stateFile)
	const nextStateLock = stateChanged ? await acquireFileProcessLock(next.runtime.stateFile, 'chaos bot replacement state') : undefined
	let releaseSigner: (() => Promise<void>) | undefined
	try {
		if (next.network.chainId !== configuration.settings.network.chainId) {
			if (address !== undefined) {
				const lock = await acquireExecutionSignerLock(next.network.chainId, address, 'chaos bot')
				releaseSigner = lock.release
			}
		} else {
			const lock = await locks.acquireSigner(address)
			releaseSigner = () => locks.discardSigner(address, lock)
		}
		let nextState = state
		if (stateChanged) {
			const existing = await exists(next.runtime.stateFile)
			if (!existing) {
				for (const suffix of ['.protocol-index-v1', '.immutable-topology-v1']) {
					if (await exists(`${next.runtime.stateFile}${suffix}`)) throw new Error('A new state file cannot reuse existing companion stores')
				}
				nextState = initialRuntimeState(true, address, next.network.chainId, initialDurableState(next.network.chainId, true, executionProfileId(next), address))
				nextState.uniswapV3Factory = next.deployment.uniswapV3Factory
			} else {
				nextState = await loadRuntimeState(next.runtime.stateFile, true, address, next.network.chainId)
			}
			assertDurableStateFactories(next, nextState)
			assertDurableSignerScope(nextState, address, next.runtime.stateFile)
			if (!isPristineBootstrapState(nextState)) {
				if (nextState.profileId !== executionProfileId(next)) throw new Error('Selected state file belongs to another deployment')
				assertDurableDeploymentFactory(next, nextState, next.runtime.stateFile)
			}
			const id = createHash('sha256').update(`${configuration.settings.runtime.stateFile}:${randomUUID()}`).digest('hex')
			await saveSettings(`${configuration.path}.retired-${id}.json`, restartSafeSettings(safelyPausedSettings(configuration.settings), configuration.rememberSigner))
			await persistState(next.runtime.stateFile, nextState)
		}
	} finally {
		try {
			await releaseSigner?.()
		} finally {
			await nextStateLock?.release()
		}
	}
	await persistState(configuration.settings.runtime.stateFile, state)
	const persisted = restartSafeSettings(next, rememberSigner)
	let revision: string
	try {
		revision = await persistConfiguration(configuration.path, persisted, configuration.revision)
	} catch (error) {
		latchSafetyPause(state)
		try {
			await persistState(configuration.settings.runtime.stateFile, state)
		} catch (stateError) {
			throw new ConfigurationCommitIndeterminate(new AggregateError([error, stateError], 'Configuration save and safety checkpoint both failed'))
		}
		throw new ConfigurationCommitIndeterminate(error)
	}
	return { path: configuration.path, revision, settings: next, rememberSigner }
}
