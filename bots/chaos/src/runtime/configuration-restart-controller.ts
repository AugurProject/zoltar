import { serializedSettings, type OperatorSettings } from '../config/settings.ts'
import type { DashboardControllerOptions, ConfigurationState } from './dashboard-controller.ts'
import { completeSettingsCandidate, editableSettings } from './complete-settings.ts'
import { assertSettingsUpdatePaused, preflightConnectivityUpdate, signerAddress } from './configuration-candidates.ts'
import { acquireConfigurationGate } from './configuration-commit.ts'
import { expectedRevision } from './dashboard-input.ts'
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
