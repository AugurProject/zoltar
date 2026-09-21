import { element, shorten } from '@zoltar/bot-shared/dashboard/dom'
import { formIsDirty, formIsSubmitting, markFormClean, refreshAllFormButtons, setFormSubmitting, trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { decodeConfiguration, decodeSigner, type Configuration, type Snapshot } from './api-validation.ts'
import { renderGoLive } from './go-live.ts'
import { publicFailure } from './pool-presentation.ts'

type GoLiveFormsContext = {
	actionStatus: (target: HTMLElement, message: string, failed?: boolean) => void
	configuration: () => Configuration | undefined
	populateConfiguration: (configuration: Configuration) => void
	put: (path: string, value: unknown) => Promise<unknown>
	refresh: () => Promise<void>
	/** Re-derives every control's locked state from connection and configuration state once a request has finished. */
	syncControls: () => void
}

/**
 * The Go live forms: execution signer, transaction delivery, and the readiness-gated execution mode switch. Each
 * request reloads the configuration the bot returns and the checklist follows the latest snapshot.
 */
export function registerGoLiveForms({ actionStatus, configuration, populateConfiguration, put, refresh, syncControls }: GoLiveFormsContext) {
	const signerForm = element('signer-form', HTMLFormElement)
	const signerFieldset = element('signer-fieldset', HTMLFieldSetElement)
	const signerStatus = element('signer-status', HTMLSpanElement)
	const setSignerButton = element('set-signer-button', HTMLButtonElement)
	const clearSignerButton = element('clear-signer-button', HTMLButtonElement)
	const privateKeyInput = element('private-key', HTMLInputElement)
	const rememberSignerInput = element('remember-signer', HTMLInputElement)
	const submissionFieldset = element('submission-fieldset', HTMLFieldSetElement)
	const submissionStatus = element('submission-status', HTMLSpanElement)
	const executionFieldset = element('execution-fieldset', HTMLFieldSetElement)
	const executionEnabled = element('execution-enabled', HTMLInputElement)
	const executionStatus = element('execution-status', HTMLSpanElement)
	let chainSettingsAvailable = false
	for (const formId of ['submission-form', 'execution-form']) trackForm(formId)

	element('submission-form', HTMLFormElement).addEventListener('submit', async event => {
		event.preventDefault()
		if (configuration() === undefined || formIsSubmitting('submission-form')) return
		// The submitting latch keeps the form locked across polls until the request settles.
		setFormSubmitting('submission-form', true)
		actionStatus(submissionStatus, 'Checking delivery endpoints…')
		try {
			const request = { minimumBundleRelaySuccesses: Number(element('minimum-bundle-relay-successes', HTMLInputElement).value), mode: element('submission-mode', HTMLSelectElement).value, relayUrls: urlLines(element('relay-urls', HTMLTextAreaElement).value) }
			const next = decodeConfiguration(await put('/api/submission', request))
			populateConfiguration(next)
			load(next, 'submission-form')
			actionStatus(submissionStatus, 'Submission settings saved; they apply to the next transaction.')
		} catch (error) {
			actionStatus(submissionStatus, publicFailure(error, 'Could not save submission settings. Review the relay URLs and retry.', true), true)
		} finally {
			setFormSubmitting('submission-form', false)
			syncControls()
		}
	})

	element('execution-form', HTMLFormElement).addEventListener('submit', async event => {
		event.preventDefault()
		const loaded = configuration()
		if (loaded === undefined || formIsSubmitting('execution-form')) return
		const execute = executionEnabled.checked
		setFormSubmitting('execution-form', true)
		actionStatus(executionStatus, execute ? 'Arming live execution…' : 'Saving dry-run mode…')
		try {
			const next = decodeConfiguration(await put('/api/execution', { execute }))
			populateConfiguration(next)
			load(next, 'execution-form')
			await refresh()
			actionStatus(executionStatus, next.runtime.execute ? 'Live execution armed; the bot is paused until you resume through the readiness check.' : 'Dry-run mode saved.')
		} catch (error) {
			// A rejected switch changes nothing, so the control returns to the saved mode instead of showing an unapplied choice.
			executionEnabled.checked = loaded.runtime.execute
			actionStatus(executionStatus, publicFailure(error, 'Could not change execution mode. Review the readiness checklist and retry.', true), true)
		} finally {
			setFormSubmitting('execution-form', false)
			syncControls()
		}
	})

	signerForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (privateKeyInput.value.trim() === '') {
			actionStatus(signerStatus, 'Enter a private key or use Remove signer.', true)
			return
		}
		actionStatus(signerStatus, 'Updating…')
		try {
			const result = decodeSigner(await put('/api/signer', { privateKey: privateKeyInput.value, rememberSigner: rememberSignerInput.checked }))
			privateKeyInput.value = ''
			setSignerButton.disabled = true
			actionStatus(signerStatus, result.wallet === undefined ? 'Signer cleared' : `Signer active: ${shorten(result.wallet)}`)
		} catch (error) {
			actionStatus(signerStatus, publicFailure(error, 'Could not update the signer. Check the bot connection and retry.'), true)
		}
	})

	signerForm.addEventListener('input', () => {
		setSignerButton.disabled = !chainSettingsAvailable || privateKeyInput.value.trim() === ''
	})

	clearSignerButton.addEventListener('click', async () => {
		if (!window.confirm('Clear the active signer and remove its saved private key from the local operator file?')) return
		clearSignerButton.disabled = true
		actionStatus(signerStatus, 'Clearing…')
		try {
			const result = decodeSigner(await put('/api/signer', { privateKey: '', rememberSigner: true }))
			actionStatus(signerStatus, result.wallet === undefined ? 'Signer cleared' : 'Signer was not cleared', result.wallet !== undefined)
			await refresh()
		} catch (error) {
			actionStatus(signerStatus, publicFailure(error, 'Could not clear the signer. Check the bot connection and retry.'), true)
		} finally {
			clearSignerButton.disabled = !chainSettingsAvailable
		}
	})

	/**
	 * Copies the saved delivery and execution mode into the forms. A form mid-edit keeps its values when another save
	 * reloads the configuration; the form that just saved, or every form on a fresh profile load, takes the file's values.
	 */
	const load = (loaded: Configuration, source?: 'all' | 'execution-form' | 'submission-form') => {
		if (source === 'all' || source === 'submission-form' || !formIsDirty('submission-form')) {
			element('submission-mode', HTMLSelectElement).value = loaded.submission.mode
			element('relay-urls', HTMLTextAreaElement).value = loaded.submission.relayUrls.join('\n')
			element('minimum-bundle-relay-successes', HTMLInputElement).value = loaded.submission.minimumBundleRelaySuccesses.toString()
			markFormClean('submission-form')
		}
		if (source === 'all' || source === 'execution-form' || !formIsDirty('execution-form')) {
			executionEnabled.checked = loaded.runtime.execute
			markFormClean('execution-form')
		}
	}

	return {
		load,
		/** The checklist and switch follow the latest snapshot and the saved configuration together. */
		render: (snapshot: Snapshot | undefined, loaded: Configuration | undefined) => {
			if (snapshot !== undefined) element('signer-summary').textContent = snapshot.wallet === undefined ? 'No active signer' : `Active ${shorten(snapshot.wallet)}`
			if (snapshot !== undefined && loaded !== undefined) renderGoLive(snapshot, loaded)
			// The switch is re-derived from readiness after every render, so the save buttons must follow it.
			refreshAllFormButtons()
		},
		/** Locks every Go live form while the chain settings are unavailable; execution mode also waits for a snapshot. */
		setEnabled: (enabled: boolean, snapshotLoaded: boolean) => {
			chainSettingsAvailable = enabled
			// A save in flight keeps its fieldset locked regardless of the connection state so later edits cannot be lost.
			submissionFieldset.disabled = !enabled || formIsSubmitting('submission-form')
			executionFieldset.disabled = !enabled || !snapshotLoaded || formIsSubmitting('execution-form')
			signerFieldset.disabled = !enabled
			// The individual controls carry the disabled state too, so a locked fieldset never hides an enabled input.
			for (const control of signerForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) control.disabled = !enabled
			setSignerButton.disabled = !enabled || privateKeyInput.value.trim() === ''
		},
	}
}
