import type { registerExecutionModeForm } from './execution-mode-form.js'
import { activeSchedulerWorkLabel, type createSelectionControls } from './selection-controls.js'
import type { DashboardElements } from './dashboard-elements.ts'
import type { DashboardState } from './dashboard-state.ts'

export type MutationReconciliationTarget = 'connectivity' | 'pause' | 'settings' | 'signer'

const configurationCommitIndeterminateRecoveryMessage = 'Dashboard mutation controls are permanently frozen in this server process and page. Stop the bot, inspect and reload the owner configuration and runtime-state files offline, then restart it before making another mutation.'
const configurationCommitIndeterminateMessage = 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.'

type MutationLatchesContext = {
	state: DashboardState
	elements: DashboardElements
	executionModeForm: ReturnType<typeof registerExecutionModeForm>
	selectionControls: ReturnType<typeof createSelectionControls>
}

/** Keeps mutation controls frozen while an unknown mutation outcome is unreconciled or the configuration commit is indeterminate. */
export function createMutationLatches({ state, elements, executionModeForm, selectionControls }: MutationLatchesContext) {
	function updateSelectionControls() {
		const { configuration, snapshot } = state
		selectionControls.update({
			available: state.selectionControlsAvailable,
			frozen: state.configurationCommitIndeterminate || state.settingsMutationUnreconciled || state.pauseMutationUnreconciled,
			paused: configuration?.paused === true && snapshot?.paused === true,
			revision: configuration?.revision,
			selection: configuration?.selectableOperationAllowlist,
			scheduledAt:
				configuration?.paused === false && snapshot?.paused !== true && snapshot?.safetyPaused !== true && snapshot?.scheduler.status === 'scheduled' && (snapshot.retirement?.status === undefined || snapshot.retirement.status === 'inactive') && activeSchedulerWorkLabel(snapshot) === undefined
					? snapshot.scheduler.nextRunAt
					: undefined,
		})
	}

	function applyMutationControlLatches() {
		updateSelectionControls()
		if (state.pauseMutationUnreconciled || state.configurationCommitIndeterminate) elements.pauseButton.disabled = true
		if (state.settingsMutationUnreconciled || state.configurationCommitIndeterminate) {
			elements.settingsFields.disabled = true
			executionModeForm.lock()
		}
		if (state.connectivityMutationUnreconciled || state.configurationCommitIndeterminate) elements.connectivityFields.disabled = true
		if (state.signerMutationUnreconciled || state.configurationCommitIndeterminate) elements.signerFields.disabled = true
		if (!state.configurationCommitIndeterminate) return
		elements.confirmResume.disabled = true
		for (const fields of [elements.replacementFields, elements.cancellationFields, elements.candidateFields, elements.workflowFields, elements.obligationFields]) fields.disabled = true
	}

	function setMutationReconciliationPending(target: MutationReconciliationTarget) {
		if (target === 'connectivity') state.connectivityMutationUnreconciled = true
		else if (target === 'pause') state.pauseMutationUnreconciled = true
		else if (target === 'settings') state.settingsMutationUnreconciled = true
		else state.signerMutationUnreconciled = true
		applyMutationControlLatches()
	}

	function latchConfigurationCommitIndeterminate(status?: HTMLElement, message = configurationCommitIndeterminateMessage) {
		state.configurationCommitIndeterminate = true
		const recovery = `${message} ${configurationCommitIndeterminateRecoveryMessage}`
		if (status !== undefined) status.textContent = recovery
		elements.configurationStatus.textContent = recovery
		elements.configurationStatus.className = 'notice error'
		applyMutationControlLatches()
	}

	return { applyMutationControlLatches, latchConfigurationCommitIndeterminate, setMutationReconciliationPending, updateSelectionControls }
}

export type MutationLatches = ReturnType<typeof createMutationLatches>
