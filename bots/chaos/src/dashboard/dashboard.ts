import { createDashboardHealthView } from './dashboard-health-view.js'
import { createDashboardCatalogView } from './dashboard-catalog-view.js'
import { createDashboardTopologyView } from './dashboard-topology-view.js'
import { createDashboardRecoveryView } from './dashboard-recovery-view.js'
import { createDashboardSettingsView } from './dashboard-settings-view.js'
import { createWorkflowHistory } from './workflow-history.js'
import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import { optionalRecord as record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { createExecutionPolicyDraft } from './execution-policy-draft.js'
import { createSettingsNavigation } from '@zoltar/bot-shared/dashboard/settings-navigation'
import { element, markCurrentPage } from '@zoltar/bot-shared/dashboard/dom'
import { decimalAtto } from './go-live.js'
import { registerExecutionModeForm } from './execution-mode-form.js'
import { createActivityTimeline } from './activity-timeline.js'
import { createCatalogGroups } from './catalog-groups.js'
import { fullIdentifier, formatDate, node, transactionExplorerUrl } from './dom.js'
import { createRetirementDashboard } from './retirement-dashboard.js'
import { createOperationDialog } from './operation-dialog.js'
import { renderOperatorAlerts } from './operator-alerts.js'
import { activeSchedulerWorkLabel, createSelectionControls } from './selection-controls.js'
import { type Snapshot, type Configuration, stringValue, type OperationEvaluation, type Obligation, parseConfiguration, parseSnapshot } from './dashboard-data.ts'

const { renderHeader, renderOverview, renderUnavailableRpcHealth, renderUnavailableSubmissionHealth } = createDashboardHealthView({
	get lastBlock() {
		return lastBlock
	},
	get lastScan() {
		return lastScan
	},
	get formatRelative() {
		return formatRelative
	},
	get modeBadge() {
		return modeBadge
	},
	get configuration() {
		return configuration
	},
	set configuration(value) {
		configuration = value
	},
	get networkBadge() {
		return networkBadge
	},
	get signerBadge() {
		return signerBadge
	},
	get recoveryItemCount() {
		return recoveryItemCount
	},
	get recoveryBadge() {
		return recoveryBadge
	},
	get pauseMutationPending() {
		return pauseMutationPending
	},
	set pauseMutationPending(value) {
		pauseMutationPending = value
	},
	get pauseButton() {
		return pauseButton
	},
	get pauseMutationUnreconciled() {
		return pauseMutationUnreconciled
	},
	set pauseMutationUnreconciled(value) {
		pauseMutationUnreconciled = value
	},
	get configurationCommitIndeterminate() {
		return configurationCommitIndeterminate
	},
	set configurationCommitIndeterminate(value) {
		configurationCommitIndeterminate = value
	},
	get nextRun() {
		return nextRun
	},
	get parsePositiveNumber() {
		return parsePositiveNumber
	},
	get lastDelay() {
		return lastDelay
	},
	get formatDuration() {
		return formatDuration
	},
	get operationIsIndependentlyExecutable() {
		return operationIsIndependentlyExecutable
	},
	get eligibleCount() {
		return eligibleCount
	},
	get selectedOperation() {
		return selectedOperation
	},
	get walletShort() {
		return walletShort
	},
	get balanceEth() {
		return balanceEth
	},
	get balanceWeth() {
		return balanceWeth
	},
	get balanceRepTotal() {
		return balanceRepTotal
	},
	get repBalances() {
		return repBalances
	},
	get renderWorkflow() {
		return renderWorkflow
	},
	get renderWorkflowHistory() {
		return renderWorkflowHistory
	},
	get renderCoverage() {
		return renderCoverage
	},
	get retirementDashboard() {
		return retirementDashboard
	},
	get rpcHealthRetryButton() {
		return rpcHealthRetryButton
	},
	get rpcHealthStatus() {
		return rpcHealthStatus
	},
	get rpcConfiguredTotal() {
		return rpcConfiguredTotal
	},
	get rpcHealthyCount() {
		return rpcHealthyCount
	},
	get rpcRequiredQuorum() {
		return rpcRequiredQuorum
	},
	get rpcChainReadiness() {
		return rpcChainReadiness
	},
	get rpcLastCheck() {
		return rpcLastCheck
	},
	get submissionHealthStatus() {
		return submissionHealthStatus
	},
	get submissionMode() {
		return submissionMode
	},
	get submissionHealthyCount() {
		return submissionHealthyCount
	},
	get submissionRequiredThreshold() {
		return submissionRequiredThreshold
	},
	get submissionFreshness() {
		return submissionFreshness
	},
	get submissionSignerProof() {
		return submissionSignerProof
	},
	get submissionLastCheck() {
		return submissionLastCheck
	},
})

const { renderCatalog, renderEcosystems } = createDashboardCatalogView({
	get catalogFilter() {
		return catalogFilter
	},
	get catalogClassificationFilter() {
		return catalogClassificationFilter
	},
	get catalogEligibilityFilter() {
		return catalogEligibilityFilter
	},
	get catalogSignature() {
		return catalogSignature
	},
	set catalogSignature(value) {
		catalogSignature = value
	},
	get normalizeEcosystem() {
		return normalizeEcosystem
	},
	get displayedClassification() {
		return displayedClassification
	},
	get operationIsIndependentlyExecutable() {
		return operationIsIndependentlyExecutable
	},
	get publicCandidateCount() {
		return publicCandidateCount
	},
	get catalogCaption() {
		return catalogCaption
	},
	get catalogRowCache() {
		return catalogRowCache
	},
	get classificationLabel() {
		return classificationLabel
	},
	get operationDialog() {
		return operationDialog
	},
	get selectionControls() {
		return selectionControls
	},
	get catalogRows() {
		return catalogRows
	},
	get renderCatalogGroups() {
		return renderCatalogGroups
	},
	get updateSelectionControls() {
		return updateSelectionControls
	},
	get ecosystemOrder() {
		return ecosystemOrder
	},
	get parsePositiveNumber() {
		return parsePositiveNumber
	},
	get ecosystemLabels() {
		return ecosystemLabels
	},
	get ecosystemGrid() {
		return ecosystemGrid
	},
})

const { renderTopology } = createDashboardTopologyView({
	get topologyGroupSignatures() {
		return topologyGroupSignatures
	},
	get topologyAnchor() {
		return topologyAnchor
	},
	get topologyStatus() {
		return topologyStatus
	},
	get topologyUniverses() {
		return topologyUniverses
	},
	get topologyPools() {
		return topologyPools
	},
	get topologyReports() {
		return topologyReports
	},
	get topologyAuctions() {
		return topologyAuctions
	},
	get topologyPairs() {
		return topologyPairs
	},
})

const { renderWorkflow, renderCoverage, renderRecovery } = createDashboardRecoveryView({
	get currentWorkflow() {
		return currentWorkflow
	},
	get ecosystemLabel() {
		return ecosystemLabel
	},
	get transactionIdentifier() {
		return transactionIdentifier
	},
	get ecosystemOrder() {
		return ecosystemOrder
	},
	get normalizeEcosystem() {
		return normalizeEcosystem
	},
	get operationIsIndependentlyExecutable() {
		return operationIsIndependentlyExecutable
	},
	get ecosystemLabels() {
		return ecosystemLabels
	},
	get coverageSummary() {
		return coverageSummary
	},
	get pendingCount() {
		return pendingCount
	},
	get obligationCount() {
		return obligationCount
	},
	get obligationFields() {
		return obligationFields
	},
	get workflowFields() {
		return workflowFields
	},
	get obligationIdInput() {
		return obligationIdInput
	},
	get replacementFields() {
		return replacementFields
	},
	get cancellationFields() {
		return cancellationFields
	},
	get candidateFields() {
		return candidateFields
	},
	get pendingTransactions() {
		return pendingTransactions
	},
	get transactionLine() {
		return transactionLine
	},
	get obligations() {
		return obligations
	},
	get obligationDetail() {
		return obligationDetail
	},
})

const { renderConfiguration, renderCountdown } = createDashboardSettingsView({
	get latchConfigurationCommitIndeterminate() {
		return latchConfigurationCommitIndeterminate
	},
	get snapshot() {
		return snapshot
	},
	set snapshot(value) {
		snapshot = value
	},
	get settingsMutationUnreconciled() {
		return settingsMutationUnreconciled
	},
	set settingsMutationUnreconciled(value) {
		settingsMutationUnreconciled = value
	},
	get configurationCommitIndeterminate() {
		return configurationCommitIndeterminate
	},
	set configurationCommitIndeterminate(value) {
		configurationCommitIndeterminate = value
	},
	get settingsFields() {
		return settingsFields
	},
	get executionModeForm() {
		return executionModeForm
	},
	get connectivityFields() {
		return connectivityFields
	},
	get connectivityMutationUnreconciled() {
		return connectivityMutationUnreconciled
	},
	set connectivityMutationUnreconciled(value) {
		connectivityMutationUnreconciled = value
	},
	get settingsPauseNote() {
		return settingsPauseNote
	},
	get signerFields() {
		return signerFields
	},
	get signerMutationUnreconciled() {
		return signerMutationUnreconciled
	},
	set signerMutationUnreconciled(value) {
		signerMutationUnreconciled = value
	},
	get setSignerButton() {
		return setSignerButton
	},
	get privateKeyInput() {
		return privateKeyInput
	},
	get networkBadge() {
		return networkBadge
	},
	get settingsScope() {
		return settingsScope
	},
	get connectivityDraftDirty() {
		return connectivityDraftDirty
	},
	set connectivityDraftDirty(value) {
		connectivityDraftDirty = value
	},
	get connectivityDraftRevision() {
		return connectivityDraftRevision
	},
	set connectivityDraftRevision(value) {
		connectivityDraftRevision = value
	},
	get connectivityDraftConflict() {
		return connectivityDraftConflict
	},
	set connectivityDraftConflict(value) {
		connectivityDraftConflict = value
	},
	get saveConnectivityButton() {
		return saveConnectivityButton
	},
	get discardConnectivityButton() {
		return discardConnectivityButton
	},
	get connectivityStatus() {
		return connectivityStatus
	},
	get rpcQuorumInput() {
		return rpcQuorumInput
	},
	get readRpcUrlInput() {
		return readRpcUrlInput
	},
	get quorumRpcUrlsInput() {
		return quorumRpcUrlsInput
	},
	get publicRpcUrlsInput() {
		return publicRpcUrlsInput
	},
	get signerSummary() {
		return signerSummary
	},
	get rememberSignerInput() {
		return rememberSignerInput
	},
	get settingsDraft() {
		return settingsDraft
	},
	get settingsRevision() {
		return settingsRevision
	},
	set settingsRevision(value) {
		settingsRevision = value
	},
	get saveSettingsButton() {
		return saveSettingsButton
	},
	get discardSettingsButton() {
		return discardSettingsButton
	},
	get settingsSaveStatus() {
		return settingsSaveStatus
	},
	get highRiskInput() {
		return highRiskInput
	},
	get irreversibleInput() {
		return irreversibleInput
	},
	get initializeGenesisInput() {
		return initializeGenesisInput
	},
	get allSelectableOperationsInput() {
		return allSelectableOperationsInput
	},
	get selectableOperationAllowlistInput() {
		return selectableOperationAllowlistInput
	},
	get minDelayInput() {
		return minDelayInput
	},
	get maxDelayInput() {
		return maxDelayInput
	},
	get reserveEthInput() {
		return reserveEthInput
	},
	get reserveRepInput() {
		return reserveRepInput
	},
	get maximumEthOperationInput() {
		return maximumEthOperationInput
	},
	get maximumGasCostInput() {
		return maximumGasCostInput
	},
	get maximumRepOperationInput() {
		return maximumRepOperationInput
	},
	get workflowValidBlocksInput() {
		return workflowValidBlocksInput
	},
	get applyMutationControlLatches() {
		return applyMutationControlLatches
	},
	get countdown() {
		return countdown
	},
	get countdownProgress() {
		return countdownProgress
	},
	get schedulerState() {
		return schedulerState
	},
	get formatDuration() {
		return formatDuration
	},
	get parsePositiveNumber() {
		return parsePositiveNumber
	},
})

const stateRequestTimeoutMilliseconds = 5_000
const configurationRequestTimeoutMilliseconds = 5_000
const connectivityMutationTimeoutMilliseconds = 30_000
const stateRefreshMilliseconds = 10_000
const ecosystemOrder = ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const
const ecosystemLabels = new Map<string, string>([
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'Open Oracle'],
	['trading', 'Trading'],
])

