import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import type { Configuration } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { operationIsIndependentlyExecutable } from './dashboard-format.ts'
import type { ReconcileUnknownMutation } from './dashboard-refresh.ts'
import type { DashboardPut } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import type { createExecutionPolicyDraft } from './execution-policy-draft.js'
import { executionPolicyReviewRows, type ExecutionPolicyPatch } from './execution-policy-review.js'
import { decimalAtto } from './go-live.js'

const connectivityMutationTimeoutMilliseconds = 30_000

type SettingsFormsContext = {
	state: DashboardState
	elements: DashboardElements
	settingsDraft: ReturnType<typeof createExecutionPolicyDraft>
	put: DashboardPut
	refresh: () => Promise<unknown>
	reconcileUnknownMutation: ReconcileUnknownMutation
	renderConfiguration: (value: Configuration, force?: boolean) => void
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

/** Registers the RPC connectivity, execution policy, and signer forms on the settings page. */
export function registerSettingsForms({ state, elements, settingsDraft, put, refresh, reconcileUnknownMutation, renderConfiguration }: SettingsFormsContext) {
	const { connectivityFields, discardConnectivityButton, saveConnectivityButton, connectivityStatus, readRpcUrlInput, quorumRpcUrlsInput, publicRpcUrlsInput, rpcQuorumInput } = elements
	connectivityFields.addEventListener('input', () => {
		if (!state.connectivityDraftDirty) state.connectivityDraftRevision = state.configuration?.revision
		state.connectivityDraftDirty = true
		discardConnectivityButton.disabled = false
	})
	discardConnectivityButton.addEventListener('click', () => {
		const { configuration } = state
		state.connectivityDraftDirty = false
		state.connectivityDraftConflict = false
		state.connectivityDraftRevision = configuration?.revision
		readRpcUrlInput.value = configuration?.connectivity?.readRpcUrl ?? ''
		quorumRpcUrlsInput.value = configuration?.connectivity?.quorumRpcUrls.join('\n') ?? ''
		publicRpcUrlsInput.value = configuration?.connectivity?.publicRpcUrls.join('\n') ?? ''
		if (configuration?.rpcQuorum === 1 || configuration?.rpcQuorum === 2) rpcQuorumInput.value = String(configuration.rpcQuorum)
		saveConnectivityButton.disabled = false
		discardConnectivityButton.disabled = true
		connectivityStatus.textContent = 'RPC draft discarded. The saved endpoint set has been restored.'
	})
	elements.connectivityForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			if (state.connectivityDraftConflict) {
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
						revision: state.connectivityDraftRevision,
					},
					connectivityMutationTimeoutMilliseconds,
				)
				state.connectivityDraftDirty = false
				state.connectivityDraftConflict = false
				state.connectivityDraftRevision = undefined
				connectivityStatus.textContent = 'Chain and RPCs passed server-side validation and were saved.'
				await refresh()
			} catch (error) {
				if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
					state.connectivityDraftConflict = true
					saveConnectivityButton.disabled = true
					discardConnectivityButton.disabled = false
					await refresh()
				}
				const reconciliation = await reconcileUnknownMutation(error, connectivityStatus, 'configuration and state', 'connectivity')
				mutationReconciled = !reconciliation.handled || reconciliation.reconciled
				if (reconciliation.handled) {
					state.connectivityDraftConflict = true
					saveConnectivityButton.disabled = true
					discardConnectivityButton.disabled = false
				} else if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
					connectivityStatus.textContent = 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.'
				} else connectivityStatus.textContent = error instanceof Error ? error.message : 'RPC settings could not be saved.'
			} finally {
				connectivityFields.disabled = !mutationReconciled || state.configurationCommitIndeterminate
			}
		})()
	})

	const { settingsFields, settingsSaveStatus, saveSettingsButton, discardSettingsButton } = elements
	elements.settingsForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const { configuration, snapshot } = state
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
				const minDelaySeconds = parseDelay(elements.minDelayInput, 'Minimum delay')
				const maxDelaySeconds = parseDelay(elements.maxDelayInput, 'Maximum delay')
				if (minDelaySeconds >= maxDelaySeconds) throw new Error('Minimum delay must be at least one second less than maximum delay.')
				const workflowValidForBlocks = Number(elements.workflowValidBlocksInput.value)
				if (!Number.isSafeInteger(workflowValidForBlocks) || workflowValidForBlocks < 243 || workflowValidForBlocks > 1_000_000) throw new Error('Workflow validity must be a whole number from 243 through 1000000 blocks.')
				const enabledEcosystems = [...document.querySelectorAll('[data-ecosystem-toggle]')].flatMap(toggle => {
					if (!(toggle instanceof HTMLInputElement) || !toggle.checked || toggle.dataset['ecosystemToggle'] === undefined) return []
					return [toggle.dataset['ecosystemToggle']]
				})
				if (enabledEcosystems.length === 0) throw new Error('Enable at least one ecosystem.')
				const selectableOperationAllowlist = elements.allSelectableOperationsInput.checked
					? null
					: (() => {
							const operationIds = elements.selectableOperationAllowlistInput.value
								.split(/[\n,]/)
								.map(value => value.trim())
								.filter(value => value !== '')
							if (new Set(operationIds).size !== operationIds.length) throw new Error('Selectable operation allowlist must not contain duplicate definition IDs.')
							const selectableIds = new Set(state.snapshot?.operationEvaluations.flatMap(operation => (operation.classification === 'selectable' && operationIsIndependentlyExecutable(operation) && operation.id !== undefined ? [operation.id] : [])) ?? [])
							const unknown = operationIds.find(operationId => !selectableIds.has(operationId))
							if (unknown !== undefined) throw new Error(`Unknown independently selectable operation definition ID ${unknown}. Copy the exact ID from Operation catalog.`)
							return operationIds
						})()
				const maximumEthPerOperation = parseReserve(elements.maximumEthOperationInput, 'Maximum ETH per operation', 'positive')
				const maximumGasCostEth = parseReserve(elements.maximumGasCostInput, 'Maximum gas cost', 'positive')
				const maximumRepPerOperation = parseReserve(elements.maximumRepOperationInput, 'Maximum REP per operation', 'positive')
				// The saved execution mode decides the reserve rules; the mode itself changes only through the Execution mode panel.
				const live = configuration.execute === true
				const minimumEthReserve = parseReserve(elements.reserveEthInput, 'ETH reserve', live ? 'live-reserve' : 'non-negative')
				const minimumRepReserve = parseReserve(elements.reserveRepInput, 'REP reserve', live ? 'live-reserve' : 'non-negative')
				if (live && decimalAtto(minimumEthReserve) < decimalAtto(maximumGasCostEth)) throw new Error('ETH reserve must retain at least one maximum-gas-cost-sized safety floor.')
				const policyPatch: ExecutionPolicyPatch = {
					runtime: { execute: live },
					scheduler: { maximumDelaySeconds: maxDelaySeconds, minimumDelaySeconds: minDelaySeconds },
					strategy: {
						allowHighRiskOperations: elements.highRiskInput.checked,
						allowIrreversibleOperations: elements.irreversibleInput.checked,
						initializeGenesisUniverse: elements.initializeGenesisInput.checked,
						enabledEcosystems,
						maximumEthPerOperation,
						maximumGasCostEth,
						maximumRepPerOperation,
						minimumEthReserve,
						minimumRepReserve,
						selectableOperationAllowlist,
						workflowValidForBlocks,
					},
				}
				const policyChanges = executionPolicyReviewRows(configuration, policyPatch)
				if (policyChanges.length > 0 && !(await confirmOperatorAction({ title: 'Review execution policy', description: 'These limits and permissions apply before the next selection cycle.', changes: policyChanges, confirmLabel: 'Save policy' }))) return
				await put('/api/settings', {
					revision: state.settingsRevision,
					patch: policyPatch,
				})
				settingsDraft.dirty = false
				settingsDraft.conflict = false
				settingsSaveStatus.textContent = 'Execution policy saved.'
				await refresh()
				if (state.configuration !== undefined) renderConfiguration(state.configuration, true)
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
				const latest = state.configuration
				settingsFields.disabled = !mutationReconciled || latest === undefined || latest.paused !== true || state.snapshot?.paused !== true
			}
		})()
	})

	const { signerFields, signerStatus, privateKeyInput, rememberSignerInput, setSignerButton } = elements
	privateKeyInput.addEventListener('input', () => setSignerButton.toggleAttribute('disabled', privateKeyInput.value.trim() === ''))

	elements.signerForm.addEventListener('submit', event => {
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
				await put('/api/signer', { privateKey, remember, revision: state.configuration?.revision })
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

	elements.clearSignerButton.addEventListener('click', () => {
		void (async () => {
			if (!(await confirmOperatorAction({ title: 'Clear signer', description: 'Remove the active signer and saved private key from this bot.', phrase: 'CLEAR SIGNER', confirmLabel: 'Clear signer' }))) return
			signerFields.disabled = true
			signerStatus.textContent = 'Clearing signer…'
			let mutationReconciled = true
			try {
				await put('/api/signer', { privateKey: null, remember: false, revision: state.configuration?.revision })
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
}
