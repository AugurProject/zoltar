import type { createRetirementDashboard } from './retirement-dashboard.js'
import { type Workflow } from './workflow-history.js'
import { fullIdentifier, formatDate, node, setBadge } from './dom.js'
import { type Snapshot, type Configuration, type OperationEvaluation, type SubmissionHealth, type RepBalance, type PendingTransaction } from './dashboard-data.ts'

type DashboardHealthViewContext = {
	lastBlock: HTMLSpanElement
	lastScan: HTMLSpanElement
	formatRelative: (value: string | undefined) => string
	modeBadge: HTMLSpanElement
	configuration: Configuration | undefined
	networkBadge: HTMLSpanElement
	signerBadge: HTMLSpanElement
	recoveryItemCount: (value: Snapshot) => number
	recoveryBadge: HTMLAnchorElement
	pauseMutationPending: boolean
	pauseButton: HTMLButtonElement
	pauseMutationUnreconciled: boolean
	configurationCommitIndeterminate: boolean
	nextRun: HTMLElement
	parsePositiveNumber: (value: string | number | undefined) => number | undefined
	lastDelay: HTMLElement
	formatDuration: (totalSeconds: number) => string
	operationIsIndependentlyExecutable: (value: OperationEvaluation) => boolean
	eligibleCount: HTMLElement
	selectedOperation: HTMLElement
	walletShort: HTMLSpanElement
	balanceEth: HTMLElement
	balanceWeth: HTMLElement
	balanceRepTotal: HTMLElement
	repBalances: HTMLDivElement
	renderWorkflow: (value: Workflow | undefined, pendingTransactions: readonly PendingTransaction[]) => void
	renderWorkflowHistory: (workflows: readonly Workflow[], explorerUrl: string | undefined, paused: boolean) => void
	renderCoverage: (values: OperationEvaluation[]) => void
	retirementDashboard: ReturnType<typeof createRetirementDashboard>
	rpcHealthRetryButton: HTMLButtonElement
	rpcHealthStatus: HTMLSpanElement
	rpcConfiguredTotal: HTMLElement
	rpcHealthyCount: HTMLElement
	rpcRequiredQuorum: HTMLElement
	rpcChainReadiness: HTMLElement
	rpcLastCheck: HTMLElement
	submissionHealthStatus: HTMLSpanElement
	submissionMode: HTMLElement
	submissionHealthyCount: HTMLElement
	submissionRequiredThreshold: HTMLElement
	submissionFreshness: HTMLElement
	submissionSignerProof: HTMLElement
	submissionLastCheck: HTMLElement
}