const modeBadge = element('mode-badge', HTMLSpanElement)
const networkBadge = element('network-badge', HTMLSpanElement)
const signerBadge = element('signer-badge', HTMLSpanElement)
const recoveryBadge = element('recovery-badge', HTMLAnchorElement)
const pauseButton = element('pause-button', HTMLButtonElement)
const pauseStatus = element('pause-status', HTMLSpanElement)
const globalError = element('global-error', HTMLDivElement)
const operatorAlerts = element('operator-alerts', HTMLUListElement)
const lastBlock = element('last-block', HTMLSpanElement)
const lastScan = element('last-scan', HTMLSpanElement)
const countdown = element('countdown', HTMLHeadingElement)
const countdownProgress = element('countdown-progress', HTMLSpanElement)
const schedulerState = element('scheduler-state', HTMLSpanElement)
const nextRun = element('next-run', HTMLElement)
const lastDelay = element('last-delay', HTMLElement)
const eligibleCount = element('eligible-count', HTMLElement)
const selectedOperation = element('selected-operation', HTMLElement)
const walletShort = element('wallet-short', HTMLSpanElement)
const balanceEth = element('balance-eth', HTMLElement)
const balanceWeth = element('balance-weth', HTMLElement)
const balanceRepTotal = element('balance-rep-total', HTMLElement)
const repBalances = element('rep-balances', HTMLDivElement)
const rpcHealthStatus = element('rpc-health-status', HTMLSpanElement)
const rpcConfiguredTotal = element('rpc-configured-total', HTMLElement)
const rpcHealthyCount = element('rpc-healthy-count', HTMLElement)
const rpcRequiredQuorum = element('rpc-required-quorum', HTMLElement)
const rpcChainReadiness = element('rpc-chain-readiness', HTMLElement)
const rpcLastCheck = element('rpc-last-check', HTMLElement)
const rpcHealthRetryButton = element('rpc-health-retry-button', HTMLButtonElement)
const submissionHealthStatus = element('submission-health-status', HTMLSpanElement)
const submissionMode = element('submission-mode', HTMLElement)
const submissionHealthyCount = element('submission-healthy-count', HTMLElement)
const submissionRequiredThreshold = element('submission-required-threshold', HTMLElement)
const submissionFreshness = element('submission-freshness', HTMLElement)
const submissionSignerProof = element('submission-signer-proof', HTMLElement)
const submissionLastCheck = element('submission-last-check', HTMLElement)
const currentWorkflow = element('current-workflow', HTMLDivElement)
const renderWorkflowHistory = createWorkflowHistory(element('workflow-history', HTMLDivElement))
const coverageSummary = element('coverage-summary', HTMLDivElement)
const catalogFilter = element('catalog-filter', HTMLSelectElement)
const catalogClassificationFilter = element('catalog-classification-filter', HTMLSelectElement)
const catalogEligibilityFilter = element('catalog-eligibility-filter', HTMLSelectElement)
const catalogCaption = element('catalog-caption', HTMLParagraphElement)
const catalogRows = element('catalog-rows', HTMLDivElement)
const ecosystemGrid = element('ecosystem-grid', HTMLDivElement)
const topologyAnchor = element('topology-anchor', HTMLSpanElement)
const topologyStatus = element('topology-status', HTMLParagraphElement)
const topologyUniverses = element('topology-universes', HTMLDivElement)
const topologyPools = element('topology-pools', HTMLDivElement)
const topologyReports = element('topology-reports', HTMLDivElement)
const topologyAuctions = element('topology-auctions', HTMLDivElement)
const topologyPairs = element('topology-pairs', HTMLDivElement)
const pendingCount = element('pending-count', HTMLSpanElement)
const obligationCount = element('obligation-count', HTMLSpanElement)
const pendingTransactions = element('pending-transactions', HTMLDivElement)
const replacementForm = element('replacement-form', HTMLFormElement)
const replacementFields = element('replacement-fields', HTMLFieldSetElement)
const replacementHashInput = element('replacement-hash', HTMLInputElement)
const replacementStatus = element('replacement-status', HTMLSpanElement)
const replacementRetryButton = element('replacement-retry', HTMLButtonElement)
const cancellationForm = element('cancellation-form', HTMLFormElement)
const cancellationFields = element('cancellation-fields', HTMLFieldSetElement)
const cancellationHashInput = element('cancellation-hash', HTMLInputElement)
const cancellationReasonInput = element('cancellation-reason', HTMLTextAreaElement)
const cancellationConfirmationInput = element('cancellation-confirmation', HTMLInputElement)
const cancellationStatus = element('cancellation-status', HTMLSpanElement)
const cancellationRetryButton = element('cancellation-retry', HTMLButtonElement)
const candidateForm = element('candidate-form', HTMLFormElement)
const candidateFields = element('candidate-fields', HTMLFieldSetElement)
const candidateReasonInput = element('candidate-reason', HTMLTextAreaElement)
const candidateConfirmationInput = element('candidate-confirmation', HTMLInputElement)
const candidateStatus = element('candidate-status', HTMLSpanElement)
const candidateRetryButton = element('candidate-retry', HTMLButtonElement)
const workflowForm = element('workflow-form', HTMLFormElement)
const workflowFields = element('workflow-fields', HTMLFieldSetElement)
const workflowReasonInput = element('workflow-reason', HTMLTextAreaElement)
const workflowConfirmationInput = element('workflow-confirmation', HTMLInputElement)
const workflowStatus = element('workflow-status', HTMLSpanElement)
const workflowRetryButton = element('workflow-retry', HTMLButtonElement)
const obligations = element('obligations', HTMLDivElement)
const obligationForm = element('obligation-form', HTMLFormElement)
const obligationFields = element('obligation-fields', HTMLFieldSetElement)
const obligationIdInput = element('obligation-id', HTMLSelectElement)
const obligationActionInput = element('obligation-action', HTMLSelectElement)
const obligationReasonInput = element('obligation-reason', HTMLTextAreaElement)
const obligationConfirmationInput = element('obligation-confirmation', HTMLInputElement)
const obligationConfirmationHelp = element('obligation-confirmation-help', HTMLParagraphElement)
const obligationStatus = element('obligation-status', HTMLSpanElement)
const obligationRetryButton = element('obligation-retry', HTMLButtonElement)
const renderActivities = createActivityTimeline()
const settingsScope = element('settings-scope', HTMLSpanElement)
const configurationStatus = element('configuration-status', HTMLDivElement)
const settingsPauseNote = element('settings-pause-note', HTMLDivElement)
const connectivityForm = element('connectivity-form', HTMLFormElement)
const connectivityFields = element('connectivity-fields', HTMLFieldSetElement)
const readRpcUrlInput = element('read-rpc-url', HTMLInputElement)
const rpcQuorumInput = element('rpc-quorum', HTMLSelectElement)
const quorumRpcUrlsInput = element('quorum-rpc-urls', HTMLTextAreaElement)
const publicRpcUrlsInput = element('public-rpc-urls', HTMLTextAreaElement)
const saveConnectivityButton = element('save-connectivity', HTMLButtonElement)
const discardConnectivityButton = element('discard-connectivity', HTMLButtonElement)
const connectivityStatus = element('connectivity-status', HTMLSpanElement)
const settingsForm = element('settings-form', HTMLFormElement)
const settingsFields = element('settings-fields', HTMLFieldSetElement)
const highRiskInput = element('allow-high-risk', HTMLInputElement)
const irreversibleInput = element('allow-irreversible', HTMLInputElement)
const initializeGenesisInput = element('initialize-genesis-universe', HTMLInputElement)
const allSelectableOperationsInput = element('all-selectable-operations', HTMLInputElement)
const selectableOperationAllowlistInput = element('selectable-operation-allowlist', HTMLTextAreaElement)
const minDelayInput = element('min-delay', HTMLInputElement)
const maxDelayInput = element('max-delay', HTMLInputElement)
const reserveEthInput = element('reserve-eth', HTMLInputElement)
const reserveRepInput = element('reserve-rep', HTMLInputElement)
const maximumEthOperationInput = element('maximum-eth-operation', HTMLInputElement)
const maximumGasCostInput = element('maximum-gas-cost', HTMLInputElement)
const maximumRepOperationInput = element('maximum-rep-operation', HTMLInputElement)
const workflowValidBlocksInput = element('workflow-valid-blocks', HTMLInputElement)
const saveSettingsButton = element('save-settings', HTMLButtonElement)
const discardSettingsButton = element('discard-settings', HTMLButtonElement)
const settingsSaveStatus = element('settings-save-status', HTMLSpanElement)
const signerForm = element('signer-form', HTMLFormElement)
const signerFields = element('signer-fieldset', HTMLFieldSetElement)
const signerSummary = element('signer-summary', HTMLElement)
const privateKeyInput = element('private-key', HTMLInputElement)
const rememberSignerInput = element('remember-signer', HTMLInputElement)
const setSignerButton = element('set-signer-button', HTMLButtonElement)
const clearSignerButton = element('clear-signer-button', HTMLButtonElement)
const signerStatus = element('signer-status', HTMLSpanElement)
const resumeDialog = element('resume-dialog', HTMLDialogElement)
const resumePreflight = element('resume-preflight', HTMLUListElement)
const resumeRandomScopeWarning = element('resume-random-scope-warning', HTMLParagraphElement)
const cancelResume = element('cancel-resume', HTMLButtonElement)
const confirmResume = element('confirm-resume', HTMLButtonElement)

