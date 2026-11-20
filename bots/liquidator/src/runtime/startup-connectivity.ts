import { recordActivity, type RuntimeState } from '#state/operator-state'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import type { LiquidatorRuntime } from './liquidator-runtime.ts'

type ConnectivityRuntime = { client: Pick<LiquidatorRuntime['client'], 'getChainId'>; settings: Pick<LiquidatorRuntime['settings'], 'connectivity' | 'network' | 'networkConfigured' | 'submission'> }

/** Checks that the read RPC, every public and quorum RPC, and the submission endpoints answer for the configured chain. */
async function verifyConfiguredConnectivity(runtime: ConnectivityRuntime) {
	const actualChainId = await runtime.client.getChainId()
	if (actualChainId !== runtime.settings.network.chainId) {
		throw new Error(`Read RPC chain ${actualChainId.toString()} does not match configured chain ${runtime.settings.network.chainId.toString()}`)
	}
	await checkConnectivity(runtime.settings.connectivity, runtime.settings.network.chainId)
	for (const rpcUrl of runtime.settings.connectivity.quorumRpcUrls) {
		const chainId = await readRpcChainId(rpcUrl)
		if (chainId !== runtime.settings.network.chainId) {
			throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
		}
	}
	await checkSubmissionEndpoints(runtime.settings.submission, runtime.settings.network.chainId)
}

/**
 * Validates the configured chain, read, quorum, and submission endpoints before the first scan. A safety failure stops
 * the dashboard and aborts startup; any other failure is recorded as degraded connectivity and returns `true`, and the
 * scan loop repeats the whole check through `recheckStartupConnectivity` until it passes.
 */
export async function checkStartupConnectivity(runtime: ConnectivityRuntime, deps: { state: RuntimeState }, dashboard: { stop: () => unknown } | undefined) {
	const { state } = deps
	try {
		if (!runtime.settings.networkConfigured) {
			recordActivity(state, { details: 'Set the chain and RPC endpoints in the dashboard', kind: 'configuration', message: 'Liquidator waiting for network configuration', status: 'info' })
		} else {
			await verifyConfiguredConnectivity(runtime)
		}
		return false
	} catch (error) {
		if (operationalFailureDisposition(error) === 'safety-paused') {
			dashboard?.stop()
			throw error
		}
		state.error = errorMessage(error)
		state.status = 'connectivity-degraded'
		recordActivity(state, { details: state.error, kind: 'error', message: 'Startup connectivity is degraded; retrying in the background', status: 'failed' })
		return true
	}
}

/** Repeats a failed startup connectivity check before a scan; it throws, failing that cycle, until every endpoint passes. */
export async function recheckStartupConnectivity(runtime: ConnectivityRuntime & Pick<LiquidatorRuntime, 'startupConnectivityPending'>) {
	if (!runtime.startupConnectivityPending || !runtime.settings.networkConfigured) return
	await verifyConfiguredConnectivity(runtime)
	runtime.startupConnectivityPending = false
}
