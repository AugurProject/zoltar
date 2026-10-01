import type { PublicOperatorSnapshot } from '#state/operator-state'
import { renderDisconnectedHeader, setAttentionBadge } from '@zoltar/bot-shared/dashboard/components'
import { renderRepMarketConsensusError } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import { botStatusLabels, pollRetryStatus, statePollingFailureMessage } from './dashboard-format.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { setText } from './dom.ts'

function runStatusKey(snapshot: PublicOperatorSnapshot) {
	if (snapshot.paused) return 'paused'
	return snapshot.status === 'error' && snapshot.marketAvailability?.kind === 'missing-deployment' ? 'syncing' : snapshot.status
}

function runStatusBadgeClass(runStatus: string) {
	if (runStatus === 'running') return ' success'
	return runStatus === 'error' ? ' error' : ' warning'
}

function attentionTarget(networkSetupCount: number, recoveryCount: number, uncertainTransactionCount: number) {
	if (networkSetupCount > 0) return '/settings#network-connectivity'
	if (recoveryCount > 0) return '/operations#position-lifecycle'
	return uncertainTransactionCount > 0 ? '/operations#transaction-tracking' : '/overview#notice'
}

function recoveryCount(snapshot: PublicOperatorSnapshot) {
	return snapshot.positions.filter(position => position.status === 'recovery-required').length
}

function uncertainTransactionCount(snapshot: PublicOperatorSnapshot) {
	return snapshot.transactionActivity.filter(transaction => transaction.status === 'confirmation-unknown').length
}

/** Renders the operator header badges from a fresh snapshot, or from the last known snapshot once polling fails. */
export function createHeaderView(elements: DashboardElements) {
	function renderPollRetry(snapshot: PublicOperatorSnapshot) {
		const badge = elements.retryStatusBadge
		const retry = pollRetryStatus(snapshot)
		badge.parentElement?.toggleAttribute('data-retry-active', retry !== undefined)
		badge.hidden = retry === undefined
		badge.textContent = retry?.label ?? 'Retry —'
		badge.className = `badge ${retry?.state === 'retrying' ? 'error' : 'warning'}`
	}

	function clearPollRetry() {
		const badge = elements.retryStatusBadge
		badge.parentElement?.removeAttribute('data-retry-active')
		badge.hidden = true
		badge.textContent = 'Retry —'
		badge.className = 'badge warning'
	}

	function renderHeader(snapshot: PublicOperatorSnapshot) {
		const { modeBadge, runStatusBadge, capabilityBadge, headerNetworkBadge } = elements
		const statusLabels = botStatusLabels(snapshot)
		modeBadge.className = 'badge'
		modeBadge.dataset['mode'] = snapshot.mode
		modeBadge.textContent = statusLabels.mode
		const runStatus = runStatusKey(snapshot)
		runStatusBadge.dataset['status'] = runStatus
		runStatusBadge.textContent = statusLabels.status
		runStatusBadge.className = `badge${runStatusBadgeClass(runStatus)}`
		capabilityBadge.hidden = snapshot.operatorCapable
		capabilityBadge.textContent = snapshot.operatorCapable ? '' : 'Operator blocked'
		capabilityBadge.className = `badge${snapshot.operatorCapable ? ' success' : ' warning'}`
		renderPollRetry(snapshot)
		headerNetworkBadge.textContent = snapshot.networkConfigured ? `${snapshot.network} · ${snapshot.expectedChainId.toString()}` : 'Network setup'
		headerNetworkBadge.className = `badge${snapshot.networkConfigured ? '' : ' warning'}`
		const recoveries = recoveryCount(snapshot)
		const uncertainTransactions = uncertainTransactionCount(snapshot)
		const networkSetupCount = snapshot.networkConfigured ? 0 : 1
		const detailedAttentionCount = networkSetupCount + recoveries + uncertainTransactions + (snapshot.lastError === undefined ? 0 : 1)
		const attentionCount = Math.max(snapshot.operatorCapable ? 0 : 1, detailedAttentionCount)
		setAttentionBadge(elements.attentionBadge, attentionCount, attentionTarget(networkSetupCount, recoveries, uncertainTransactions))
		setText('status-value', statusLabels.status)
	}

	/** Marks the header disconnected or stale after a failed state poll, keeping what the last snapshot showed. */
	function renderDisconnected(error: unknown, latestSnapshot: PublicOperatorSnapshot | undefined) {
		clearPollRetry()
		const { modeBadge, runStatusBadge, headerNetworkBadge } = elements
		const statusLabels = botStatusLabels(undefined)
		delete modeBadge.dataset['mode']
		runStatusBadge.dataset['status'] = latestSnapshot === undefined ? 'disconnected' : 'stale'
		renderRepMarketConsensusError(document)
		let lastKnownModeLabel: string | undefined
		if (latestSnapshot !== undefined) lastKnownModeLabel = latestSnapshot.mode === 'execute' ? 'Live armed' : 'Dry run'
		renderDisconnectedHeader({
			attentionBadge: elements.attentionBadge,
			attentionTarget: '/overview#notice',
			capabilityBadge: elements.capabilityBadge,
			capabilityBadgeClassName: 'badge warning',
			lastKnownModeLabel,
			modeBadge,
			modeBadgeClassName: 'badge warning',
			retainedAttentionCount: latestSnapshot === undefined ? 0 : recoveryCount(latestSnapshot) + uncertainTransactionCount(latestSnapshot) + (latestSnapshot.networkConfigured ? 0 : 1),
			runStatusBadge,
			runStatusBadgeClassName: 'badge error',
			showNotice: title => {
				setText('notice-title', title)
				setText('notice-copy', statePollingFailureMessage(error))
				elements.notice.dataset['tone'] = 'danger'
			},
		})
		if (latestSnapshot?.networkConfigured === true) headerNetworkBadge.textContent = `${latestSnapshot.network} · ${latestSnapshot.expectedChainId.toString()} · last known`
		else if (latestSnapshot !== undefined) headerNetworkBadge.textContent = 'Network setup · last known'
		else headerNetworkBadge.textContent = 'Network unavailable'
		headerNetworkBadge.className = 'badge warning'
		setText('status-value', latestSnapshot === undefined ? statusLabels.status : 'State stale')
		elements.launchNotice.hidden = true
	}

	return { renderHeader, renderPollRetry, renderDisconnected }
}