let snapshot: Snapshot | undefined
let configuration: Configuration | undefined
type RefreshResult = { configurationAvailable: boolean; stateAvailable: boolean }
let refreshPromise: Promise<RefreshResult> | undefined
const settingsDraft = createExecutionPolicyDraft({
	fields: settingsFields,
	selectAll: allSelectableOperationsInput,
	allowlist: selectableOperationAllowlistInput,
	discard: discardSettingsButton,
	status: settingsSaveStatus,
	reload: () => {
		if (configuration !== undefined) renderConfiguration(configuration, true)
	},
})
createSettingsNavigation()
const executionModeForm = registerExecutionModeForm({ configuration: () => configuration, put, reconcile: (error, status) => reconcileUnknownMutation(error, status, 'configuration and state', 'settings'), refresh, snapshot: () => snapshot })
let settingsRevision: string | number | undefined
let connectivityDraftDirty = false
let connectivityDraftConflict = false
let connectivityDraftRevision: string | number | undefined
let pauseMutationPending = false
let pauseMutationUnreconciled = false
let settingsMutationUnreconciled = false
let connectivityMutationUnreconciled = false
let signerMutationUnreconciled = false
const retirementDashboard = createRetirementDashboard({ current: () => snapshot, put: async value => await put('/api/retirement', value), refresh: async () => await refresh() })
let configurationCommitIndeterminate = false
let selectionControlsAvailable = false
const selectionControls = createSelectionControls({
	put,
	refresh,
	reconcile: (error, status) => reconcileUnknownMutation(error, status, 'configuration and state', 'settings'),
})
function updateSelectionControls() {
	selectionControls.update({
		available: selectionControlsAvailable,
		frozen: configurationCommitIndeterminate || settingsMutationUnreconciled || pauseMutationUnreconciled,
		paused: configuration?.paused === true && snapshot?.paused === true,
		revision: configuration?.revision,
		selection: configuration?.selectableOperationAllowlist,
		scheduledAt:
			configuration?.paused === false && snapshot?.paused !== true && snapshot?.safetyPaused !== true && snapshot?.scheduler.status === 'scheduled' && (snapshot.retirement?.status === undefined || snapshot.retirement.status === 'inactive') && activeSchedulerWorkLabel(snapshot) === undefined
				? snapshot.scheduler.nextRunAt
				: undefined,
	})
}

