import { registerCompleteConfigurationForm } from './complete-configuration-form.ts'
import { createSettingsNavigation } from '@zoltar/bot-shared/dashboard/settings-navigation'
import { createActivityTimeline } from './activity-timeline.js'
import { createCatalogGroups } from './catalog-groups.js'
import { createDashboardCatalogView } from './dashboard-catalog-view.js'
import type { Snapshot } from './dashboard-data.ts'
import { createDashboardElements } from './dashboard-elements.ts'
import { ecosystemLabel, ecosystemOrder } from './dashboard-format.ts'
import { createDashboardHealthView } from './dashboard-health-view.js'
import { createMutationLatches } from './dashboard-mutation-latches.ts'
import { registerSectionNavigation } from './dashboard-navigation.ts'
import { registerPauseControls } from './dashboard-pause-controls.ts'
import { createRecoveryContexts } from './dashboard-recovery-contexts.ts'
import { registerRecoveryForms } from './dashboard-recovery-forms.ts'
import { createDashboardRecoveryView } from './dashboard-recovery-view.js'
import { createDashboardRefresh } from './dashboard-refresh.ts'
import { put, readThroughPut } from './dashboard-requests.ts'
import { registerSettingsForms } from './dashboard-settings-forms.ts'
import { createDashboardSettingsView } from './dashboard-settings-view.js'
import { createDashboardState } from './dashboard-state.ts'
import { createDashboardTopologyView } from './dashboard-topology-view.js'
import { registerExecutionModeForm } from './execution-mode-form.js'
import { createExecutionPolicyDraft } from './execution-policy-draft.js'
import { createOperationDialog } from './operation-dialog.js'
import { renderOperatorAlerts } from './operator-alerts.js'
import { createRetirementDashboard } from './retirement-dashboard.js'
import { createSelectionControls } from './selection-controls.js'
import { createWorkflowHistory } from './workflow-history.js'

const stateRefreshMilliseconds = 10_000

const elements = createDashboardElements()
const state = createDashboardState()
const renderWorkflowHistory = createWorkflowHistory(elements.workflowHistory)
const renderActivities = createActivityTimeline()

// The components below call back into `settingsView` and `controller` only from user events and refreshes,
// which cannot run before this module finishes wiring the page.
const settingsDraft = createExecutionPolicyDraft({
	fields: elements.settingsFields,
	discard: elements.discardSettingsButton,
	status: elements.settingsSaveStatus,
	reload: () => {
		if (state.configuration !== undefined) settingsView.renderConfiguration(state.configuration, true)
	},
})
createSettingsNavigation()
const executionModeForm = registerExecutionModeForm({
	configuration: () => state.configuration,
	put,
	reconcile: (error, status) => controller.reconcileUnknownMutation(error, status, 'configuration and state', 'settings'),
	refresh: () => controller.refresh(),
	snapshot: () => state.snapshot,
})
const retirementDashboard = createRetirementDashboard({
	current: () => state.snapshot,
	put: async value => await put('/api/retirement', value),
	reconcile: (error, status) => controller.reconcileUnknownMutation(error, status, 'state'),
	refresh: async () => await controller.refresh(),
})
const selectionControls = createSelectionControls({
	put,
	refresh: () => controller.refresh(),
	reconcile: (error, status) => controller.reconcileUnknownMutation(error, status, 'configuration and state', 'settings'),
})
const latches = createMutationLatches({ state, elements, executionModeForm, selectionControls })
const operationDialog = createOperationDialog({
	// The 1.5 s status poll must not hold back state polling. Inspect and preview stay counted: the server runs a scan
	// for them inside its mutation queue, so state reads sent meanwhile would time out; the settle wait is bounded.
	request: (value, action) => (action === 'status' ? readThroughPut('/api/operation', value, 10_000) : put('/api/operation', value, 120_000)),
})
const renderCatalogGroups = createCatalogGroups(elements.catalogRows, ecosystemOrder, ecosystemLabel)

const recoveryView = createDashboardRecoveryView({ state, elements })
const healthView = createDashboardHealthView({ state, elements, renderWorkflow: recoveryView.renderWorkflow, renderWorkflowHistory, renderCoverage: recoveryView.renderCoverage, retirementDashboard })
const catalogView = createDashboardCatalogView({ elements, operationDialog, selectionControls, renderCatalogGroups, updateSelectionControls: latches.updateSelectionControls })
const topologyView = createDashboardTopologyView({ elements })
const settingsView = createDashboardSettingsView({
	state,
	elements,
	settingsDraft,
	executionModeForm,
	latchConfigurationCommitIndeterminate: latches.latchConfigurationCommitIndeterminate,
	applyMutationControlLatches: latches.applyMutationControlLatches,
})

const controller = createDashboardRefresh({
	state,
	elements,
	latches,
	renderSnapshot,
	renderHeader: healthView.renderHeader,
	renderHealth: healthView.renderHealth,
	renderUnavailableRpcHealth: healthView.renderUnavailableRpcHealth,
	renderUnavailableSubmissionHealth: healthView.renderUnavailableSubmissionHealth,
	renderConfiguration: settingsView.renderConfiguration,
})
const { refresh, reconcileUnknownMutation, requestRecoveryContextRefresh } = controller
const recoveryContexts = createRecoveryContexts(elements)

registerSectionNavigation(() => {
	// The alert actions and the complete-configuration loader depend on the page shown.
	if (state.snapshot !== undefined) renderOperatorAlerts(elements.operatorAlerts, state.snapshot.alerts)
	completeConfigurationForm.renderAvailability()
})

elements.rpcHealthRetryButton.addEventListener('click', () => void refresh())
for (const context of recoveryContexts.all) context.retryButton.addEventListener('click', () => void requestRecoveryContextRefresh(context))
for (const filter of [elements.catalogFilter, elements.catalogClassificationFilter, elements.catalogEligibilityFilter]) {
	filter.addEventListener('change', () => {
		if (state.snapshot !== undefined) catalogView.renderCatalog(state.snapshot.operationEvaluations)
	})
}
registerPauseControls({ state, elements, put, refresh, reconcileUnknownMutation, renderHeader: healthView.renderHeader })
const syncWorkflowSubmit = registerRecoveryForms({ state, elements, contexts: recoveryContexts, put, refresh, reconcileUnknownMutation, requestRecoveryContextRefresh })
const completeConfigurationForm = registerCompleteConfigurationForm(state, reconcileUnknownMutation)
registerSettingsForms({ state, elements, settingsDraft, put, refresh, reconcileUnknownMutation, renderConfiguration: settingsView.renderConfiguration })

function renderSnapshot(value: Snapshot) {
	completeConfigurationForm.renderAvailability()
	healthView.renderHeader(value)
	healthView.renderOverview(value)
	catalogView.renderCatalog(value.operationEvaluations)
	catalogView.renderEcosystems(value.operationEvaluations)
	topologyView.renderTopology(value.topology)
	recoveryView.renderRecovery(value)
	renderActivities(value.activities, state.configuration?.explorerUrl)
	renderOperatorAlerts(elements.operatorAlerts, value.alerts)
	settingsView.renderCountdown()
	latches.applyMutationControlLatches()
	syncWorkflowSubmit()
}

window.addEventListener('focus', () => void refresh())
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') void refresh()
})
window.setInterval(() => {
	settingsView.renderCountdown()
	healthView.renderScanAge()
}, 1_000)
window.setInterval(() => void refresh(), stateRefreshMilliseconds)
void refresh()
