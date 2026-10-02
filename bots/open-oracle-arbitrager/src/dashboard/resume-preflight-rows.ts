import type { PublicOperatorSnapshot } from '#state/operator-state'
import { element, shorten } from './dom.js'

type PreflightRow = readonly [string, string]

/** The signer that will sign after resuming: a queued change replaces the active signer at the next scan boundary. */
function signerRow(snapshot: Pick<PublicOperatorSnapshot, 'queuedSigner' | 'wallet'>) {
	const active = snapshot.wallet === undefined ? 'no active signer' : `active ${shorten(snapshot.wallet)}`
	if (snapshot.queuedSigner?.kind === 'apply') return `${shorten(snapshot.queuedSigner.address)} queued for the next scan · ${active}`
	if (snapshot.queuedSigner?.kind === 'clear') return `Removal queued for the next scan · ${active}`
	return snapshot.wallet === undefined ? 'Missing' : shorten(snapshot.wallet)
}

/**
 * The facts an operator confirms before resuming live execution, in the order the preflight dialog lists them. A stale
 * snapshot says so first, because every later row then describes the last state the dashboard received.
 */
export function resumePreflightRows(snapshot: PublicOperatorSnapshot, stale = false): readonly PreflightRow[] {
	const recoveryCount = snapshot.positions.filter(position => position.status === 'recovery-required').length
	const uncertainTransactions = snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
	const selectedOpportunities = snapshot.opportunities.filter(opportunity => opportunity.decision === 'selected' || opportunity.decision === 'eligible').length
	const staleRows: readonly PreflightRow[] = stale ? [['Dashboard state', 'Stale · Resume stays locked until the next successful update']] : []
	return [
		...staleRows,
		['Mode', 'Live execution'],
		['Network', snapshot.networkConfigured ? `${snapshot.network} · chain ${snapshot.expectedChainId.toString()}` : 'Not configured'],
		['Execution signer', signerRow(snapshot)],
		['Executor deployment', snapshot.executorDeploymentRecovery === undefined ? 'No pending recovery' : 'Recovery required · run Deploy predictable executor in Settings'],
		['Recovery-required positions', recoveryCount.toString()],
		['Unknown confirmations', uncertainTransactions.toString()],
		['Market evidence', snapshot.marketConsensus?.reliable === true ? 'Reliable' : 'Guarded / unavailable'],
		['Eligible opportunities now', selectedOpportunities.toString()],
		['Submission', snapshot.submission.mode === 'private' ? `${snapshot.submission.minimumBundleRelaySuccesses.toString()} private relay confirmations` : 'Public mempool'],
	]
}

/** Rewrites the open readiness check from a newer snapshot, so the dialog never confirms facts older than the last poll. */
export function refreshOpenResumePreflight(snapshot: PublicOperatorSnapshot, stale: boolean) {
	if (!element('resume-dialog').hasAttribute('open')) return
	element('resume-preflight').replaceChildren(
		...resumePreflightRows(snapshot, stale).map(([label, value]) => {
			const item = document.createElement('li')
			const name = document.createElement('span')
			name.textContent = label
			const status = document.createElement('strong')
			status.textContent = value
			item.append(name, status)
			return item
		}),
	)
}
