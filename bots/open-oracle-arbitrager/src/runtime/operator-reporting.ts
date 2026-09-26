import type { Configuration } from '#config/configuration'
import { recordOperation, type OperatorState } from '#state/operator-state'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'

export function reportOperatorStarted(config: Configuration, state: OperatorState) {
	recordOperation(state, {
		category: 'scan',
		details: config.coordinatorAddresses.length === 0 ? undefined : `Approved coordinators: ${config.coordinatorAddresses.join(', ')}`,
		level: 'info',
		message: config.networkConfigured ? 'Operator started' : 'Operator waiting for network configuration',
		reason: config.networkConfigured ? `${config.network.name} chain ${config.network.chain.id.toString()}` : 'Set the chain and RPC endpoints in the dashboard',
		reportId: undefined,
	})
	console.log(
		config.networkConfigured
			? `network=${config.network.name} chain=${config.network.chain.id.toString()} mode=${config.execute ? 'execute' : 'dry-run'} submission=${config.submission.mode} oracle=${config.openOracle} coordinators=${config.coordinatorAddresses.join(',') || 'none'} rpc=${endpointLabel(config.connectivity.readRpcUrl)}`
			: 'network=unconfigured mode=paused configure the chain and RPC endpoints in the dashboard',
	)
}

export function reportCompletedScan(state: OperatorState, blockNumber: bigint, completedScan: { evaluated: number; skipped: number }, nextError: string | undefined) {
	recordOperation(state, {
		category: 'scan',
		details: `${state.activeReportCount.toString()} active reports; ${completedScan.evaluated.toString()} opportunities; ${completedScan.skipped.toString()} skipped`,
		level: nextError === undefined ? 'info' : 'warning',
		message: 'Scan completed',
		reason: `Block ${blockNumber.toString()}`,
		reportId: undefined,
	})
}
