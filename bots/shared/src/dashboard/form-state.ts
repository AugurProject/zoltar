import { element } from './dom.ts'

type TrackedForm = {
	clean: string
	/** A save request is in flight; the button stays locked until it settles even if a refresh re-evaluates the form. */
	submitting: boolean
	/** Extra state that is not a form control, such as a universe explorer's selection. */
	extra: (() => string) | undefined
	form: HTMLFormElement
	/** The operator-file section the form edits, matched against the sections the bot reports as queued. */
	section: string | undefined
}

const trackedForms = new Map<string, TrackedForm>()
let queuedSections: ReadonlySet<string> = new Set()

function controlSignature(control: Element) {
	if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) return control.checked ? '1' : '0'
	if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return control.value
	return ''
}

function signature(tracked: Pick<TrackedForm, 'extra' | 'form'>) {
	const controls = Array.from(tracked.form.querySelectorAll('input, select, textarea'), control => `${control.getAttribute('name') ?? control.id}=${controlSignature(control)}`)
	return [...controls, tracked.extra?.() ?? ''].join('|')
}

function badgeContainer(formId: string) {
	const found = document.querySelector(`.settings-badges[data-form="${formId}"]`)
	return found instanceof HTMLElement ? found : undefined
}

function badge(kind: 'dirty' | 'queued', text: string) {
	const item = document.createElement('span')
	item.className = 'settings-badge'
	item.dataset['kind'] = kind
	item.textContent = text
	return item
}

function renderBadges(formId: string) {
	const container = badgeContainer(formId)
	if (container === undefined) return
	const badges: HTMLElement[] = []
	if (formIsDirty(formId)) badges.push(badge('dirty', 'Unsaved changes'))
	const section = trackedForms.get(formId)?.section
	if (section !== undefined && queuedSections.has(section)) badges.push(badge('queued', 'Queued · next scan'))
	container.replaceChildren(...badges)
}

/** The submit button follows the fieldset while it is locked and otherwise stays disabled until an edit changes a value. */
export function refreshFormButton(formId: string) {
	const tracked = trackedForms.get(formId)
	if (tracked === undefined) return
	const button = tracked.form.querySelector('button[type="submit"]')
	const fieldset = tracked.form.querySelector('fieldset')
	if (!(button instanceof HTMLButtonElement)) return
	button.disabled = tracked.submitting || (fieldset instanceof HTMLFieldSetElement && fieldset.disabled) || !formIsDirty(formId)
	renderBadges(formId)
}

export function formIsDirty(formId: string) {
	const tracked = trackedForms.get(formId)
	return tracked !== undefined && signature(tracked) !== tracked.clean
}

/** Records the current control values as the saved state; call after every load and successful save. */
export function markFormClean(formId: string) {
	const tracked = trackedForms.get(formId)
	if (tracked === undefined) return
	tracked.clean = signature(tracked)
	refreshFormButton(formId)
}

/**
 * Diffs a Settings form against its loaded values: the save button unlocks on edits and the panel summary shows an
 * Unsaved changes badge, plus a Queued badge while the bot holds a saved change for the form's section.
 */
export function trackForm(formId: string, options: { extra?: () => string; section?: string | undefined } = {}) {
	const form = element(formId, HTMLFormElement)
	trackedForms.set(formId, { clean: signature({ extra: options.extra, form }), extra: options.extra, form, section: options.section, submitting: false })
	const update = () => refreshFormButton(formId)
	form.addEventListener('input', update)
	form.addEventListener('change', update)
	refreshFormButton(formId)
}

/**
 * Marks a save request as started or finished. The whole fieldset locks while the request runs so an edit made in the
 * meantime cannot be silently replaced by the response; the caller re-derives the fieldset state once it finishes.
 */
export function setFormSubmitting(formId: string, submitting: boolean) {
	const tracked = trackedForms.get(formId)
	if (tracked === undefined) return
	tracked.submitting = submitting
	const fieldset = tracked.form.querySelector('fieldset')
	if (submitting && fieldset instanceof HTMLFieldSetElement) fieldset.disabled = true
	refreshFormButton(formId)
}

export function formIsSubmitting(formId: string) {
	return trackedForms.get(formId)?.submitting === true
}

/** Re-evaluates every save button after fieldsets lock or unlock, since a locked fieldset hides the dirty state. */
export function refreshAllFormButtons() {
	for (const formId of trackedForms.keys()) refreshFormButton(formId)
}

/** Marks every panel whose section the bot has queued for the next scan boundary. */
export function setQueuedSections(sections: readonly string[]) {
	queuedSections = new Set(sections)
	for (const formId of trackedForms.keys()) renderBadges(formId)
}
