import type { registerExecutionModeForm } from './execution-mode-form.js'
import type { createExecutionPolicyDraft } from './execution-policy-draft.js'
import { fullIdentifier, node, setBadge, statusLabel } from './dom.js'
import { activeSchedulerWorkLabel } from './selection-controls.js'
import { connectivityScope, draftAfterRevisionChange, executionPolicyScope } from './configuration-draft-scope.ts'
import { type Configuration } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { formatClockDuration, parsePositiveNumber } from './dashboard-format.ts'
import type { DashboardState } from './dashboard-state.ts'

type DashboardSettingsViewContext = {
	state: DashboardState
	elements: DashboardElements
	settingsDraft: ReturnType<typeof createExecutionPolicyDraft>
	executionModeForm: ReturnType<typeof registerExecutionModeForm>
	latchConfigurationCommitIndeterminate: (status?: HTMLElement, message?: string) => void
	applyMutationControlLatches: () => void
}

export function createDashboardSettingsView(context: DashboardSettingsViewContext) {
	const { state, elements } = context
	function renderConfiguration(value: Configuration, force = false) {
		if (value.configurationCommitIndeterminate === true) context.latchConfigurationCommitIndeterminate()
		const policyEditable = value.paused === true && state.snapshot?.paused === true && !state.settingsMutationUnreconciled && !state.configurationCommitIndeterminate
		elements.settingsFields.disabled = !policyEditable
		context.executionModeForm.render(value, policyEditable)
		elements.connectivityFields.disabled = state.connectivityMutationUnreconciled || state.configurationCommitIndeterminate
		elements.settingsPauseNote.classList.toggle('hidden', policyEditable)
		elements.signerFields.disabled = state.signerMutationUnreconciled || state.configurationCommitIndeterminate
		elements.setSignerButton.disabled = elements.privateKeyInput.value.trim() === ''
		const network = value.network ?? state.snapshot?.network ?? 'Network unknown'
		let networkTone: Parameters<typeof setBadge>[2] = 'success'
		if (value.networkConfigured === false) networkTone = 'warning'
		else if (value.network === undefined) networkTone = 'neutral'
		setBadge(elements.networkBadge, value.chainId === undefined ? network : `${network} · ${String(value.chainId)}`, networkTone)
		elements.settingsScope.textContent = value.chainId === undefined ? network : `${network} · chain ${String(value.chainId)}`
		elements.settingsScope.className = 'badge neutral'
		if (state.connectivityDraftDirty) {
			if (value.revision !== state.connectivityDraftRevision && draftAfterRevisionChange(state.connectivityDraftScope, connectivityScope(value)) === 'rebase') {
				// Another control saved; the endpoint set this draft replaces is unchanged, so the draft carries over.
				state.connectivityDraftRevision = value.revision
				if (state.connectivityDraftConflict) {
					state.connectivityDraftConflict = false
					elements.saveConnectivityButton.disabled = false
					if (elements.connectivityStatus.textContent?.startsWith('Configuration changed elsewhere') === true) elements.connectivityStatus.textContent = ''
				}
			} else if (value.revision !== state.connectivityDraftRevision) {
				state.connectivityDraftConflict = true
				elements.saveConnectivityButton.disabled = true
				elements.discardConnectivityButton.disabled = false
				elements.connectivityStatus.textContent = 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.'
			}
		} else {
			if (value.rpcQuorum === 1 || value.rpcQuorum === 2) elements.rpcQuorumInput.value = String(value.rpcQuorum)
			elements.readRpcUrlInput.value = value.connectivity?.readRpcUrl ?? ''
			elements.quorumRpcUrlsInput.value = value.connectivity?.quorumRpcUrls.join('\n') ?? ''
			elements.publicRpcUrlsInput.value = value.connectivity?.publicRpcUrls.join('\n') ?? ''
			state.connectivityDraftRevision = value.revision
			state.connectivityDraftScope = connectivityScope(value)
			state.connectivityDraftConflict = false
			elements.saveConnectivityButton.disabled = false
			elements.discardConnectivityButton.disabled = true
		}
		const wallet = value.wallet ?? state.snapshot?.wallet
		elements.signerSummary.replaceChildren()
		if (value.hasSigner === true) {
			if (wallet === undefined) elements.signerSummary.append(node('span', undefined, 'Signer configured'))
			else elements.signerSummary.append(fullIdentifier(wallet, 'transaction signer address'))
			elements.signerSummary.append(node('span', 'signer-persistence', ` · ${value.rememberSigner === true ? 'remembered locally' : 'memory only'}`))
		} else elements.signerSummary.textContent = 'No signer configured'
		elements.rememberSignerInput.checked = value.rememberSigner === true
		if (context.settingsDraft.dirty && !force) {
			context.settingsDraft.render()
			if (value.revision !== state.settingsRevision && draftAfterRevisionChange(state.settingsDraftScope, executionPolicyScope(value)) === 'rebase') {
				// Another control saved; the policy values this draft edits are unchanged, so the draft carries over.
				state.settingsRevision = value.revision
				if (context.settingsDraft.conflict) {
					context.settingsDraft.conflict = false
					elements.saveSettingsButton.disabled = false
					if (elements.settingsSaveStatus.textContent?.startsWith('Configuration changed elsewhere') === true) elements.settingsSaveStatus.textContent = ''
				}
			} else if (value.revision !== state.settingsRevision) {
				context.settingsDraft.conflict = true
				elements.saveSettingsButton.disabled = true
				elements.discardSettingsButton.disabled = false
				elements.settingsSaveStatus.textContent = 'Configuration changed elsewhere. Discard these edits and reload before saving.'
			}
			return
		}
		state.settingsRevision = value.revision
		state.settingsDraftScope = executionPolicyScope(value)
		context.settingsDraft.conflict = false
		elements.saveSettingsButton.disabled = false
		elements.discardSettingsButton.disabled = true
		elements.highRiskInput.checked = value.allowHighRiskOperations === true
		elements.irreversibleInput.checked = value.allowIrreversibleOperations === true
		elements.initializeGenesisInput.checked = value.initializeGenesisUniverse === true
		const allSelectableOperations = value.selectableOperationAllowlist === null
		elements.allSelectableOperationsInput.checked = allSelectableOperations
		elements.selectableOperationAllowlistInput.value = Array.isArray(value.selectableOperationAllowlist) ? value.selectableOperationAllowlist.join('\n') : ''
		elements.selectableOperationAllowlistInput.disabled = allSelectableOperations
		elements.minDelayInput.value = String(value.minimumDelaySeconds ?? 60)
		elements.maxDelayInput.value = String(value.maximumDelaySeconds ?? 3_600)
		elements.reserveEthInput.value = String(value.minimumEthReserve ?? '0.05')
		elements.reserveRepInput.value = String(value.minimumRepReserve ?? '10')
		elements.maximumEthOperationInput.value = String(value.maximumEthPerOperation ?? '0.05')
		elements.maximumGasCostInput.value = String(value.maximumGasCostEth ?? '0.02')
		elements.maximumRepOperationInput.value = String(value.maximumRepPerOperation ?? '10')
		elements.workflowValidBlocksInput.value = String(value.workflowValidForBlocks ?? 288)
		for (const toggle of document.querySelectorAll('[data-ecosystem-toggle]')) {
			if (!(toggle instanceof HTMLInputElement)) continue
			toggle.checked = value.enabledEcosystems.includes(toggle.dataset['ecosystemToggle'] ?? '')
		}
		context.settingsDraft.render()
		context.applyMutationControlLatches()
	}

	function renderCountdown() {
		const value = state.snapshot
		if (value === undefined) return
		if (value.paused === true) {
			elements.countdown.textContent = 'Paused'
			elements.countdownProgress.style.width = '0%'
			setBadge(elements.schedulerState, 'Scheduling stopped', 'warning')
			return
		}
		const activeWork = activeSchedulerWorkLabel(value)
		if (activeWork !== undefined) {
			elements.countdown.textContent = 'On hold'
			elements.countdownProgress.style.width = '100%'
			setBadge(elements.schedulerState, activeWork, 'warning')
			return
		}
		if (value.scheduler.nextRunAt === undefined) {
			elements.countdown.textContent = value.scheduler.due === true ? 'Due now' : 'Waiting'
			elements.countdownProgress.style.width = value.scheduler.due === true ? '100%' : '0%'
			setBadge(elements.schedulerState, value.scheduler.status === undefined ? 'Not scheduled' : statusLabel(value.scheduler.status), value.scheduler.due === true ? 'warning' : 'neutral')
			return
		}
		const nextTimestamp = new Date(value.scheduler.nextRunAt).getTime()
		if (!Number.isFinite(nextTimestamp)) {
			elements.countdown.textContent = '—'
			setBadge(elements.schedulerState, 'Invalid schedule', 'error')
			return
		}
		const remainingSeconds = Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1_000))
		elements.countdown.textContent = remainingSeconds === 0 ? 'Due now' : formatClockDuration(remainingSeconds)
		const totalSeconds = parsePositiveNumber(value.scheduler.lastDelaySeconds)
		let elapsedFraction = remainingSeconds === 0 ? 1 : 0
		if (totalSeconds !== undefined && totalSeconds !== 0) elapsedFraction = Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds))
		elements.countdownProgress.style.width = `${(elapsedFraction * 100).toFixed(1)}%`
		let schedulerLabel = value.scheduler.status === undefined ? 'Scheduled' : statusLabel(value.scheduler.status)
		if (remainingSeconds === 0) schedulerLabel = 'Selecting operation'
		setBadge(elements.schedulerState, schedulerLabel, remainingSeconds === 0 ? 'warning' : 'success')
	}
	return { renderConfiguration, renderCountdown }
}
