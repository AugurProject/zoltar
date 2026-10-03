import { isSignerLockConflictMessage } from '@zoltar/bot-shared/dashboard/public-failures'
import type { createRetirementDashboard } from './retirement-dashboard.js'
import { type Workflow } from './workflow-history.js'
import { fullIdentifier, formatDate, node, setBadge } from './dom.js'
import { type Snapshot, type OperationEvaluation, type SubmissionHealth, type RepBalance, type PendingTransaction } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { formatClockDuration, formatRelative, operationIsIndependentlyExecutable, parsePositiveNumber, recoveryItemCount } from './dashboard-format.ts'
import type { DashboardState } from './dashboard-state.ts'
import { formatAtomicAmount } from '@zoltar/bot-shared/dashboard/amount'
import { renderOperatorHealth } from '@zoltar/bot-shared/dashboard/health-panel'
import { element } from '@zoltar/bot-shared/dashboard/dom'

type DashboardHealthViewContext = {
	state: DashboardState
	elements: DashboardElements
	renderWorkflow: (value: Workflow | undefined, pendingTransactions: readonly PendingTransaction[]) => void
	renderWorkflowHistory: (workflows: readonly Workflow[], explorerUrl: string | undefined, paused: boolean) => void
	renderCoverage: (values: OperationEvaluation[]) => void
	retirementDashboard: ReturnType<typeof createRetirementDashboard>
}

