import { resolve } from 'node:path'
import { loadSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import type { DashboardControllerOptions, ConfigurationState } from './dashboard-controller.ts'
import { completeSettingsCandidate, editableSettings } from './complete-settings.ts'
import { assertSettingsUpdatePaused, preflightConnectivityUpdate, signerAddress } from './configuration-candidates.ts'
import { acquireConfigurationGate } from './configuration-commit.ts'
import { dashboardDeploymentArchives, deploymentArchivePath } from './deployment-archives.ts'
import { dashboardRecord, exactDashboardKeys, expectedRevision } from './dashboard-input.ts'
import { loadDurableState } from '../state/operator-state.ts'
import { assertDurableStateFactories } from '../config/deployment-state.ts'
import { executionProfileId } from '../config/execution-profile.ts'
import { prepareConfigurationRestart } from './configuration-restart.ts'

export function dashboardConfiguration(configuration: ConfigurationState) {
	return {
		hasSigner: configuration.settings.privateKey !== undefined,
		rememberSigner: configuration.rememberSigner,
		revision: configuration.revision,
		settings: serializedSettings(configuration.settings, true),
		wallet: signerAddress(configuration.settings),
	}
}

/** Share one mutation gate and restart latch across all configuration controls. */
export function createConfigurationRestartController(options: DashboardControllerOptions) {
	let restarting = false
	const update = async <T>(operation: () => Promise<T>) => {
		if (restarting) throw new Error('Configuration restart is in progress; wait for the dashboard to reconnect')
		acquireConfigurationGate(options.gate)
		try {
			return await operation()
		} finally {
			options.gate.release('configuration')
		}
	}
	const restart = async (settings: OperatorSettings, rememberSigner: boolean) => {
		if (options.onRestartRequested === undefined) throw new Error('This launcher does not support configuration restarts')
		const next = await prepareConfigurationRestart(options, settings, rememberSigner)
		restarting = true
		options.onRestartRequested(next)
	}
	return {
		update,
		getDeploymentArchives: () => dashboardDeploymentArchives(options.configuration.path),
		async setDeploymentArchive(value: unknown) {
			await update(async () => {
				if (options.onRestartRequested === undefined) throw new Error('This launcher does not support configuration restarts')
				const body = dashboardRecord(value, 'Deployment archive selection')
				exactDashboardKeys(body, ['id', 'revision', 'archiveRevision', 'confirmation'], 'Deployment archive selection')
				expectedRevision(body['revision'], options.configuration.revision)
				assertSettingsUpdatePaused(options.configuration.settings, options.state.paused)
				const id = body['id']
				if (typeof id !== 'string') throw new Error('Select a deployment archive')
				if (body['confirmation'] !== `OPEN RECOVERY ${id}`) throw new Error('Deployment recovery confirmation does not match')
				const target = await loadSettings(deploymentArchivePath(options.configuration.path, id))
				if (resolve(target.path) === resolve(options.configuration.path)) throw new Error('This deployment is already selected')
				if (resolve(target.settings.runtime.stateFile) === resolve(options.configuration.settings.runtime.stateFile)) throw new Error('Deployment recovery must use a different state file')
				expectedRevision(body['archiveRevision'], target.revision)
				const durable = await loadDurableState(target.settings.runtime.stateFile, target.settings.network.chainId)
				assertDurableStateFactories(target.settings, durable)
				if (durable.profileId !== executionProfileId(target.settings)) throw new Error('Archived configuration does not match its durable deployment profile')
				const current = options.configuration.settings
				const settings = {
					...target.settings,
					privateKey: target.settings.privateKey ?? current.privateKey,
					runtime: { ...target.settings.runtime, once: current.runtime.once, ui: current.runtime.ui, uiHost: current.runtime.uiHost, uiPort: current.runtime.uiPort },
				}
				if (settings.networkConfigured) await (options.checkConnectivityUpdate ?? preflightConnectivityUpdate)(settings)
				const next = await prepareConfigurationRestart(options, settings, target.settings.privateKey !== undefined, target)
				restarting = true
				options.onRestartRequested(next)
			})
		},
		restart,
		getConfigurationDocument: () => ({ revision: options.configuration.revision, settings: editableSettings(options.configuration.settings) }),
		async setConfigurationDocument(value: unknown) {
			await update(async () => {
				const candidate = completeSettingsCandidate(options.configuration.settings, value)
				expectedRevision(candidate.revision, options.configuration.revision)
				assertSettingsUpdatePaused(options.configuration.settings, options.state.paused)
				if (candidate.settings.networkConfigured) await (options.checkConnectivityUpdate ?? preflightConnectivityUpdate)(candidate.settings)
				await restart(candidate.settings, options.configuration.rememberSigner)
			})
		},
	}
}