export function createDashboardHealthView(context: DashboardHealthViewContext) {
	function renderHeader(value: Snapshot) {
		const checkedBlock = value.lastDeploymentCheckedBlock ?? value.lastScannedBlock
		context.lastBlock.textContent = checkedBlock === undefined ? 'Block —' : `Block ${String(checkedBlock)}`
		context.lastScan.textContent = value.lastDeploymentCheckedBlock === undefined ? context.formatRelative(value.lastScanAt) : context.formatRelative(value.lastDeploymentCheckAt).replace('Scanned', 'Deployments checked')
		if (value.safetyPaused === true) setBadge(context.modeBadge, 'Safety paused', 'error')
		else if (value.paused === true) setBadge(context.modeBadge, 'Paused', 'warning')
		else if (value.execute === true) setBadge(context.modeBadge, 'Live execution', 'warning')
		else setBadge(context.modeBadge, 'Dry run', 'info')
		const networkName = value.network ?? context.configuration?.network ?? 'Network unknown'
		const chainId = value.chainId ?? context.configuration?.chainId
		setBadge(context.networkBadge, chainId === undefined ? networkName : `${networkName} · ${String(chainId)}`, value.network === undefined && context.configuration?.network === undefined ? 'warning' : 'neutral')
		let signerLabel = 'Signer missing'
		if (value.signerReady === true) signerLabel = 'Signer ready'
		else if (value.wallet !== undefined) signerLabel = 'Read-only — signer not loaded'
		setBadge(context.signerBadge, signerLabel, value.signerReady === true ? 'success' : 'warning')
		const recoveryItems = context.recoveryItemCount(value)
		setBadge(context.recoveryBadge, `${recoveryItems.toString()} recovery item${recoveryItems === 1 ? '' : 's'}`, 'warning')
		context.recoveryBadge.classList.toggle('hidden', recoveryItems === 0)
		let pauseLabel = value.paused === true ? 'Resume' : 'Pause'
		if (context.pauseMutationPending) pauseLabel = value.paused === true ? 'Resuming…' : 'Pausing…'
		context.pauseButton.textContent = pauseLabel
		context.pauseButton.disabled = context.pauseMutationPending || context.pauseMutationUnreconciled || context.configurationCommitIndeterminate
	}

	function renderOverview(value: Snapshot) {
		context.nextRun.textContent = formatDate(value.scheduler.nextRunAt)
		const delay = context.parsePositiveNumber(value.scheduler.lastDelaySeconds)
		context.lastDelay.textContent = delay === undefined ? '—' : context.formatDuration(delay)
		const executable = value.operationEvaluations.filter(context.operationIsIndependentlyExecutable)
		const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true)
		context.eligibleCount.textContent = `${eligible.length.toString()} of ${executable.length.toString()}`
		const selected = value.operationEvaluations.find(operation => operation.id === value.scheduler.selectedOperationId)
		context.selectedOperation.textContent = selected?.label ?? value.scheduler.selectedOperationId ?? 'None'
		context.walletShort.replaceChildren(value.wallet === undefined ? document.createTextNode('No execution account configured') : fullIdentifier(value.wallet, 'wallet address'))
		context.walletShort.removeAttribute('title')
		if (value.wallet !== undefined && value.inventoryAvailable === true) {
			context.balanceEth.textContent = formatAtomic18(value.inventory.eth)
			context.balanceWeth.textContent = formatAtomic18(value.inventory.weth)
			context.balanceRepTotal.textContent = value.inventory.rep.length === 0 ? '—' : `${value.inventory.rep.length.toString()} token${value.inventory.rep.length === 1 ? '' : 's'}`
			renderRepBalances(value.inventory.rep)
		} else {
			context.balanceEth.textContent = '—'
			context.balanceWeth.textContent = '—'
			context.balanceRepTotal.textContent = '—'
			context.repBalances.className = 'token-list empty-state'
			context.repBalances.textContent = value.wallet === undefined ? '—' : 'Inventory unavailable until this account is scanned.'
		}
		renderRpcHealth(value)
		renderSubmissionHealth(value.submissionHealth)
		context.renderWorkflow(value.currentWorkflow, value.pendingTransactions)
		context.renderWorkflowHistory(value.workflows, context.configuration?.explorerUrl, value.paused === true)
		context.renderCoverage(value.operationEvaluations)
		context.retirementDashboard.render(value)
	}

	function renderRpcHealth(value: Snapshot) {
		context.rpcHealthRetryButton.classList.add('hidden')
		const health = value.rpcHealth
		if (health.status === 'ready') setBadge(context.rpcHealthStatus, 'Quorum ready', 'success')
		else if (health.status === 'degraded') setBadge(context.rpcHealthStatus, 'Quorum blocked', 'error')
		else if (health.status === 'not-checked') setBadge(context.rpcHealthStatus, 'Awaiting health check', 'warning')
		else setBadge(context.rpcHealthStatus, 'Health unavailable', 'warning')
		const configured = health.configuredReadEndpointCount
		context.rpcConfiguredTotal.textContent = configured === undefined ? '—' : `${configured.toString()} endpoint${configured === 1 ? '' : 's'}`
		const healthy = health.healthyReadEndpointCount
		if (healthy === undefined) context.rpcHealthyCount.textContent = '—'
		else context.rpcHealthyCount.textContent = configured === undefined ? healthy.toString() : `${healthy.toString()} of ${configured.toString()}`
		const quorum = health.requiredReadQuorum
		context.rpcRequiredQuorum.textContent = quorum === undefined ? '—' : `${quorum.toString()} endpoint${quorum === 1 ? '' : 's'}`
		const chain = value.chainId === undefined ? 'configured chain' : `chain ${String(value.chainId)}`
		if (health.chainReady === true) context.rpcChainReadiness.textContent = `Ready for ${chain}`
		else if (health.chainReady === false) context.rpcChainReadiness.textContent = `Not ready for ${chain}`
		else context.rpcChainReadiness.textContent = 'Not yet verified'
		context.rpcLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
	}

	function renderUnavailableRpcHealth(previousResultIsStale: boolean) {
		context.rpcHealthRetryButton.classList.remove('hidden')
		setBadge(context.rpcHealthStatus, 'Health unavailable', 'warning')
		context.rpcConfiguredTotal.textContent = '—'
		context.rpcHealthyCount.textContent = '—'
		context.rpcRequiredQuorum.textContent = '—'
		context.rpcChainReadiness.textContent = 'Unavailable until state refresh succeeds'
		context.rpcLastCheck.textContent = previousResultIsStale ? 'Previous health result is stale' : 'No current health result'
	}

	function renderSubmissionHealth(health: SubmissionHealth) {
		if (health.status === 'ready') setBadge(context.submissionHealthStatus, 'Path ready', 'success')
		else if (health.status === 'degraded') setBadge(context.submissionHealthStatus, 'Path blocked', 'error')
		else if (health.status === 'stale') setBadge(context.submissionHealthStatus, 'Evidence stale', 'warning')
		else if (health.status === 'not-checked') setBadge(context.submissionHealthStatus, 'Awaiting path check', 'warning')
		else setBadge(context.submissionHealthStatus, 'Path not configured', 'neutral')
		if (health.mode === 'private') context.submissionMode.textContent = 'Private relay'
		else if (health.mode === 'public') context.submissionMode.textContent = 'Public RPC'
		else context.submissionMode.textContent = '—'
		const configured = health.configuredOriginCount
		const healthy = health.healthyOriginCount
		if (healthy === undefined) context.submissionHealthyCount.textContent = '—'
		else if (configured === undefined) context.submissionHealthyCount.textContent = originCount(healthy)
		else context.submissionHealthyCount.textContent = `${healthy.toString()} of ${configured.toString()} origins`
		context.submissionRequiredThreshold.textContent = originCount(health.requiredHealthyOriginCount)
		const checked = health.checkedOriginCount
		const fresh = health.freshOriginCount
		context.submissionFreshness.textContent = checked === undefined || fresh === undefined ? 'Not yet verified' : `${fresh.toString()} fresh of ${checked.toString()} checked`
		if (health.mode !== 'private') context.submissionSignerProof.textContent = 'Not required'
		else if (health.proofMatchesSigner === true) context.submissionSignerProof.textContent = 'Matches current signer'
		else if (health.proofMatchesSigner === false) context.submissionSignerProof.textContent = 'Does not match current signer'
		else context.submissionSignerProof.textContent = 'Not yet proven'
		context.submissionLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
	}

	function renderUnavailableSubmissionHealth(previousResultIsStale: boolean) {
		setBadge(context.submissionHealthStatus, 'Path unavailable', 'warning')
		context.submissionMode.textContent = '—'
		context.submissionHealthyCount.textContent = '—'
		context.submissionRequiredThreshold.textContent = '—'
		context.submissionFreshness.textContent = previousResultIsStale ? 'Previous readiness is stale' : 'Unavailable until state refresh succeeds'
		context.submissionSignerProof.textContent = 'Not yet proven'
		context.submissionLastCheck.textContent = 'No current path result'
	}

	function renderRepBalances(values: RepBalance[]) {
		if (values.length === 0) {
			context.repBalances.className = 'token-list empty-state'
			context.repBalances.textContent = 'No REP inventory observed.'
			return
		}
		context.repBalances.className = 'token-list'
		const rows = values.map(value => {
			const row = node('div', 'token-row')
			const identity = node('div')
			identity.append(node('strong', undefined, value.symbol ?? 'REP'))
			identity.append(node('small', 'mono', value.universeId === undefined ? (value.token ?? '—') : `Universe ${value.universeId}`))
			row.append(identity, node('strong', 'mono', formatAtomic18(value.balance)))
			return row
		})
		context.repBalances.replaceChildren(...rows)
	}

	function originCount(value: number | undefined) {
		return value === undefined ? '—' : `${value.toString()} origin${value === 1 ? '' : 's'}`
	}
	return { renderHeader, renderOverview, renderUnavailableRpcHealth, renderUnavailableSubmissionHealth }
}