const configurationCommitIndeterminateRecoveryMessage = 'Dashboard mutation controls are permanently frozen in this server process and page. Stop the bot, inspect and reload the owner configuration and runtime-state files offline, then restart it before making another mutation.'
const configurationCommitIndeterminateMessage = 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.'

type MutationReconciliationTarget = 'connectivity' | 'pause' | 'settings' | 'signer'

type RecoveryContextRefresh = {
	available: (value: Snapshot) => boolean
	fields: HTMLFieldSetElement
	loadedMessage: string
	missingMessage: string
	name: string
	retryButton: HTMLButtonElement
	status: HTMLSpanElement
}

const pendingRecoveryContextRefreshes = new Set<RecoveryContextRefresh>()

const replacementRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.cancellationHash === undefined,
	fields: replacementFields,
	loadedMessage: 'Current pending intent loaded. Review the transaction hash, then submit again.',
	missingMessage: 'No pending intent is currently actionable for replacement. Recovery controls remain disabled.',
	name: 'pending intent',
	retryButton: replacementRetryButton,
	status: replacementStatus,
}

const cancellationRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.replacementHash === undefined,
	fields: cancellationFields,
	loadedMessage: 'Current pending intent loaded. Review the cancellation details, then submit again.',
	missingMessage: 'No pending intent is currently actionable for cancellation. Recovery controls remain disabled.',
	name: 'pending intent',
	retryButton: cancellationRetryButton,
	status: cancellationStatus,
}

const candidateRecoveryContext: RecoveryContextRefresh = {
	available: value => {
		const intent = value.pendingTransactions[0]
		return value.paused === true && value.pendingTransactions.length === 1 && intent?.hash !== undefined && (intent.replacementHash !== undefined || intent.cancellationHash !== undefined)
	},
	fields: candidateFields,
	loadedMessage: 'Current recovery candidate loaded. Review it, then submit again.',
	missingMessage: 'No queued recovery candidate is available. Candidate controls remain disabled.',
	name: 'recovery candidate',
	retryButton: candidateRetryButton,
	status: candidateStatus,
}

const workflowRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' && value.currentWorkflow.id !== undefined && value.currentWorkflow.updatedAt !== undefined,
	fields: workflowFields,
	loadedMessage: 'Partial workflow loaded. Review it, then submit again.',
	missingMessage: 'No partial workflow awaiting continuation is available. Workflow controls remain disabled.',
	name: 'partial workflow',
	retryButton: workflowRetryButton,
	status: workflowStatus,
}

const obligationRecoveryContext: RecoveryContextRefresh = {
	available: value => {
		const obligation = value.obligations.find(candidate => candidate.id === obligationIdInput.value)
		return value.paused === true && obligation?.id !== undefined && obligation.updatedAt !== undefined
	},
	fields: obligationFields,
	loadedMessage: 'Current lifecycle item loaded. Review it, then submit again.',
	missingMessage: 'No current lifecycle item is available. Lifecycle controls remain disabled.',
	name: 'lifecycle item',
	retryButton: obligationRetryButton,
	status: obligationStatus,
}

const recoveryContexts = [replacementRecoveryContext, cancellationRecoveryContext, candidateRecoveryContext, workflowRecoveryContext, obligationRecoveryContext] as const

async function requestJson(path: string, timeoutMilliseconds: number, init?: RequestInit) {
	let response: Response
	let value: unknown
	try {
		const result = await requestWithTimeout(
			async signal => {
				const response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers }, signal })
				const value: unknown = await response.json()
				return { response, value }
			},
			timeoutMilliseconds,
			'Dashboard request timed out',
		)
		response = result.response
		value = result.value
	} catch (error) {
		if (init?.method !== 'PUT') throw error
		const timedOut = error instanceof Error && (error.name === 'AbortError' || error.message === 'Dashboard request timed out')
		const unknown = new Error(timedOut ? 'The mutation timed out and may have committed.' : 'The mutation response was lost and the change may have committed.')
		unknown.name = 'MutationOutcomeUnknown'
		throw unknown
	}
	if (!response.ok) {
		const responseRecord = record(value)
		const message = stringValue(responseRecord?.['error'])
		const error = new Error(message ?? 'Dashboard request failed')
		if (response.status === 409 && responseRecord?.['code'] === 'configuration_revision_conflict') error.name = 'ConfigurationRevisionConflict'
		if (responseRecord?.['code'] === 'configuration_committed_safely_paused') error.name = 'MutationOutcomeUnknown'
		if (responseRecord?.['code'] === 'configuration_commit_indeterminate') error.name = 'ConfigurationCommitIndeterminate'
		throw error
	}
	return value
}

function transactionIdentifier(hash: string, type: string) {
	return fullIdentifier(hash, type, { explorerUrl: transactionExplorerUrl(configuration?.explorerUrl, hash) })
}

function transactionLine(prefix: string, hash: string | undefined, type: string) {
	const line = node('small', 'identifier-line')
	line.append(node('span', undefined, prefix))
	if (hash === undefined) line.append(node('span', 'mono muted', 'Unavailable'))
	else line.append(transactionIdentifier(hash, type))
	return line
}

function normalizeEcosystem(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
	if (normalized === 'openoracle' || normalized === 'oracle') return 'open-oracle'
	const candidate = normalized ?? 'zoltar'
	return ecosystemOrder.some(ecosystem => ecosystem === candidate) ? candidate : 'zoltar'
}

function ecosystemLabel(value: string | undefined) {
	return ecosystemLabels.get(normalizeEcosystem(value)) ?? 'Zoltar'
}

function operationIsIndependentlyExecutable(value: OperationEvaluation) {
	return value.independentlyExecutable ?? (value.classification === 'selectable' || value.classification === 'lifecycle-obligation')
}

function displayedClassification(value: OperationEvaluation) {
	if (value.classification === 'selectable' && !operationIsIndependentlyExecutable(value)) return 'coverage-alias'
	return value.classification
}

function classificationLabel(value: string | undefined) {
	if (value === 'lifecycle-obligation') return 'Lifecycle obligation'
	if (value === 'excluded-dangerous') return 'Excluded: dangerous'
	if (value === 'role-restricted') return 'Role restricted'
	if (value === 'prerequisite') return 'Workflow prerequisite'
	if (value === 'selectable') return 'Randomly selectable'
	if (value === 'coverage-alias') return 'Coverage alias'
	return 'Classification unavailable'
}

function parsePositiveNumber(value: string | number | undefined) {
	let parsed = Number.NaN
	if (typeof value === 'number') parsed = value
	else if (value !== undefined) parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function publicCandidateCount(value: string | number | undefined) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined
	const count = BigInt(value)
	return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString()
}

function formatDuration(totalSeconds: number) {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const hours = Math.floor(seconds / 3_600)
	const minutes = Math.floor((seconds % 3_600) / 60)
	const remainingSeconds = seconds % 60
	return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}` : `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatRelative(value: string | undefined) {
	if (value === undefined) return 'Waiting for first scan'
	const timestamp = new Date(value).getTime()
	if (!Number.isFinite(timestamp)) return 'Scan time unavailable'
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
	if (seconds < 60) return `Scanned ${seconds.toString()}s ago`
	if (seconds < 3_600) return `Scanned ${Math.floor(seconds / 60).toString()}m ago`
	return `Scanned ${Math.floor(seconds / 3_600).toString()}h ago`
}

function obligationDetail(obligation: Obligation) {
	if (obligation.status === 'deferred' && obligation.notBefore !== undefined && obligation.automaticRetryCount !== undefined && obligation.automaticRetryLimit !== undefined) {
		return `${ecosystemLabel(obligation.ecosystem)} · ${obligation.automaticRetryCount.toString()} of ${obligation.automaticRetryLimit.toString()} included attempts failed · next attempt ${formatDate(obligation.notBefore)}`
	}
	if (obligation.status === 'deferred') return `${ecosystemLabel(obligation.ecosystem)} · tracked, not currently actionable`
	return `${ecosystemLabel(obligation.ecosystem)} · due ${formatDate(obligation.dueAt)}`
}

