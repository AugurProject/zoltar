import { recordActivity } from '#state/operator-state'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import type { LiquidatorDeps, LiquidatorRuntime } from './liquidator-runtime.ts'

/**
 * Validates the configured chain, read, quorum, and submission endpoints before the first scan. A safety failure stops
 * the dashboard and aborts startup; any other failure is recorded as degraded connectivity for the scan loop to retry.
 */
export async function checkStartupConnectivity(runtime: LiquidatorRuntime, deps: LiquidatorDeps, dashboard: { stop: () => unknown } | undefined) {
	const { state } = deps
	try {
		if (!runtime.settings.networkConfigured) {
			recordActivity(state, { details: 'Set the chain and RPC endpoints in the dashboard', kind: 'configuration', message: 'Liquidator waiting for network configuration', status: 'info' })
		} else {
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
	} catch (error) {
		if (operationalFailureDisposition(error) === 'safety-paused') {
			dashboard?.stop()
			throw error
		}
		state.error = errorMessage(error)
		state.status = 'connectivity-degraded'
		recordActivity(state, { details: state.error, kind: 'error', message: 'Startup connectivity is degraded; retrying in the background', status: 'failed' })
	}
}
