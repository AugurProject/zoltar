import type { PublicOperatorSnapshot } from '#state/operator-state'
import { shorten } from './dom.js'

/** The facts an operator confirms before resuming live execution, in the order the preflight dialog lists them. */
export function resumePreflightRows(snapshot: PublicOperatorSnapshot): readonly (readonly [string, string])[] {
	const recoveryCount = snapshot.positions.filter(position => position.status === 'recovery-required').length
	const uncertainTransactions = snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
	const selectedOpportunities = snapshot.opportunities.filter(opportunity => opportunity.decision === 'selected' || opportunity.decision === 'eligible').length
	return [
		['Mode', 'Live execution'],
		['Network', snapshot.networkConfigured ? `${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Not configured'],
		['Execution signer', snapshot.wallet === undefined ? 'Missing' : shorten(snapshot.wallet)],
		['Executor deployment', snapshot.executorDeploymentRecovery === undefined ? 'No pending recovery' : 'Recovery required · run Deploy predictable executor in Settings'],
		['Recovery-required positions', recoveryCount.toString()],
		['Unknown confirmations', uncertainTransactions.toString()],
		['Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'],
		['Eligible opportunities now', selectedOpportunities.toString()],
		['Submission', snapshot.submission.mode === 'private' ? `${snapshot.submission.minimumBundleRelaySuccesses.toString()} private relay confirmations` : 'Public mempool'],
	]
}