function applyMutationControlLatches() {
	updateSelectionControls()
	if (pauseMutationUnreconciled || configurationCommitIndeterminate) pauseButton.disabled = true
	if (settingsMutationUnreconciled || configurationCommitIndeterminate) {
		settingsFields.disabled = true
		executionModeForm.lock()
	}
	if (connectivityMutationUnreconciled || configurationCommitIndeterminate) connectivityFields.disabled = true
	if (signerMutationUnreconciled || configurationCommitIndeterminate) signerFields.disabled = true
	if (!configurationCommitIndeterminate) return
	confirmResume.disabled = true
	for (const fields of [replacementFields, cancellationFields, candidateFields, workflowFields, obligationFields]) fields.disabled = true
}

function setMutationReconciliationPending(target: MutationReconciliationTarget) {
	if (target === 'connectivity') connectivityMutationUnreconciled = true
	else if (target === 'pause') pauseMutationUnreconciled = true
	else if (target === 'settings') settingsMutationUnreconciled = true
	else signerMutationUnreconciled = true
	applyMutationControlLatches()
}

function resolveMutationReconciliations() {
	if (configurationCommitIndeterminate) {
		applyMutationControlLatches()
		return
	}
	const reconciliationMessage = 'The request outcome was unknown. Current configuration and state were reloaded; review it before another mutation.'
	if (pauseMutationUnreconciled) {
		pauseMutationUnreconciled = false
		pauseStatus.textContent = reconciliationMessage
	}
	if (settingsMutationUnreconciled) {
		settingsMutationUnreconciled = false
		settingsSaveStatus.textContent = reconciliationMessage
	}
	if (connectivityMutationUnreconciled) {
		connectivityMutationUnreconciled = false
		connectivityStatus.textContent = reconciliationMessage
	}
	if (signerMutationUnreconciled) {
		signerMutationUnreconciled = false
		signerStatus.textContent = reconciliationMessage
	}
	if (snapshot !== undefined) renderHeader(snapshot)
	if (configuration !== undefined) renderConfiguration(configuration)
}

function latchConfigurationCommitIndeterminate(status?: HTMLElement, message = configurationCommitIndeterminateMessage) {
	configurationCommitIndeterminate = true
	const recovery = `${message} ${configurationCommitIndeterminateRecoveryMessage}`
	if (status !== undefined) status.textContent = recovery
	configurationStatus.textContent = recovery
	configurationStatus.className = 'notice error'
	applyMutationControlLatches()
}

function recoveryItemCount(value: Snapshot) {
	const selectableContinuation = value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' ? 1 : 0
	return value.pendingTransactions.length + value.obligations.length + selectableContinuation
}

const operationDialog = createOperationDialog({ request: value => put('/api/operation', value, 120_000) })

const renderCatalogGroups = createCatalogGroups(catalogRows, ecosystemOrder, ecosystemLabel)
const catalogRowCache = new Map<string, { row: HTMLTableRowElement; signature: string }>()
let catalogSignature = ''

const topologyGroupSignatures = new WeakMap<HTMLDivElement, string>()

function renderSnapshot(value: Snapshot) {
	renderHeader(value)
	renderOverview(value)
	renderCatalog(value.operationEvaluations)
	renderEcosystems(value.operationEvaluations)
	renderTopology(value.topology)
	renderRecovery(value)
	renderActivities(value.activities, configuration?.explorerUrl)
	renderOperatorAlerts(operatorAlerts, value.alerts)
	renderCountdown()
	applyMutationControlLatches()
}

function markRecoveryContextRefreshesLoading() {
	for (const context of pendingRecoveryContextRefreshes) {
		context.fields.disabled = true
		context.retryButton.classList.remove('hidden')
		context.retryButton.disabled = true
		context.retryButton.textContent = 'Refreshing…'
		context.status.textContent = `Loading the current ${context.name}…`
	}
}

function settleRecoveryContextRefreshes(value: Snapshot | undefined) {
	for (const context of pendingRecoveryContextRefreshes) {
		if (value === undefined) {
			context.fields.disabled = true
			context.retryButton.classList.remove('hidden')
			context.retryButton.disabled = false
			context.retryButton.textContent = 'Retry'
			context.status.textContent = `The current ${context.name} is unavailable because dashboard state could not be refreshed.`
			continue
		}
		context.retryButton.classList.add('hidden')
		context.retryButton.disabled = false
		context.retryButton.textContent = 'Retry'
		if (context.available(value)) context.status.textContent = context.loadedMessage
		else {
			context.fields.disabled = true
			context.status.textContent = context.missingMessage
		}
		pendingRecoveryContextRefreshes.delete(context)
	}
}

async function requestRecoveryContextRefresh(context: RecoveryContextRefresh) {
	pendingRecoveryContextRefreshes.add(context)
	context.fields.disabled = true
	context.status.textContent = `Loading the current ${context.name}…`
	await refresh()
}

function refresh() {
	if (refreshPromise !== undefined) return refreshPromise
	markRecoveryContextRefreshesLoading()
	rpcHealthRetryButton.disabled = true
	rpcHealthRetryButton.textContent = 'Refreshing…'
	let stateAvailable = false
	let configurationAvailable = false
	refreshPromise = (async () => {
		const [stateResult, configurationResult] = await Promise.allSettled([requestJson('/api/state', stateRequestTimeoutMilliseconds), requestJson('/api/configuration', configurationRequestTimeoutMilliseconds)])
		// Transaction explorer links come from the configuration, so it must be current before the state renders.
		const parsedConfiguration = configurationResult.status === 'fulfilled' ? parseConfiguration(configurationResult.value) : undefined
		if (parsedConfiguration !== undefined) configuration = parsedConfiguration
		if (stateResult.status === 'fulfilled') {
			snapshot = parseSnapshot(stateResult.value)
			renderSnapshot(snapshot)
			stateAvailable = true
			globalError.classList.add('hidden')
			settleRecoveryContextRefreshes(snapshot)
		} else {
			renderUnavailableRpcHealth(snapshot !== undefined)
			renderUnavailableSubmissionHealth(snapshot !== undefined)
			globalError.textContent = stateResult.reason instanceof Error ? stateResult.reason.message : 'Dashboard state is unavailable.'
			globalError.classList.remove('hidden')
			settleRecoveryContextRefreshes(undefined)
		}
		if (parsedConfiguration !== undefined) {
			renderConfiguration(parsedConfiguration)
			configurationAvailable = true
			if (!configurationCommitIndeterminate) configurationStatus.classList.add('hidden')
		} else {
			settingsFields.disabled = true
			configurationStatus.textContent = configurationResult.status === 'rejected' && configurationResult.reason instanceof Error ? configurationResult.reason.message : 'Configuration is unavailable.'
			configurationStatus.className = 'notice error'
		}
		selectionControlsAvailable = stateAvailable && configurationAvailable
		if (stateAvailable && configurationAvailable) {
			resolveMutationReconciliations()
		}
		applyMutationControlLatches()
		return { configurationAvailable, stateAvailable }
	})().finally(() => {
		refreshPromise = undefined
		rpcHealthRetryButton.disabled = false
		rpcHealthRetryButton.textContent = 'Retry'
	})
	return refreshPromise
}

async function reconcileUnknownMutation(error: unknown, status: HTMLElement, scope: 'configuration and state' | 'state', target?: MutationReconciliationTarget) {
	if (error instanceof Error && error.name === 'ConfigurationCommitIndeterminate') {
		latchConfigurationCommitIndeterminate(status, error.message)
		return { handled: true, reconciled: false }
	}
	if (!(error instanceof Error) || error.name !== 'MutationOutcomeUnknown') return { handled: false, reconciled: false }
	if (target !== undefined) setMutationReconciliationPending(target)
	status.textContent = `${error.message} Controls remain frozen while the dashboard reloads current ${scope}.`
	const activeRefresh = refreshPromise
	if (activeRefresh !== undefined) await activeRefresh
	const result = await refresh()
	const reconciled = scope === 'state' ? result.stateAvailable : result.configurationAvailable && result.stateAvailable
	const verb = scope === 'configuration and state' ? 'were' : 'was'
	status.textContent = reconciled ? `The request outcome was unknown. Current ${scope} ${verb} reloaded; review it before another mutation.` : `The request outcome is still unknown because current ${scope} could not be reloaded. Controls remain frozen while automatic refresh retries.`
	return { handled: true, reconciled }
}

