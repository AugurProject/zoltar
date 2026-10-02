import { renderDisconnectedHeader, setAttentionBadge } from '@zoltar/bot-shared/dashboard/components'
import type { Snapshot } from './api-validation.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { DashboardState } from './dashboard-state.ts'
import { readinessGuidance } from './readiness-status.ts'

type NoticeTone = 'error' | 'info' | 'warning'

const NETWORK_LABELS = new Map<string | undefined, string>([
	['mainnet', 'Mainnet'],
	['sepolia', 'Sepolia'],
])

function runStatusLabel(snapshot: Snapshot) {
	if (snapshot.status === 'connectivity-degraded') return 'Connectivity degraded'
	if (snapshot.error !== undefined) return 'Error'
	if (snapshot.paused) return 'Paused'
	if (snapshot.scanning) return 'Scanning'
	return snapshot.deploymentMissingName !== undefined ? 'Waiting' : 'Running'
}

function scanFailureDetail(error: string) {
	const logRange = /fromBlock (\d+) · toBlock (\d+)/i.exec(error)
	if (logRange !== null) return `Log scan failed for fromBlock ${logRange[1]} through toBlock ${logRange[2]}.`
	const normalized = error.toLowerCase()
	if (normalized.includes('rpc')) return 'RPC connectivity or chain reads failed.'
	if (normalized.includes('market') || normalized.includes('price')) return 'Market evidence or price validation failed.'
	if (normalized.includes('persist') || normalized.includes('state')) return 'Durable operator state could not be saved.'
	if (normalized.includes('signer') || normalized.includes('wallet')) return 'Signer or wallet access failed.'
	if (normalized.includes('chain') || normalized.includes('block')) return 'Canonical chain data validation failed.'
	return 'The latest scan cycle returned an unexpected error.'
}

function recoveryWorkCount(snapshot: Snapshot) {
	return snapshot.pendingTransactions.length + snapshot.pendingStagedOperations.length
}

