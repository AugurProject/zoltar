import type { Snapshot } from './dashboard-data.ts'

const WORKFLOW_CONFIRMATION = 'ABANDON PARTIAL WORKFLOW'

type Options = {
	confirmationInput: HTMLInputElement
	fields: HTMLFieldSetElement
	form: HTMLFormElement
	getSnapshot: () => Snapshot | undefined
	put: (path: string, value: unknown) => Promise<unknown>
	reasonInput: HTMLTextAreaElement
	reconcileUnknownMutation: (error: unknown, status: HTMLElement) => Promise<{ handled: boolean; reconciled: boolean }>
	refresh: () => Promise<unknown>
	requestContextRefresh: () => Promise<void>
	status: HTMLElement
	submitButton: HTMLButtonElement
}

export function registerWorkflowReconciliation(options: Options) {
	const { confirmationInput, fields, form, getSnapshot, put, reasonInput, reconcileUnknownMutation, refresh, requestContextRefresh, status, submitButton } = options
	function syncSubmit() {
		const reasonLength = reasonInput.value.trim().length
		submitButton.disabled = fields.disabled || reasonLength < 12 || reasonLength > 2048 || confirmationInput.value !== WORKFLOW_CONFIRMATION
	}
	reasonInput.addEventListener('input', syncSubmit)
	confirmationInput.addEventListener('input', syncSubmit)
	form.addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const current = getSnapshot()
			const workflow = current?.currentWorkflow
			if (current?.paused !== true) {
				status.textContent = 'Pause the bot before workflow reconciliation.'
				return
			}
			if (workflow?.status !== 'waiting-continuation' || workflow.id === undefined || workflow.updatedAt === undefined) {
				await requestContextRefresh()
				return
			}
			const reason = reasonInput.value.trim()
			if (reason.length < 12 || reason.length > 2048) {
				status.textContent = 'Enter a detailed audit reason (12–2048 characters).'
				return
			}
			if (confirmationInput.value !== WORKFLOW_CONFIRMATION) {
				status.textContent = `Type ${WORKFLOW_CONFIRMATION} to confirm this action.`
				return
			}
			fields.disabled = true
			syncSubmit()
			status.textContent = 'Saving reconciliation…'
			let mutationReconciled = true
			try {
				await put('/api/reconciliation/workflow', { action: 'abandon', confirmation: confirmationInput.value, reason, updatedAt: workflow.updatedAt, workflowId: workflow.id })
				reasonInput.value = ''
				confirmationInput.value = ''
				status.textContent = 'Partial workflow abandonment saved.'
				await refresh()
			} catch (error) {
				const reconciliation = await reconcileUnknownMutation(error, status)
				mutationReconciled = !reconciliation.handled || reconciliation.reconciled
				if (!reconciliation.handled) status.textContent = error instanceof Error ? error.message : 'Partial workflow reconciliation failed.'
			} finally {
				const latest = getSnapshot()
				fields.disabled = !mutationReconciled || latest?.paused !== true || latest.currentWorkflow?.status !== 'waiting-continuation'
				syncSubmit()
			}
		})()
	})
	return syncSubmit
}