async function put(path: string, value: unknown, timeoutMilliseconds = configurationRequestTimeoutMilliseconds) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Dashboard mutation body is not serializable')
	return await requestJson(path, timeoutMilliseconds, {
		body,
		headers: { 'content-type': 'application/json' },
		method: 'PUT',
	})
}

async function mutatePaused(paused: boolean) {
	pauseMutationPending = true
	pauseStatus.textContent = paused ? 'Pausing…' : 'Resuming…'
	if (snapshot !== undefined) renderHeader(snapshot)
	try {
		await put('/api/paused', { paused, revision: configuration?.revision })
		pauseStatus.textContent = paused ? 'Pause saved.' : 'Resume saved.'
		await refresh()
		pauseStatus.textContent = ''
	} catch (error) {
		const reconciliation = await reconcileUnknownMutation(error, pauseStatus, 'configuration and state', 'pause')
		if (!reconciliation.handled) pauseStatus.textContent = error instanceof Error ? error.message : 'Pause control failed.'
		else pauseMutationUnreconciled = !reconciliation.reconciled
	} finally {
		pauseMutationPending = false
		if (snapshot !== undefined) renderHeader(snapshot)
	}
}

function openResumeDialog() {
	const value = snapshot
	if (value === undefined) return
	const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
	const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true).length
	const signerDetail = value.signerReady === true && value.wallet !== undefined ? fullIdentifier(value.wallet, 'recovery signer address') : 'Missing'
	const selectionPolicy = configuration?.selectableOperationAllowlist
	let randomScope: HTMLElement | string = 'Unavailable — keep paused'
	if (selectionPolicy === null) randomScope = 'ALL selectable operations'
	else if (Array.isArray(selectionPolicy)) {
		if (selectionPolicy.length === 0) randomScope = 'Lifecycle only — no random novelty'
		else {
			const scope = node('span', 'resume-random-scope')
			scope.append(node('span', undefined, `${selectionPolicy.length.toString()}-ID canary`), node('small', 'mono resume-random-scope-ids', selectionPolicy.join('\n')))
			randomScope = scope
		}
	}
	const rows: [string, HTMLElement | string][] = [
		['Mode', value.execute === true ? 'Live execution' : 'Dry run'],
		['Signer', signerDetail],
		['Eligible executable operations', `${eligible.toString()} of ${executable.length.toString()}`],
		['Random novelty scope', randomScope],
		['Recovery items', recoveryItemCount(value).toString()],
		['Safety latch', value.safetyPaused === true ? 'Active' : 'Clear'],
	]
	resumePreflight.replaceChildren(
		...rows.map(([label, detail]) => {
			const row = node('li')
			const detailValue = node('strong')
			detailValue.append(typeof detail === 'string' ? document.createTextNode(detail) : detail)
			row.append(node('span', undefined, label), detailValue)
			return row
		}),
	)
	const unrestricted = selectionPolicy === null
	let randomScopeWarning = ''
	if (unrestricted) randomScopeWarning = 'Random novelty is unrestricted. Any due eligible selectable operation may run immediately after resume.'
	else if (selectionPolicy === undefined) randomScopeWarning = 'The current random-selection policy is unavailable. Reload configuration before resuming.'
	resumeRandomScopeWarning.classList.toggle('hidden', !unrestricted && selectionPolicy !== undefined)
	resumeRandomScopeWarning.textContent = randomScopeWarning
	confirmResume.disabled = selectionPolicy === undefined
	confirmResume.textContent = unrestricted ? 'Resume unrestricted bot' : 'Resume bot'
	resumeDialog.showModal()
	cancelResume.focus()
}

function parseDelay(input: HTMLInputElement, name: string) {
	const value = Number(input.value)
	if (!Number.isInteger(value) || value < 60 || value > 3_600) throw new Error(`${name} must be a whole number from 60 through 3600 seconds.`)
	return value
}