/** Renders the operator header badges and the overview's global notice from the latest snapshot and configuration. */
export function createHeaderView(state: DashboardState, elements: DashboardElements) {
	function networkSetupRequired() {
		return state.configurationConnected && state.configuration?.networkConfigured !== true
	}

	function snapshotDetailedAttentionCount(snapshot: Snapshot) {
		return (networkSetupRequired() ? 1 : 0) + Math.max(recoveryWorkCount(snapshot), snapshot.alerts.length) + (snapshot.error === undefined ? 0 : 1)
	}

	function capabilityBlockerGuidance(snapshot: Snapshot) {
		return readinessGuidance(snapshot, snapshotDetailedAttentionCount(snapshot) > 0)
	}

	function globalErrorPresentation(snapshot: Snapshot): { message: string | undefined; title: string; tone: NoticeTone } {
		if (snapshot.error === undefined) {
			const guidance = capabilityBlockerGuidance(snapshot)
			return { message: guidance?.message, title: guidance?.title ?? 'Operator blocked', tone: guidance?.pending === true ? 'info' : 'warning' }
		}
		const message = snapshot.status === 'connectivity-degraded' ? 'RPC connectivity is degraded. Execution is blocked and the bot will retry automatically.' : `${scanFailureDetail(snapshot.error)} Automatic retry is active. Check the bot logs if the next cycle also fails.`
		return { message, title: 'Scan failed', tone: 'error' }
	}

	function setGlobalError(message?: string, title = 'Dashboard unavailable', tone: NoticeTone = 'error') {
		const globalError = elements.globalError
		if (message === undefined) {
			if (!globalError.classList.contains('hidden')) globalError.classList.add('hidden')
			if (globalError.childNodes.length > 0) globalError.replaceChildren()
			delete globalError.dataset['noticeKey']
			return
		}
		const noticeKey = `${tone}\n${title}\n${message}`
		if (globalError.dataset['noticeKey'] === noticeKey && !globalError.classList.contains('hidden')) return
		globalError.setAttribute('role', tone === 'info' ? 'status' : 'alert')
		globalError.classList.toggle('error', tone === 'error')
		globalError.classList.toggle('warning', tone === 'warning')
		globalError.dataset['noticeKey'] = noticeKey
		if (globalError.classList.contains('hidden')) globalError.classList.remove('hidden')
		const heading = document.createElement('strong')
		heading.textContent = title
		const copy = document.createElement('p')
		copy.textContent = message
		globalError.replaceChildren(heading, copy)
	}

	function renderAttention(snapshot: Snapshot) {
		const attentionCount = Math.max(snapshotDetailedAttentionCount(snapshot), snapshot.operatorCapable === false ? 1 : 0)
		let attentionTarget = '/overview#global-error'
		if (networkSetupRequired()) attentionTarget = '/settings#network-connectivity'
		else if (recoveryWorkCount(snapshot) > 0) attentionTarget = '/operations#recovery'
		else if (snapshot.error !== undefined) attentionTarget = '/overview#global-error'
		else if (snapshot.alerts.length > 0) attentionTarget = '/operations'
		setAttentionBadge(elements.attentionBadge, attentionCount, attentionTarget)
		if (capabilityBlockerGuidance(snapshot)?.pending === true) {
			elements.attentionBadge.textContent = capabilityBlockerGuidance(snapshot)?.label ?? 'Awaiting first scan'
			if (snapshot.deploymentMissingName === undefined) elements.attentionBadge.removeAttribute('href')
		}
	}

	function networkFailureLabel(retainedSnapshot: boolean) {
		const network = state.configuration?.network
		if (network === undefined) return 'Network unavailable'
		const networkLabel = network.name === 'mainnet' ? 'Mainnet' : 'Sepolia'
		return `${networkLabel} · chain ${network.chainId.toString()} · ${retainedSnapshot ? 'last known' : 'unverified'}`
	}

	function renderNetworkBadge() {
		const networkBadge = elements.networkBadge
		const configuration = state.configuration
		if (!state.stateConnected) {
			networkBadge.textContent = networkFailureLabel(state.snapshot !== undefined)
			networkBadge.className = 'badge warning'
			return
		}
		if (!state.configurationConnected) {
			networkBadge.textContent = 'Network unavailable'
			networkBadge.className = 'badge warning'
			return
		}
		if (configuration?.network === undefined || configuration.networkConfigured !== true) {
			const networkLabel = NETWORK_LABELS.get(configuration?.network?.name)
			networkBadge.textContent = networkLabel === undefined ? 'Choose chain' : `${networkLabel} · RPC setup required`
			networkBadge.className = 'badge warning'
			return
		}
		const networkLabel = configuration.network.name === 'mainnet' ? 'Mainnet' : 'Sepolia'
		networkBadge.textContent = `${networkLabel} · chain ${configuration.network.chainId.toString()}`
		networkBadge.className = 'badge'
	}

	/** Renders the mode, run-status, capability, and attention badges from a fresh snapshot. */
	function renderHeader(snapshot: Snapshot) {
		const { modeBadge, runStatusBadge, capabilityBadge } = elements
		modeBadge.textContent = snapshot.execute ? 'Live armed' : 'Dry run'
		modeBadge.className = `badge ${snapshot.execute ? 'warning' : 'info'}`
		runStatusBadge.textContent = runStatusLabel(snapshot)
		if (snapshot.error !== undefined || snapshot.status === 'error') runStatusBadge.className = 'badge error'
		else runStatusBadge.className = `badge ${snapshot.paused || snapshot.status === 'connectivity-degraded' ? 'warning' : 'success'}`
		capabilityBadge.hidden = snapshot.operatorCapable
		capabilityBadge.textContent = snapshot.operatorCapable ? '' : 'Operator blocked'
		capabilityBadge.className = `badge ${snapshot.operatorCapable ? 'success' : 'warning'}`
		renderAttention(snapshot)
	}

	function renderGlobalNotice(snapshot: Snapshot) {
		const presentation = globalErrorPresentation(snapshot)
		setGlobalError(presentation.message, presentation.title, presentation.tone)
	}

	/** Marks the header disconnected after a failed state poll, keeping what the last snapshot showed. */
	function renderDisconnected(snapshot: Snapshot | undefined, reason: 'incompatible' | 'unreachable' = 'unreachable') {
		const message =
			reason === 'incompatible' ? 'The bot answered with state this dashboard cannot read. Reload the page to load the dashboard version that matches the running bot; automatic retry stays active.' : 'State polling failed. Automatic retry is active; use the next successful poll before making an execution decision.'
		let lastKnownModeLabel: string | undefined
		if (snapshot !== undefined) lastKnownModeLabel = snapshot.execute ? 'Live armed' : 'Dry run'
		renderDisconnectedHeader({
			attentionBadge: elements.attentionBadge,
			attentionTarget: '/overview#global-error',
			capabilityBadge: elements.capabilityBadge,
			capabilityBadgeClassName: 'badge warning',
			lastKnownModeLabel,
			modeBadge: elements.modeBadge,
			modeBadgeClassName: 'badge warning',
			retainedAttentionCount: snapshot === undefined ? 0 : Math.max(recoveryWorkCount(snapshot), snapshot.alerts.length),
			runStatusBadge: elements.runStatusBadge,
			runStatusBadgeClassName: 'badge warning',
			showNotice: title => setGlobalError(message, title),
		})
	}

	return { renderHeader, renderAttention, renderNetworkBadge, renderGlobalNotice, renderDisconnected }
}

export type HeaderView = ReturnType<typeof createHeaderView>
