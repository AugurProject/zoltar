import type { registerExecutionModeForm } from './execution-mode-form.js'
import { fullIdentifier, node, setBadge, statusLabel } from './dom.js'
import { activeSchedulerWorkLabel } from './selection-controls.js'
import { type Snapshot, type Configuration } from './dashboard-data.ts'

type DashboardSettingsViewContext = {
	latchConfigurationCommitIndeterminate: (status?: HTMLElement, message?: string) => void
	snapshot: Snapshot | undefined
	settingsMutationUnreconciled: boolean
	configurationCommitIndeterminate: boolean
	settingsFields: HTMLFieldSetElement
	executionModeForm: ReturnType<typeof registerExecutionModeForm>
	connectivityFields: HTMLFieldSetElement
	connectivityMutationUnreconciled: boolean
	settingsPauseNote: HTMLDivElement
	signerFields: HTMLFieldSetElement
	signerMutationUnreconciled: boolean
	setSignerButton: HTMLButtonElement
	privateKeyInput: HTMLInputElement
	networkBadge: HTMLSpanElement
	settingsScope: HTMLSpanElement
	connectivityDraftDirty: boolean
	connectivityDraftRevision: string | number | undefined
	connectivityDraftConflict: boolean
	saveConnectivityButton: HTMLButtonElement
	discardConnectivityButton: HTMLButtonElement
	connectivityStatus: HTMLSpanElement
	rpcQuorumInput: HTMLSelectElement
	readRpcUrlInput: HTMLInputElement
	quorumRpcUrlsInput: HTMLTextAreaElement
	publicRpcUrlsInput: HTMLTextAreaElement
	signerSummary: HTMLElement
	rememberSignerInput: HTMLInputElement
	settingsDraft: { dirty: boolean; conflict: boolean; render: () => void }
	settingsRevision: string | number | undefined
	saveSettingsButton: HTMLButtonElement
	discardSettingsButton: HTMLButtonElement
	settingsSaveStatus: HTMLSpanElement
	highRiskInput: HTMLInputElement
	irreversibleInput: HTMLInputElement
	initializeGenesisInput: HTMLInputElement
	allSelectableOperationsInput: HTMLInputElement
	selectableOperationAllowlistInput: HTMLTextAreaElement
	minDelayInput: HTMLInputElement
	maxDelayInput: HTMLInputElement
	reserveEthInput: HTMLInputElement
	reserveRepInput: HTMLInputElement
	maximumEthOperationInput: HTMLInputElement
	maximumGasCostInput: HTMLInputElement
	maximumRepOperationInput: HTMLInputElement
	workflowValidBlocksInput: HTMLInputElement
	applyMutationControlLatches: () => void
	countdown: HTMLHeadingElement
	countdownProgress: HTMLSpanElement
	schedulerState: HTMLSpanElement
	formatDuration: (totalSeconds: number) => string
	parsePositiveNumber: (value: string | number | undefined) => number | undefined
}