export function createDashboardHealthView(context: DashboardHealthViewContext) {
	const { state, elements } = context
	function renderHeader(value: Snapshot) {
		const checkedBlock = value.lastDeploymentCheckedBlock ?? value.lastScannedBlock
		elements.lastBlock.textContent = checkedBlock === undefined ? 'Block —' : `Block ${String(checkedBlock)}`
		renderScanAge()
		if (value.execute === true) setBadge(elements.modeBadge, 'Live armed', 'warning')
		else setBadge(elements.modeBadge, 'Dry run', 'info')
		renderHealth(value)
		const networkName = value.network ?? state.configuration?.network ?? 'Network unknown'
		const chainId = value.chainId ?? state.configuration?.chainId
		setBadge(elements.networkBadge, chainId === undefined ? networkName : `${networkName} · ${String(chainId)}`, value.network === undefined && state.configuration?.network === undefined ? 'warning' : 'neutral')
		const signerConflict = value.alerts.some(alert => isSignerLockConflictMessage(alert.message ?? ''))
		let signerLabel = 'Signer missing'
		if (signerConflict) signerLabel = 'Signer unavailable'
		else if (value.signerReady === true) signerLabel = 'Signer ready'
		else if (value.wallet !== undefined) signerLabel = 'Read-only — signer not loaded'
		setBadge(elements.signerBadge, signerLabel, value.signerReady === true && !signerConflict ? 'success' : 'warning')
		const recoveryItems = recoveryItemCount(value)
		setBadge(elements.recoveryBadge, `${recoveryItems.toString()} recovery item${recoveryItems === 1 ? '' : 's'}`, 'warning')
		elements.recoveryBadge.classList.toggle('hidden', recoveryItems === 0)
		let pauseLabel = value.paused === true ? 'Resume' : 'Pause'
		if (state.pauseMutationPending) pauseLabel = value.paused === true ? 'Resuming…' : 'Pausing…'
		elements.pauseButton.textContent = pauseLabel
		elements.pauseButton.disabled = state.pauseMutationPending || state.pauseMutationUnreconciled || state.configurationCommitIndeterminate
	}

	/** Runs every second as well as on each snapshot, so the age keeps advancing while state refreshes fail. */
	function renderScanAge() {
		const value = state.snapshot
		if (value === undefined) return
		const age = value.lastDeploymentCheckedBlock === undefined ? formatRelative(value.lastScanAt) : formatRelative(value.lastDeploymentCheckAt).replace('Scanned', 'Deployments checked')
		if (elements.lastScan.textContent !== age) elements.lastScan.textContent = age
	}

	function renderHealth(value: Snapshot) {
		renderOperatorHealth(element('operator-health', HTMLDivElement), {
			mode: value.execute === true ? 'Live armed' : 'Dry run',
			lastScanAt: value.lastScanAt,
			capitalAtRisk: state.configuration?.maximumEthPerOperation === undefined ? 'Unavailable' : `Not tracked · limit ${state.configuration.maximumEthPerOperation} ETH per operation`,
			recoveryItems: recoveryItemCount(value),
			lastAction: value.activities[0]?.label ?? value.activities[0]?.summary ?? 'No action yet',
			paused: value.paused === true || value.safetyPaused === true,
			stale: state.snapshotStale,
		})
	}

	function renderOverview(value: Snapshot) {
		elements.nextRun.textContent = formatDate(value.scheduler.nextRunAt)
		const delay = parsePositiveNumber(value.scheduler.lastDelaySeconds)
		elements.lastDelay.textContent = delay === undefined ? '—' : formatClockDuration(delay)
		const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
		const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true)
		elements.eligibleCount.textContent = `${eligible.length.toString()} of ${executable.length.toString()}`
		const selected = value.operationEvaluations.find(operation => operation.id === value.scheduler.selectedOperationId)
		elements.selectedOperation.textContent = selected?.label ?? value.scheduler.selectedOperationId ?? 'None'
		elements.walletShort.replaceChildren(value.wallet === undefined ? document.createTextNode('No execution account configured') : fullIdentifier(value.wallet, 'wallet address'))
		elements.walletShort.removeAttribute('title')
		if (value.wallet !== undefined && value.inventoryAvailable === true) {
			elements.balanceEth.textContent = formatAtomicAmount(value.inventory.eth, 'ETH')
			elements.balanceWeth.textContent = formatAtomicAmount(value.inventory.weth, 'WETH')
			elements.balanceRepTotal.textContent = value.inventory.rep.length === 0 ? '—' : `${value.inventory.rep.length.toString()} token${value.inventory.rep.length === 1 ? '' : 's'}`
			renderRepBalances(value.inventory.rep)
		} else {
			elements.balanceEth.textContent = '—'
			elements.balanceWeth.textContent = '—'
			elements.balanceRepTotal.textContent = '—'
			elements.repBalances.className = 'token-list empty-state'
			elements.repBalances.textContent = value.wallet === undefined ? '—' : 'Inventory unavailable until this account is scanned.'
		}
		renderRpcHealth(value)
		renderSubmissionHealth(value.submissionHealth)
		context.renderWorkflow(value.currentWorkflow, value.pendingTransactions)
		context.renderWorkflowHistory(value.workflows, state.configuration?.explorerUrl, value.paused === true)
		context.renderCoverage(value.operationEvaluations)
		context.retirementDashboard.render(value)
	}

	function renderRpcHealth(value: Snapshot) {
		elements.rpcHealthRetryButton.classList.add('hidden')
		const health = value.rpcHealth
		if (health.status === 'ready') setBadge(elements.rpcHealthStatus, 'Quorum ready', 'success')
		else if (health.status === 'degraded') setBadge(elements.rpcHealthStatus, 'Quorum blocked', 'error')
		else if (health.status === 'not-checked') setBadge(elements.rpcHealthStatus, 'Awaiting health check', 'warning')
		else setBadge(elements.rpcHealthStatus, 'Health unavailable', 'warning')
		const configured = health.configuredReadEndpointCount
		elements.rpcConfiguredTotal.textContent = configured === undefined ? '—' : `${configured.toString()} endpoint${configured === 1 ? '' : 's'}`
		const healthy = health.healthyReadEndpointCount
		if (healthy === undefined) elements.rpcHealthyCount.textContent = '—'
		else elements.rpcHealthyCount.textContent = configured === undefined ? healthy.toString() : `${healthy.toString()} of ${configured.toString()}`
		const quorum = health.requiredReadQuorum
		elements.rpcRequiredQuorum.textContent = quorum === undefined ? '—' : `${quorum.toString()} endpoint${quorum === 1 ? '' : 's'}`
		const chain = value.chainId === undefined ? 'configured chain' : `chain ${String(value.chainId)}`
		if (health.chainReady === true) elements.rpcChainReadiness.textContent = `Ready for ${chain}`
		else if (health.chainReady === false) elements.rpcChainReadiness.textContent = `Not ready for ${chain}`
		else elements.rpcChainReadiness.textContent = 'Not yet verified'
		elements.rpcLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
	}

	function renderUnavailableRpcHealth(previousResultIsStale: boolean) {
		elements.rpcHealthRetryButton.classList.remove('hidden')
		setBadge(elements.rpcHealthStatus, 'Health unavailable', 'warning')
		elements.rpcConfiguredTotal.textContent = '—'
		elements.rpcHealthyCount.textContent = '—'
		elements.rpcRequiredQuorum.textContent = '—'
		elements.rpcChainReadiness.textContent = 'Unavailable until state refresh succeeds'
		elements.rpcLastCheck.textContent = previousResultIsStale ? 'Previous health result is stale' : 'No current health result'
	}

	function renderSubmissionHealth(health: SubmissionHealth) {
		if (health.status === 'ready') setBadge(elements.submissionHealthStatus, 'Path ready', 'success')
		else if (health.status === 'degraded') setBadge(elements.submissionHealthStatus, 'Path blocked', 'error')
		else if (health.status === 'stale') setBadge(elements.submissionHealthStatus, 'Evidence stale', 'warning')
		else if (health.status === 'not-checked') setBadge(elements.submissionHealthStatus, 'Awaiting path check', 'warning')
		else setBadge(elements.submissionHealthStatus, 'Path not configured', 'neutral')
		if (health.mode === 'private') elements.submissionMode.textContent = 'Private relay'
		else if (health.mode === 'public') elements.submissionMode.textContent = 'Public RPC'
		else elements.submissionMode.textContent = '—'
		const configured = health.configuredOriginCount
		const healthy = health.healthyOriginCount
		if (healthy === undefined) elements.submissionHealthyCount.textContent = '—'
		else if (configured === undefined) elements.submissionHealthyCount.textContent = originCount(healthy)
		else elements.submissionHealthyCount.textContent = `${healthy.toString()} of ${configured.toString()} origins`
		elements.submissionRequiredThreshold.textContent = originCount(health.requiredHealthyOriginCount)
		const checked = health.checkedOriginCount
		const fresh = health.freshOriginCount
		elements.submissionFreshness.textContent = checked === undefined || fresh === undefined ? 'Not yet verified' : `${fresh.toString()} fresh of ${checked.toString()} checked`
		if (health.mode !== 'private') elements.submissionSignerProof.textContent = 'Not required'
		else if (health.proofMatchesSigner === true) elements.submissionSignerProof.textContent = 'Matches current signer'
		else if (health.proofMatchesSigner === false) elements.submissionSignerProof.textContent = 'Does not match current signer'
		else elements.submissionSignerProof.textContent = 'Not yet proven'
		elements.submissionLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
	}

	function renderUnavailableSubmissionHealth(previousResultIsStale: boolean) {
		setBadge(elements.submissionHealthStatus, 'Path unavailable', 'warning')
		elements.submissionMode.textContent = '—'
		elements.submissionHealthyCount.textContent = '—'
		elements.submissionRequiredThreshold.textContent = '—'
		elements.submissionFreshness.textContent = previousResultIsStale ? 'Previous readiness is stale' : 'Unavailable until state refresh succeeds'
		elements.submissionSignerProof.textContent = 'Not yet proven'
		elements.submissionLastCheck.textContent = 'No current path result'
	}

	function renderRepBalances(values: RepBalance[]) {
		if (values.length === 0) {
			elements.repBalances.className = 'token-list empty-state'
			elements.repBalances.textContent = 'No REP inventory observed.'
			return
		}
		elements.repBalances.className = 'token-list'
		const rows = values.map(value => {
			const row = node('div', 'token-row')
			const identity = node('div')
			identity.append(node('strong', undefined, value.symbol ?? 'REP'))
			identity.append(node('small', 'mono', value.universeId === undefined ? (value.token ?? '—') : `Universe ${value.universeId}`))
			row.append(identity, node('strong', 'mono', formatAtomicAmount(value.balance, value.symbol ?? 'REP')))
			return row
		})
		elements.repBalances.replaceChildren(...rows)
	}

	function originCount(value: number | undefined) {
		return value === undefined ? '—' : `${value.toString()} origin${value === 1 ? '' : 's'}`
	}
	return { renderHeader, renderHealth, renderOverview, renderScanAge, renderUnavailableRpcHealth, renderUnavailableSubmissionHealth }
}
