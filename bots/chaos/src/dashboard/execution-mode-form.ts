import { element } from '@zoltar/bot-shared/dashboard/dom'
import { formIsDirty, formIsSubmitting, markFormClean, refreshAllFormButtons, setFormSubmitting, trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import { renderGoLive, type GoLiveConfiguration, type GoLiveSnapshot } from './go-live.ts'

type ExecutionModeConfiguration = GoLiveConfiguration & { revision?: string | number | undefined }

type ExecutionModeContext = {
	configuration: () => ExecutionModeConfiguration | undefined
	put: (path: string, value: unknown) => Promise<unknown>
	/** Resolves an unknown mutation outcome the way the policy form does; returns whether it handled the error. */
	reconcile: (error: unknown, status: HTMLElement) => Promise<{ handled: boolean; reconciled: boolean }>
	refresh: () => Promise<unknown>
	snapshot: () => GoLiveSnapshot | undefined
}

/**
 * The Execution mode panel: the readiness checklist and the live switch. It shares the execution-policy gate, so it
 * only accepts a change while the persisted configuration and the running bot are both paused.
 */
export function registerExecutionModeForm({ configuration, put, reconcile, refresh, snapshot }: ExecutionModeContext) {
	const fieldset = element('execution-fieldset', HTMLFieldSetElement)
	const toggle = element('execution-enabled', HTMLInputElement)
	const status = element('execution-status', HTMLSpanElement)
	// The switch diffs against the loaded configuration; its save button unlocks only when the mode changes.
	trackForm('execution-form')
	const editable = () => configuration()?.paused === true && snapshot()?.paused === true

	element('execution-form', HTMLFormElement).addEventListener('submit', event => {
		event.preventDefault()
		void (async () => {
			const loaded = configuration()
			if (loaded === undefined || formIsSubmitting('execution-form')) return
			if (!editable()) {
				status.textContent = 'Pause the bot before changing execution mode.'
				fieldset.disabled = true
				return
			}
			const execute = toggle.checked
			// The shared submitting latch keeps the form locked across refreshes until the request settles.
			setFormSubmitting('execution-form', true)
			status.textContent = execute ? 'Enabling live execution…' : 'Saving dry-run mode…'
			let mutationReconciled = true
			try {
				await put('/api/execution', { execute, revision: loaded.revision })
				status.textContent = execute ? 'Live execution enabled. Resume through the readiness check to start signing.' : 'Dry-run mode saved.'
				// The switch now matches the saved mode, so the refresh below reloads a clean form.
				markFormClean('execution-form')
				setFormSubmitting('execution-form', false)
				await refresh()
			} catch (error) {
				setFormSubmitting('execution-form', false)
				const reconciliation = await reconcile(error, status)
				mutationReconciled = !reconciliation.handled || reconciliation.reconciled
				if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') await refresh()
				// The control returns to the saved mode instead of showing an unapplied choice: a rejected switch changed nothing,
				// while a lost response may have committed, so the mode comes from the configuration reloaded above.
				toggle.checked = (configuration() ?? loaded).execute === true
				markFormClean('execution-form')
				if (!reconciliation.handled) status.textContent = error instanceof Error ? error.message : 'Execution mode could not be changed.'
			} finally {
				setFormSubmitting('execution-form', false)
				fieldset.disabled = !mutationReconciled || !editable()
				refreshAllFormButtons()
			}
		})()
	})

	return {
		/** Locks the panel while a policy mutation is unresolved, alongside the policy form. */
		lock: () => {
			fieldset.disabled = true
		},
		/**
		 * Follows the loaded configuration: the gate, the saved mode, and the checklist. An unsaved flip survives the
		 * periodic refresh, like the policy draft; only a clean form takes the saved mode.
		 */
		render: (loaded: ExecutionModeConfiguration, policyEditable: boolean) => {
			const pending = formIsSubmitting('execution-form')
			fieldset.disabled = !policyEditable || pending
			if (!pending && !formIsDirty('execution-form')) {
				toggle.checked = loaded.execute === true
				markFormClean('execution-form')
			}
			const current = snapshot()
			if (current !== undefined) renderGoLive(current, loaded)
			refreshAllFormButtons()
		},
	}
}
