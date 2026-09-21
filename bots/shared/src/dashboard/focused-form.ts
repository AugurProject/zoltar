import { setText } from './dom.ts'
import { setFormSubmitting } from './form-state.ts'

type FocusedFormContext = {
	/** Reloads the bot snapshot so the panel reflects the saved value before the outcome is reported. */
	refresh: () => Promise<void>
	/** Re-derives every fieldset's locked state from connection and configuration state once a save has finished. */
	syncControls: () => void
}

/**
 * Shared save flow for the focused Settings forms that each edit one section of the operator file: lock the form,
 * send, reload the returned values, refresh the snapshot, then report the outcome on the form's status line.
 */
export function createFocusedFormSubmitter({ refresh, syncControls }: FocusedFormContext) {
	return async (formId: string, statusId: string, pendingMessage: string, save: () => Promise<string>, onError?: (error: unknown) => void) => {
		setFormSubmitting(formId, true)
		setText(statusId, pendingMessage)
		let outcome: string
		try {
			outcome = await save()
		} catch (error) {
			onError?.(error)
			outcome = error instanceof Error ? error.message : String(error)
		}
		setFormSubmitting(formId, false)
		syncControls()
		// The snapshot refresh completes before the outcome is shown, so the status line always describes a settled panel.
		await refresh()
		setText(statusId, outcome)
	}
}

/** Wires a form's submit event to the focused save flow, keeping the browser's own submission suppressed. */
export function onFormSubmit(form: HTMLFormElement, handler: () => void) {
	form.addEventListener('submit', event => {
		event.preventDefault()
		handler()
	})
}
