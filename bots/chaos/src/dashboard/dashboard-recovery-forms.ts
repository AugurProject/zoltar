import type { DashboardElements } from './dashboard-elements.ts'
import type { RecoveryContextRefresh, RecoveryContexts } from './dashboard-recovery-contexts.ts'
import type { ReconcileUnknownMutation } from './dashboard-refresh.ts'
import type { DashboardPut } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { setRecoveryFormSubmitting } from './recovery-form-lock.ts'
import { registerWorkflowReconciliation } from './workflow-reconciliation.js'

type RecoveryFormsContext = {
	state: DashboardState
	elements: DashboardElements
	contexts: RecoveryContexts
	put: DashboardPut
	refresh: () => Promise<unknown>
	reconcileUnknownMutation: ReconcileUnknownMutation
	requestRecoveryContextRefresh: (context: RecoveryContextRefresh) => Promise<void>
}

/** Registers the paused-bot reconciliation forms and returns the workflow form's submit-button sync. */
export function registerRecoveryForms({ state, elements, contexts, put, refresh, reconcileUnknownMutation, requestRecoveryContextRefresh }: RecoveryFormsContext) {
	const { replacementFields, replacementHashInput, replacementStatus } = elements
	elements.replacementForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const intentHash = state.snapshot?.pendingTransactions[0]?.hash
			const replacementHash = replacementHashInput.value.trim()
			if (state.snapshot?.paused !== true) {
				replacementStatus.textContent = 'Pause the bot before queuing verification.'
				return
			}
			if (intentHash === undefined) {
				await requestRecoveryContextRefresh(contexts.replacement)
				return
			}
			if (!/^0x[0-9a-fA-F]{64}$/.test(replacementHash)) {
				replacementStatus.textContent = 'Enter a 32-byte transaction hash.'
				return
			}
			setRecoveryFormSubmitting(replacementFields, true)
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
				setRecoveryFormSubmitting(replacementFields, false)
				const { snapshot } = state
				replacementFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.cancellationHash !== undefined
			}
		})()
	})

	const { cancellationFields, cancellationHashInput, cancellationReasonInput, cancellationConfirmationInput, cancellationStatus } = elements
	elements.cancellationForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const intentHash = state.snapshot?.pendingTransactions[0]?.hash
			const cancellationHash = cancellationHashInput.value.trim()
			if (state.snapshot?.paused !== true) {
				cancellationStatus.textContent = 'Pause the bot before queuing cancellation verification.'
				return
			}
			if (intentHash === undefined) {
				await requestRecoveryContextRefresh(contexts.cancellation)
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
			setRecoveryFormSubmitting(cancellationFields, true)
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
				setRecoveryFormSubmitting(cancellationFields, false)
				const { snapshot } = state
				cancellationFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.replacementHash !== undefined
			}
		})()
	})

	const { candidateFields, candidateReasonInput, candidateConfirmationInput, candidateStatus } = elements
	elements.candidateForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const intent = state.snapshot?.pendingTransactions[0]
			const expectedCandidateHash = intent?.replacementHash ?? intent?.cancellationHash
			if (state.snapshot?.paused !== true) {
				candidateStatus.textContent = 'Pause the bot before clearing a recovery candidate.'
				return
			}
			if (intent?.hash === undefined || expectedCandidateHash === undefined) {
				await requestRecoveryContextRefresh(contexts.candidate)
				return
			}
			const reason = candidateReasonInput.value.trim()
			if (reason.length < 12) {
				candidateStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
				return
			}
			setRecoveryFormSubmitting(candidateFields, true)
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
				setRecoveryFormSubmitting(candidateFields, false)
				const { snapshot } = state
				const candidate = snapshot?.pendingTransactions[0]?.replacementHash ?? snapshot?.pendingTransactions[0]?.cancellationHash
				candidateFields.disabled = !mutationReconciled || snapshot?.paused !== true || candidate === undefined
			}
		})()
	})

	const syncWorkflowSubmit = registerWorkflowReconciliation({
		confirmationInput: elements.workflowConfirmationInput,
		fields: elements.workflowFields,
		form: elements.workflowForm,
		getSnapshot: () => state.snapshot,
		put,
		reasonInput: elements.workflowReasonInput,
		reconcileUnknownMutation: (error, status) => reconcileUnknownMutation(error, status, 'state'),
		refresh,
		requestContextRefresh: () => requestRecoveryContextRefresh(contexts.workflow),
		status: elements.workflowStatus,
		submitButton: elements.workflowSubmitButton,
	})

	const { obligationFields, obligationIdInput, obligationActionInput, obligationReasonInput, obligationConfirmationInput, obligationConfirmationHelp, obligationStatus } = elements
	function renderObligationConfirmationHelp() {
		const confirmation = obligationActionInput.value === 'abandon' ? 'ABANDON OBLIGATION' : 'RETRY VERIFIED SAFE FAILURE'
		obligationConfirmationHelp.textContent = `Type ${confirmation}. ${obligationActionInput.value === 'abandon' ? 'This creates a permanent tombstone and transfers responsibility to the operator.' : 'Retry is limited to unsigned failures, canonically included reverts, and verified nonce cancellations; semantic uncertainty still requires manual reconciliation.'}`
	}

	obligationActionInput.addEventListener('change', renderObligationConfirmationHelp)
	renderObligationConfirmationHelp()
	elements.obligationForm.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const obligation = state.snapshot?.obligations.find(candidate => candidate.id === obligationIdInput.value)
			if (state.snapshot?.paused !== true) {
				obligationStatus.textContent = 'Pause the bot before lifecycle reconciliation.'
				return
			}
			if (obligation?.id === undefined || obligation.updatedAt === undefined) {
				await requestRecoveryContextRefresh(contexts.obligation)
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
			setRecoveryFormSubmitting(obligationFields, true)
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
				setRecoveryFormSubmitting(obligationFields, false)
				obligationFields.disabled = !mutationReconciled || state.snapshot?.paused !== true || (state.snapshot?.obligations.length ?? 0) === 0
			}
		})()
	})

	return syncWorkflowSubmit
}