export function createDashboardSettingsView(context: DashboardSettingsViewContext) {
	function renderConfiguration(value: Configuration, force = false) {
		if (value.configurationCommitIndeterminate === true) context.latchConfigurationCommitIndeterminate()
		const policyEditable = value.paused === true && context.snapshot?.paused === true && !context.settingsMutationUnreconciled && !context.configurationCommitIndeterminate
		context.settingsFields.disabled = !policyEditable
		context.executionModeForm.render(value, policyEditable)
		context.connectivityFields.disabled = context.connectivityMutationUnreconciled || context.configurationCommitIndeterminate
		context.settingsPauseNote.classList.toggle('hidden', policyEditable)
		context.signerFields.disabled = context.signerMutationUnreconciled || context.configurationCommitIndeterminate
		context.setSignerButton.disabled = context.privateKeyInput.value.trim() === ''
		const network = value.network ?? context.snapshot?.network ?? 'Network unknown'
		let networkTone: Parameters<typeof setBadge>[2] = 'success'
		if (value.networkConfigured === false) networkTone = 'warning'
		else if (value.network === undefined) networkTone = 'neutral'
		setBadge(context.networkBadge, value.chainId === undefined ? network : `${network} · ${String(value.chainId)}`, networkTone)
		context.settingsScope.textContent = value.chainId === undefined ? network : `${network} · chain ${String(value.chainId)}`
		context.settingsScope.className = 'badge neutral'
		if (context.connectivityDraftDirty) {
			if (value.revision !== context.connectivityDraftRevision) {
				context.connectivityDraftConflict = true
				context.saveConnectivityButton.disabled = true
				context.discardConnectivityButton.disabled = false
				context.connectivityStatus.textContent = 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.'
			}
		} else {
			if (value.rpcQuorum === 1 || value.rpcQuorum === 2) context.rpcQuorumInput.value = String(value.rpcQuorum)
			context.readRpcUrlInput.value = value.connectivity?.readRpcUrl ?? ''
			context.quorumRpcUrlsInput.value = value.connectivity?.quorumRpcUrls.join('\n') ?? ''
			context.publicRpcUrlsInput.value = value.connectivity?.publicRpcUrls.join('\n') ?? ''
			context.connectivityDraftRevision = value.revision
			context.connectivityDraftConflict = false
			context.saveConnectivityButton.disabled = false
			context.discardConnectivityButton.disabled = true
		}
		const wallet = value.wallet ?? context.snapshot?.wallet
		context.signerSummary.replaceChildren()
		if (value.hasSigner === true) {
			if (wallet === undefined) context.signerSummary.append(node('span', undefined, 'Signer configured'))
			else context.signerSummary.append(fullIdentifier(wallet, 'transaction signer address'))
			context.signerSummary.append(node('span', 'signer-persistence', ` · ${value.rememberSigner === true ? 'remembered locally' : 'memory only'}`))
		} else context.signerSummary.textContent = 'No signer configured'
		context.rememberSignerInput.checked = value.rememberSigner === true
		if (context.settingsDraft.dirty && !force) {
			context.settingsDraft.render()
			if (value.revision !== context.settingsRevision) {
				context.settingsDraft.conflict = true
				context.saveSettingsButton.disabled = true
				context.discardSettingsButton.disabled = false
				context.settingsSaveStatus.textContent = 'Configuration changed elsewhere. Discard these edits and reload before saving.'
			}
			return
		}
		context.settingsRevision = value.revision
		context.settingsDraft.conflict = false
		context.saveSettingsButton.disabled = false
		context.discardSettingsButton.disabled = true
		context.highRiskInput.checked = value.allowHighRiskOperations === true
		context.irreversibleInput.checked = value.allowIrreversibleOperations === true
		context.initializeGenesisInput.checked = value.initializeGenesisUniverse === true
		const allSelectableOperations = value.selectableOperationAllowlist === null
		context.allSelectableOperationsInput.checked = allSelectableOperations
		context.selectableOperationAllowlistInput.value = Array.isArray(value.selectableOperationAllowlist) ? value.selectableOperationAllowlist.join('\n') : ''
		context.selectableOperationAllowlistInput.disabled = allSelectableOperations
		context.minDelayInput.value = String(value.minimumDelaySeconds ?? 60)
		context.maxDelayInput.value = String(value.maximumDelaySeconds ?? 3_600)
		context.reserveEthInput.value = String(value.minimumEthReserve ?? '0.05')
		context.reserveRepInput.value = String(value.minimumRepReserve ?? '10')
		context.maximumEthOperationInput.value = String(value.maximumEthPerOperation ?? '0.05')
		context.maximumGasCostInput.value = String(value.maximumGasCostEth ?? '0.02')
		context.maximumRepOperationInput.value = String(value.maximumRepPerOperation ?? '10')
		context.workflowValidBlocksInput.value = String(value.workflowValidForBlocks ?? 288)
		for (const toggle of document.querySelectorAll('[data-ecosystem-toggle]')) {
			if (!(toggle instanceof HTMLInputElement)) continue
			toggle.checked = value.enabledEcosystems.includes(toggle.dataset['ecosystemToggle'] ?? '')
		}
		context.settingsDraft.render()
		context.applyMutationControlLatches()
	}

	function renderCountdown() {
		const value = context.snapshot
		if (value === undefined) return
		if (value.paused === true) {
			context.countdown.textContent = 'Paused'
			context.countdownProgress.style.width = '0%'
			setBadge(context.schedulerState, 'Scheduling stopped', 'warning')
			return
		}
		const activeWork = activeSchedulerWorkLabel(value)
		if (activeWork !== undefined) {
			context.countdown.textContent = 'On hold'
			context.countdownProgress.style.width = '100%'
			setBadge(context.schedulerState, activeWork, 'warning')
			return
		}
		if (value.scheduler.nextRunAt === undefined) {
			context.countdown.textContent = value.scheduler.due === true ? 'Due now' : 'Waiting'
			context.countdownProgress.style.width = value.scheduler.due === true ? '100%' : '0%'
			setBadge(context.schedulerState, value.scheduler.status === undefined ? 'Not scheduled' : statusLabel(value.scheduler.status), value.scheduler.due === true ? 'warning' : 'neutral')
			return
		}
		const nextTimestamp = new Date(value.scheduler.nextRunAt).getTime()
		if (!Number.isFinite(nextTimestamp)) {
			context.countdown.textContent = '—'
			setBadge(context.schedulerState, 'Invalid schedule', 'error')
			return
		}
		const remainingSeconds = Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1_000))
		context.countdown.textContent = remainingSeconds === 0 ? 'Due now' : context.formatDuration(remainingSeconds)
		const totalSeconds = context.parsePositiveNumber(value.scheduler.lastDelaySeconds)
		let elapsedFraction = remainingSeconds === 0 ? 1 : 0
		if (totalSeconds !== undefined && totalSeconds !== 0) elapsedFraction = Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds))
		context.countdownProgress.style.width = `${(elapsedFraction * 100).toFixed(1)}%`
		let schedulerLabel = value.scheduler.status === undefined ? 'Scheduled' : statusLabel(value.scheduler.status)
		if (remainingSeconds === 0) schedulerLabel = 'Selecting operation'
		setBadge(context.schedulerState, schedulerLabel, remainingSeconds === 0 ? 'warning' : 'success')
	}
	return { renderConfiguration, renderCountdown }
}