function parseReserve(input: HTMLInputElement, name: string, requirement: 'live-reserve' | 'non-negative' | 'positive' = 'non-negative') {
	const value = input.value.trim()
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${name} must be a non-negative decimal amount with at most 18 places.`)
	if (requirement !== 'non-negative' && /^0(?:\.0+)?$/.test(value)) throw new Error(`${name} must be greater than zero${requirement === 'live-reserve' ? ' for live execution' : ''}.`)
	return value
}

let currentSectionLink: HTMLAnchorElement | undefined
const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>('.section-nav a[href^="/"]')]

function showDashboardPage(pathname: string, push = false) {
	const page = pathname === '/' ? 'overview' : pathname.replace(/^\//, '').replace(/\/$/, '')
	document.body.dataset['page'] = page
	for (const link of sectionLinks) markCurrentPage(link, new URL(link.href).pathname.replace(/\/$/, '') === `/${page}`)
	const activeLink = sectionLinks.find(link => link.hasAttribute('aria-current'))
	const navigation = activeLink?.closest<HTMLElement>('.section-nav')
	if (activeLink !== undefined && navigation !== null && navigation !== undefined) {
		window.requestAnimationFrame(() => {
			navigation.scrollLeft = activeLink.offsetLeft - (navigation.clientWidth - activeLink.offsetWidth) / 2
		})
	}
	if (push) window.history.pushState({}, '', `/${page}`)
	window.scrollTo({ top: 0 })
}

for (const link of sectionLinks) {
	if ((link instanceof HTMLAnchorElement && new URL(link.href).pathname === window.location.pathname.replace(/\/$/, '')) || (window.location.pathname === '/' && link instanceof HTMLAnchorElement && new URL(link.href).pathname === '/overview')) {
		link.setAttribute('aria-current', 'page')
		currentSectionLink = link
	}
	link.addEventListener('click', event => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
		showDashboardPage(new URL(link.href).pathname, true)
	})
}
window.addEventListener('popstate', () => showDashboardPage(window.location.pathname))

if (currentSectionLink !== undefined) {
	const link = currentSectionLink
	window.requestAnimationFrame(() => {
		const navigation = link.closest('.section-nav')
		if (!(navigation instanceof HTMLElement)) return
		const navigationBounds = navigation.getBoundingClientRect()
		const linkBounds = link.getBoundingClientRect()
		const centeredScrollLeft = navigation.scrollLeft + linkBounds.left - navigationBounds.left - (navigation.clientWidth - linkBounds.width) / 2
		const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
		navigation.scrollLeft = Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft))
	})
}

rpcHealthRetryButton.addEventListener('click', () => void refresh())
for (const context of recoveryContexts) context.retryButton.addEventListener('click', () => void requestRecoveryContextRefresh(context))
catalogFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
catalogClassificationFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
catalogEligibilityFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
pauseButton.addEventListener('click', () => {
	if (snapshot?.paused === true) openResumeDialog()
	else void mutatePaused(true)
})
cancelResume.addEventListener('click', () => resumeDialog.close())
confirmResume.addEventListener('click', () => {
	resumeDialog.close()
	void mutatePaused(false)
})

replacementForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intentHash = snapshot?.pendingTransactions[0]?.hash
		const replacementHash = replacementHashInput.value.trim()
		if (snapshot?.paused !== true) {
			replacementStatus.textContent = 'Pause the bot before queuing verification.'
			return
		}
		if (intentHash === undefined) {
			await requestRecoveryContextRefresh(replacementRecoveryContext)
			return
		}
		if (!/^0x[0-9a-fA-F]{64}$/.test(replacementHash)) {
			replacementStatus.textContent = 'Enter a 32-byte transaction hash.'
			return
		}
		replacementFields.disabled = true
		replacementStatus.textContent = 'Queuing verification…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/replacement', {
				intentHash,
				replacementHash,
			})
			replacementHashInput.value = ''
			replacementStatus.textContent = 'Replacement verification queued.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, replacementStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) replacementStatus.textContent = error instanceof Error ? error.message : 'Could not queue replacement verification.'
		} finally {
			replacementFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.cancellationHash !== undefined
		}
	})()
})

cancellationForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intentHash = snapshot?.pendingTransactions[0]?.hash
		const cancellationHash = cancellationHashInput.value.trim()
		if (snapshot?.paused !== true) {
			cancellationStatus.textContent = 'Pause the bot before queuing cancellation verification.'
			return
		}
		if (intentHash === undefined) {
			await requestRecoveryContextRefresh(cancellationRecoveryContext)
			return
		}
		if (!/^0x[0-9a-fA-F]{64}$/.test(cancellationHash)) {
			cancellationStatus.textContent = 'Enter a 32-byte transaction hash.'
			return
		}
		const reason = cancellationReasonInput.value.trim()
		if (reason.length < 12) {
			cancellationStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		cancellationFields.disabled = true
		cancellationStatus.textContent = 'Queuing verification…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/cancellation', {
				cancellationHash,
				confirmation: cancellationConfirmationInput.value,
				intentHash,
				reason,
			})
			cancellationHashInput.value = ''
			cancellationReasonInput.value = ''
			cancellationConfirmationInput.value = ''
			cancellationStatus.textContent = 'Nonce cancellation verification queued.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, cancellationStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) cancellationStatus.textContent = error instanceof Error ? error.message : 'Could not queue nonce cancellation verification.'
		} finally {
			cancellationFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.replacementHash !== undefined
		}
	})()
})

candidateForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intent = snapshot?.pendingTransactions[0]
		const expectedCandidateHash = intent?.replacementHash ?? intent?.cancellationHash
		if (snapshot?.paused !== true) {
			candidateStatus.textContent = 'Pause the bot before clearing a recovery candidate.'
			return
		}
		if (intent?.hash === undefined || expectedCandidateHash === undefined) {
			await requestRecoveryContextRefresh(candidateRecoveryContext)
			return
		}
		const reason = candidateReasonInput.value.trim()
		if (reason.length < 12) {
			candidateStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		candidateFields.disabled = true
		candidateStatus.textContent = 'Clearing candidate…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/candidate', {
				confirmation: candidateConfirmationInput.value,
				expectedCandidateHash,
				intentHash: intent.hash,
				reason,
			})
			candidateReasonInput.value = ''
			candidateConfirmationInput.value = ''
			candidateStatus.textContent = 'Recovery candidate cleared.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, candidateStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) candidateStatus.textContent = error instanceof Error ? error.message : 'Could not clear the recovery candidate.'
		} finally {
			const candidate = snapshot?.pendingTransactions[0]?.replacementHash ?? snapshot?.pendingTransactions[0]?.cancellationHash
			candidateFields.disabled = !mutationReconciled || snapshot?.paused !== true || candidate === undefined
		}
	})()
})

workflowForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const workflow = snapshot?.currentWorkflow
		if (snapshot?.paused !== true) {
			workflowStatus.textContent = 'Pause the bot before workflow reconciliation.'
			return
		}
		if (workflow?.status !== 'waiting-continuation' || workflow.id === undefined || workflow.updatedAt === undefined) {
			await requestRecoveryContextRefresh(workflowRecoveryContext)
			return
		}
		const reason = workflowReasonInput.value.trim()
		if (reason.length < 12) {
			workflowStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		workflowFields.disabled = true
		workflowStatus.textContent = 'Saving reconciliation…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/workflow', {
				action: 'abandon',
				confirmation: workflowConfirmationInput.value,
				reason,
				updatedAt: workflow.updatedAt,
				workflowId: workflow.id,
			})
			workflowReasonInput.value = ''
			workflowConfirmationInput.value = ''
			workflowStatus.textContent = 'Partial workflow abandonment saved.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, workflowStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) workflowStatus.textContent = error instanceof Error ? error.message : 'Partial workflow reconciliation failed.'
		} finally {
			workflowFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.currentWorkflow?.status !== 'waiting-continuation'
		}
	})()
})

function renderObligationConfirmationHelp() {
	const confirmation = obligationActionInput.value === 'abandon' ? 'ABANDON OBLIGATION' : 'RETRY VERIFIED SAFE FAILURE'
	obligationConfirmationHelp.textContent = `Type ${confirmation}. ${obligationActionInput.value === 'abandon' ? 'This creates a permanent tombstone and transfers responsibility to the operator.' : 'Retry is limited to unsigned failures, canonically included reverts, and verified nonce cancellations; semantic uncertainty still requires manual reconciliation.'}`
}

obligationActionInput.addEventListener('change', renderObligationConfirmationHelp)
renderObligationConfirmationHelp()
obligationForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const obligation = snapshot?.obligations.find(candidate => candidate.id === obligationIdInput.value)
		if (snapshot?.paused !== true) {
			obligationStatus.textContent = 'Pause the bot before lifecycle reconciliation.'
			return
		}
		if (obligation?.id === undefined || obligation.updatedAt === undefined) {
			await requestRecoveryContextRefresh(obligationRecoveryContext)
			return
		}
		const action = obligationActionInput.value
		if (action !== 'retry' && action !== 'abandon') {
			obligationStatus.textContent = 'Choose a valid lifecycle action.'
			return
		}
		const reason = obligationReasonInput.value.trim()
		if (reason.length < 12) {
			obligationStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		obligationFields.disabled = true
		obligationStatus.textContent = 'Saving reconciliation…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/obligation', {
				action,
				confirmation: obligationConfirmationInput.value,
				obligationId: obligation.id,
				reason,
				updatedAt: obligation.updatedAt,
			})
			obligationReasonInput.value = ''
			obligationConfirmationInput.value = ''
			obligationStatus.textContent = 'Lifecycle reconciliation saved.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, obligationStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) obligationStatus.textContent = error instanceof Error ? error.message : 'Lifecycle reconciliation failed.'
		} finally {
			obligationFields.disabled = !mutationReconciled || snapshot?.paused !== true || (snapshot?.obligations.length ?? 0) === 0
		}
	})()
})

connectivityFields.addEventListener('input', () => {
	if (!connectivityDraftDirty) connectivityDraftRevision = configuration?.revision
	connectivityDraftDirty = true
	discardConnectivityButton.disabled = false
})
discardConnectivityButton.addEventListener('click', () => {
	connectivityDraftDirty = false
	connectivityDraftConflict = false
	connectivityDraftRevision = configuration?.revision
	readRpcUrlInput.value = configuration?.connectivity?.readRpcUrl ?? ''
	quorumRpcUrlsInput.value = configuration?.connectivity?.quorumRpcUrls.join('\n') ?? ''
	publicRpcUrlsInput.value = configuration?.connectivity?.publicRpcUrls.join('\n') ?? ''
	if (configuration?.rpcQuorum === 1 || configuration?.rpcQuorum === 2) rpcQuorumInput.value = String(configuration.rpcQuorum)
	saveConnectivityButton.disabled = false
	discardConnectivityButton.disabled = true
	connectivityStatus.textContent = 'RPC draft discarded. The saved endpoint set has been restored.'
})
connectivityForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		if (connectivityDraftConflict) {
			connectivityStatus.textContent = 'Discard this RPC draft and review the current configuration before saving.'
			return
		}
		const lines = (value: string) =>
			value
				.split('\n')
				.map(entry => entry.trim())
				.filter(entry => entry !== '')
		const publicRpcUrls = lines(publicRpcUrlsInput.value)
		if (publicRpcUrls.length === 0) {
			connectivityStatus.textContent = 'Enter at least one public submission RPC.'
			return
		}
		connectivityFields.disabled = true
		connectivityStatus.textContent = 'Checking every RPC from the chaos-bot server…'
		let mutationReconciled = true
		try {
			await put(
				'/api/connectivity',
				{
					connectivity: {
						publicRpcUrls,
						quorumRpcUrls: lines(quorumRpcUrlsInput.value),
						readRpcUrl: readRpcUrlInput.value.trim(),
						rpcQuorum: Number(rpcQuorumInput.value),
					},
					revision: connectivityDraftRevision,
				},
				connectivityMutationTimeoutMilliseconds,
			)
			connectivityDraftDirty = false
			connectivityDraftConflict = false
			connectivityDraftRevision = undefined
			connectivityStatus.textContent = 'Chain and RPCs passed server-side validation and were saved.'
			await refresh()
		} catch (error) {
			if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
				connectivityDraftConflict = true
				saveConnectivityButton.disabled = true
				discardConnectivityButton.disabled = false
				await refresh()
			}
			const reconciliation = await reconcileUnknownMutation(error, connectivityStatus, 'configuration and state', 'connectivity')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (reconciliation.handled) {
				connectivityDraftConflict = true
				saveConnectivityButton.disabled = true
				discardConnectivityButton.disabled = false
			} else if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
				connectivityStatus.textContent = 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.'
			} else connectivityStatus.textContent = error instanceof Error ? error.message : 'RPC settings could not be saved.'
		} finally {
			connectivityFields.disabled = !mutationReconciled || configurationCommitIndeterminate
		}
	})()
})

settingsForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		if (configuration?.paused !== true || snapshot?.paused !== true) {
			settingsSaveStatus.textContent = 'Pause the bot before changing execution policy.'
			settingsFields.disabled = true
			return
		}
		if (settingsDraft.conflict) {
			settingsSaveStatus.textContent = 'Discard these edits and review the current configuration before saving.'
			return
		}
		settingsFields.disabled = true
		settingsSaveStatus.textContent = 'Saving…'
		let mutationReconciled = true
		try {
			const minDelaySeconds = parseDelay(minDelayInput, 'Minimum delay')
			const maxDelaySeconds = parseDelay(maxDelayInput, 'Maximum delay')
			if (minDelaySeconds >= maxDelaySeconds) throw new Error('Minimum delay must be at least one second less than maximum delay.')
			const workflowValidForBlocks = Number(workflowValidBlocksInput.value)
			if (!Number.isSafeInteger(workflowValidForBlocks) || workflowValidForBlocks < 243 || workflowValidForBlocks > 1_000_000) throw new Error('Workflow validity must be a whole number from 243 through 1000000 blocks.')
			const enabledEcosystems = [...document.querySelectorAll('[data-ecosystem-toggle]')].flatMap(toggle => {
				if (!(toggle instanceof HTMLInputElement) || !toggle.checked || toggle.dataset['ecosystemToggle'] === undefined) return []
				return [toggle.dataset['ecosystemToggle']]
			})
			if (enabledEcosystems.length === 0) throw new Error('Enable at least one ecosystem.')
			const selectableOperationAllowlist = allSelectableOperationsInput.checked
				? null
				: (() => {
						const operationIds = selectableOperationAllowlistInput.value
							.split(/[\n,]/)
							.map(value => value.trim())
							.filter(value => value !== '')
						if (new Set(operationIds).size !== operationIds.length) throw new Error('Selectable operation allowlist must not contain duplicate definition IDs.')
						const selectableIds = new Set(snapshot?.operationEvaluations.flatMap(operation => (operation.classification === 'selectable' && operationIsIndependentlyExecutable(operation) && operation.id !== undefined ? [operation.id] : [])) ?? [])
						const unknown = operationIds.find(operationId => !selectableIds.has(operationId))
						if (unknown !== undefined) throw new Error(`Unknown independently selectable operation definition ID ${unknown}. Copy the exact ID from Operation catalog.`)
						return operationIds
					})()
			const maximumEthPerOperation = parseReserve(maximumEthOperationInput, 'Maximum ETH per operation', 'positive')
			const maximumGasCostEth = parseReserve(maximumGasCostInput, 'Maximum gas cost', 'positive')
			const maximumRepPerOperation = parseReserve(maximumRepOperationInput, 'Maximum REP per operation', 'positive')
			// The saved execution mode decides the reserve rules; the mode itself changes only through the Execution mode panel.
			const live = configuration.execute === true
			const minimumEthReserve = parseReserve(reserveEthInput, 'ETH reserve', live ? 'live-reserve' : 'non-negative')
			const minimumRepReserve = parseReserve(reserveRepInput, 'REP reserve', live ? 'live-reserve' : 'non-negative')
			if (live && decimalAtto(minimumEthReserve) < decimalAtto(maximumGasCostEth)) throw new Error('ETH reserve must retain at least one maximum-gas-cost-sized safety floor.')
			await put('/api/settings', {
				revision: settingsRevision,
				patch: {
					runtime: { execute: live },
					scheduler: { maximumDelaySeconds: maxDelaySeconds, minimumDelaySeconds: minDelaySeconds },
					strategy: {
						allowHighRiskOperations: highRiskInput.checked,
						allowIrreversibleOperations: irreversibleInput.checked,
						initializeGenesisUniverse: initializeGenesisInput.checked,
						enabledEcosystems,
						maximumEthPerOperation,
						maximumGasCostEth,
						maximumRepPerOperation,
						minimumEthReserve,
						minimumRepReserve,
						selectableOperationAllowlist,
						workflowValidForBlocks,
					},
				},
			})
			settingsDraft.dirty = false
			settingsDraft.conflict = false
			settingsSaveStatus.textContent = 'Execution policy saved.'
			await refresh()
			if (configuration !== undefined) renderConfiguration(configuration, true)
		} catch (error) {
			if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
				settingsDraft.conflict = true
				saveSettingsButton.disabled = true
				discardSettingsButton.disabled = false
				await refresh()
			}
			const reconciliation = await reconcileUnknownMutation(error, settingsSaveStatus, 'configuration and state', 'settings')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (reconciliation.handled) {
				settingsDraft.conflict = true
				saveSettingsButton.disabled = true
				discardSettingsButton.disabled = false
			} else settingsSaveStatus.textContent = error instanceof Error ? error.message : 'Settings could not be saved.'
		} finally {
			settingsFields.disabled = !mutationReconciled || configuration === undefined || configuration.paused !== true || snapshot?.paused !== true
		}
	})()
})

privateKeyInput.addEventListener('input', () => setSignerButton.toggleAttribute('disabled', privateKeyInput.value.trim() === ''))

signerForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const privateKey = privateKeyInput.value.trim()
		if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
			signerStatus.textContent = 'Enter a 32-byte 0x-prefixed private key.'
			return
		}
		signerFields.disabled = true
		signerStatus.textContent = 'Updating signer…'
		const remember = rememberSignerInput.checked
		privateKeyInput.value = ''
		let mutationReconciled = true
		try {
			await put('/api/signer', { privateKey, remember, revision: configuration?.revision })
			signerStatus.textContent = 'Signer updated. The input was cleared.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, signerStatus, 'configuration and state', 'signer')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) signerStatus.textContent = error instanceof Error ? error.message : 'Signer could not be updated.'
		} finally {
			privateKeyInput.value = ''
			signerFields.disabled = !mutationReconciled
		}
	})()
})

clearSignerButton.addEventListener('click', () => {
	void (async () => {
		signerFields.disabled = true
		signerStatus.textContent = 'Clearing signer…'
		let mutationReconciled = true
		try {
			await put('/api/signer', { privateKey: null, remember: false, revision: configuration?.revision })
			privateKeyInput.value = ''
			rememberSignerInput.checked = false
			signerStatus.textContent = 'Signer cleared. Execution remains blocked until a signer is configured.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, signerStatus, 'configuration and state', 'signer')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) signerStatus.textContent = error instanceof Error ? error.message : 'Signer could not be cleared.'
		} finally {
			signerFields.disabled = !mutationReconciled
		}
	})()
})

window.addEventListener('focus', () => void refresh())
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') void refresh()
})
window.setInterval(renderCountdown, 1_000)
window.setInterval(() => void refresh(), stateRefreshMilliseconds)
void refresh()
