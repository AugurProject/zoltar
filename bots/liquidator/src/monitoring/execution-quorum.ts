import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError, operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'

export function availableExecutionObservations<T, V>(label: string, settled: readonly PromiseSettledResult<T>[], observation: (value: T) => { endpoint: string; value: V }) {
	const safetyFailure = settled.find(result => result.status === 'rejected' && operationalFailureDisposition(result.reason) === 'safety-paused')
	if (safetyFailure?.status === 'rejected') throw safetyFailure.reason
	const available = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
	if (available.length < 2) {
		const failures = settled.flatMap(result => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []))
		throw new ConnectivityDegradedError(`${label} requires at least two available independent RPC endpoints${failures.length === 0 ? '' : `: ${failures.join('; ')}`}`)
	}
	quorumValue(label, available.map(observation))
	return available
}
