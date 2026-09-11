import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { missingContractDeployment } from '../../../shared/src/monitoring/deployed-contracts.ts'
import { errorMessage } from '#core/rpc-validation'
import { recordOperation, type OperatorState, type MarketAvailabilityNotice } from '#state/operator-state'

function marketAvailabilityFromError(error: unknown): MarketAvailabilityNotice | undefined {
	const missing = missingContractDeployment(error)
	return missing === undefined ? undefined : { kind: 'missing-deployment', ...missing }
}

export function logMarketDiscoveryFailure(context: string, error: unknown) {
	if (missingContractDeployment(error) !== undefined) return
	console.error(`${context}${errorMessage(error)}`)
}

export function recordMarketDiscoveryFailure(state: OperatorState, error: unknown) {
	const message = errorMessage(error)
	const previousAvailability = state.marketAvailability
	state.marketAvailability = marketAvailabilityFromError(error)
	// Absent deployments are dashboard notices, not per-poll errors, but the first detection still reaches the process log.
	if (state.marketAvailability?.kind === 'missing-deployment' && JSON.stringify(previousAvailability) !== JSON.stringify(state.marketAvailability)) console.log(`deploymentUnavailable=${message}`)
	state.lastError = message
	state.lastPollFailureAt = new Date().toISOString()
	state.retryInProgress = false
	state.status = operationalFailureDisposition(error) === 'connectivity-degraded' ? 'connectivity-degraded' : 'error'
	recordOperation(state, {
		category: 'scan',
		details: undefined,
		level: state.marketAvailability === undefined ? 'error' : 'info',
		message: state.marketAvailability === undefined ? 'Scan failed' : 'Deployment unavailable',
		reason: message,
		reportId: undefined,
	})
	logMarketDiscoveryFailure('pollFailed=', error)
}

export function recordObservedHead(state: Pick<OperatorState, 'blockNumber' | 'blockTimestamp'>, block: { number: bigint; timestamp: bigint }) {
	state.blockNumber = block.number.toString()
	state.blockTimestamp = block.timestamp.toString()
}
