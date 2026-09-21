import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { ReadinessRow } from '../src/dashboard/readiness.ts'
import { executionModePanel, formActions, settingsGroup, settingsIntro, settingsPage, settingsSection, signerPanel, submissionPanel, switchField } from '../src/dashboard/settings-markup.ts'

const previousGlobals = new Map<string, unknown>()
let window: Window | undefined

function installWindow(markup: string) {
	const view = new Window()
	window = view
	for (const name of ['document', 'Event', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'HTMLFieldSetElement', 'HTMLButtonElement', 'HTMLUListElement']) {
		previousGlobals.set(name, Reflect.get(globalThis, name))
		Object.defineProperty(globalThis, name, { configurable: true, value: Reflect.get(view, name) })
	}
	view.document.body.innerHTML = markup
	// The installed global carries the DOM lib types, so `instanceof` checks narrow against the same classes at runtime.
	return document
}

afterEach(async () => {
	for (const [name, value] of previousGlobals) Object.defineProperty(globalThis, name, { configurable: true, value })
	previousGlobals.clear()
	await window?.happyDOM.close()
	window = undefined
})

const page = settingsPage({
	intro: settingsIntro({ scopeText: 'Select a chain profile first.' }),
	sections: [
		settingsSection({
			groups: settingsGroup({
				body: `<form id="policy-form"><fieldset id="policy-fieldset"><div class="field-grid"><label><span>Limit</span><input name="limit" type="number" /></label>${switchField({ id: 'policy-switch', label: 'Enabled' })}</div>${formActions({ statusId: 'policy-status', submitLabel: 'Save policy' })}</fieldset></form>`,
				formId: 'policy-form',
				summary: 'Caps',
				title: 'Policy',
			}),
			id: 'settings-policy',
			step: 1,
			title: 'Policy',
		}),
		settingsSection({ groups: signerPanel({ forgetButton: true }) + submissionPanel({ note: 'Delivery note' }) + executionModePanel({ note: 'Execution note' }), id: 'settings-go-live', step: 2, title: 'Go live' }),
		settingsSection({ collapsed: true, groups: settingsGroup({ body: '<p>Advanced body</p>', open: false, summary: 'Whole file', title: 'Complete configuration' }), id: 'settings-advanced', title: 'Advanced' }),
	].join(''),
	steps: [
		{ id: 'settings-policy', label: 'Policy', step: 1 },
		{ id: 'settings-go-live', label: 'Go live', step: 2 },
		{ id: 'settings-advanced', label: 'Advanced' },
	],
})

test('settings page markup composes the stepper, step sections, badge rows, and the shared go-live panels', () => {
	const document = installWindow(page)
	expect(Array.from(document.querySelectorAll('#settings-nav a'), chip => `${chip.getAttribute('data-settings-target') ?? ''}:${chip.textContent ?? ''}`)).toEqual(['settings-policy:1Policy', 'settings-go-live:2Go live', 'settings-advanced:Advanced'])
	expect(document.querySelector('#settings-nav')?.getAttribute('data-page-content')).toBe('settings')
	expect(document.querySelector('#settings-chain-scope')?.textContent).toBe('Select a chain profile first.')
	expect(Array.from(document.querySelectorAll('.settings-section'), section => `${section.id}:${section.getAttribute('data-settings-collapsed') ?? ''}`)).toEqual(['settings-policy:', 'settings-go-live:', 'settings-advanced:true'])
	expect(document.querySelector('#settings-policy-title')?.textContent).toBe('1Policy')
	expect(document.querySelector('#settings-policy .settings-badges')?.getAttribute('data-form')).toBe('policy-form')
	expect(document.querySelector('#settings-advanced details')?.hasAttribute('open')).toBe(false)
	expect(document.querySelector('#settings-policy details')?.hasAttribute('open')).toBe(true)
	expect(document.querySelector('#policy-status')?.getAttribute('aria-live')).toBe('polite')
	expect(document.querySelector('#policy-form button[type="submit"]')?.textContent).toBe('Save policy')
	expect(document.querySelector('label.switch-field input#policy-switch')?.getAttribute('type')).toBe('checkbox')
	// Signer panel: summary reports the wallet, the status line reports request outcomes, and every button has a stable id.
	expect(document.querySelector('#execution-wallet #signer-summary')?.textContent).toBe('Locked')
	expect(document.querySelector('#signer-form #signer-fieldset')?.hasAttribute('disabled')).toBe(true)
	expect(document.querySelector('#private-key')?.getAttribute('aria-describedby')).toBe('signer-status')
	expect(document.querySelector('#private-key')?.getAttribute('name')).toBe('privateKey')
	expect(document.querySelector('#remember-signer')?.getAttribute('name')).toBe('rememberSigner')
	expect(Array.from(document.querySelectorAll('#signer-form .button-group button'), button => button.id)).toEqual(['forget-signer-button', 'clear-signer-button', 'set-signer-button'])
	expect(document.querySelector('#set-signer-button')?.hasAttribute('disabled')).toBe(true)
	expect(installWindow(signerPanel()).querySelector('#forget-signer-button')).toBeNull()
	const withoutForget = installWindow(page)
	// Submission and execution mode panels carry the ids the shared client modules expect.
	expect(withoutForget.querySelector('#submission-form #submission-mode option[value="private"]')).not.toBeNull()
	expect(withoutForget.querySelector('#relay-urls')?.getAttribute('name')).toBe('relayUrls')
	expect(withoutForget.querySelector('#minimum-bundle-relay-successes')?.getAttribute('max')).toBe('8')
	expect(withoutForget.querySelector('.settings-badges[data-form="submission-form"]')).not.toBeNull()
	expect(withoutForget.querySelector('#execution-mode #execution-checklist')?.getAttribute('aria-label')).toBe('Live execution prerequisites')
	expect(withoutForget.querySelector('#execution-mode-summary')?.textContent).toBe('Dry run')
	expect(withoutForget.querySelector('#execution-form #execution-enabled')?.getAttribute('type')).toBe('checkbox')
	expect(withoutForget.querySelector('#execution-form .section-note')?.textContent).toBe('Execution note')
	expect(withoutForget.querySelector('.settings-badges[data-form="execution-form"]')).not.toBeNull()
})

test('form state unlocks the save button on edits and shows unsaved and queued badges in the panel summary', async () => {
	const document = installWindow(page)
	const { formIsDirty, markFormClean, refreshFormButton, setFormSubmitting, setQueuedSections, trackForm } = await import('../src/dashboard/form-state.ts')
	const badges = (formId: string) => Array.from(document.querySelectorAll(`.settings-badges[data-form="${formId}"] .settings-badge`), badge => `${badge.getAttribute('data-kind') ?? ''}:${badge.textContent ?? ''}`)
	const save = document.querySelector('#policy-form button[type="submit"]')
	const limit = document.querySelector('#policy-form input[name="limit"]')
	const fieldset = document.querySelector('#policy-fieldset')
	if (!(save instanceof HTMLButtonElement) || !(limit instanceof HTMLInputElement) || !(fieldset instanceof HTMLFieldSetElement)) throw new Error('Missing policy controls')
	trackForm('policy-form', { section: 'policy' })
	expect(save.disabled).toBe(true)
	expect(badges('policy-form')).toEqual([])
	limit.value = '5'
	limit.dispatchEvent(new Event('input', { bubbles: true }))
	expect(formIsDirty('policy-form')).toBe(true)
	expect(save.disabled).toBe(false)
	expect(badges('policy-form')).toEqual(['dirty:Unsaved changes'])
	setQueuedSections(['policy', 'other'])
	expect(badges('policy-form')).toEqual(['dirty:Unsaved changes', 'queued:Queued · next scan'])
	// A save in flight locks the whole fieldset and the button until the caller re-derives the locked state.
	setFormSubmitting('policy-form', true)
	expect(fieldset.disabled).toBe(true)
	expect(save.disabled).toBe(true)
	setFormSubmitting('policy-form', false)
	fieldset.disabled = false
	markFormClean('policy-form')
	expect(save.disabled).toBe(true)
	expect(badges('policy-form')).toEqual(['queued:Queued · next scan'])
	setQueuedSections([])
	expect(badges('policy-form')).toEqual([])
	// A locked fieldset hides the dirty state until it unlocks again.
	limit.value = '6'
	limit.dispatchEvent(new Event('input', { bubbles: true }))
	fieldset.disabled = true
	refreshFormButton('policy-form')
	expect(save.disabled).toBe(true)
	expect(badges('policy-form')).toEqual(['dirty:Unsaved changes'])
})

test('execution mode rendering lists prerequisites with advisory rows and gates the switch on the required ones', async () => {
	const document = installWindow(page)
	const { renderExecutionMode } = await import('../src/dashboard/readiness.ts')
	const rows: ReadinessRow[] = [
		{ detail: '0xabc', label: 'Execution signer', ready: true },
		{ detail: 'Enable one', label: 'Trading venue', ready: false },
		{ advisory: true, detail: 'None discovered', label: 'Pool coordinators', ready: false },
	]
	const toggle = document.querySelector('#execution-enabled')
	if (!(toggle instanceof HTMLInputElement)) throw new Error('Missing execution switch')
	expect(renderExecutionMode(rows, { live: false, queued: false, saved: false })).toBe(false)
	expect(
		Array.from(
			document.querySelectorAll('#execution-checklist li'),
			item => `${item.getAttribute('data-ready') ?? ''}${item.getAttribute('data-advisory') === 'true' ? '~' : ''}:${item.querySelector('.readiness-label')?.textContent ?? ''}=${item.querySelector('strong')?.textContent ?? ''}${item.querySelector('.visually-hidden')?.textContent ?? ''}`,
		),
	).toEqual(['true:Execution signer=0xabc ready', 'false:Trading venue=Enable one missing', 'false~:Pool coordinators=None discovered · optional optional'])
	expect(document.querySelector('#execution-mode-summary')?.textContent).toBe('Dry run · prerequisites missing')
	expect(toggle.disabled).toBe(true)
	expect(toggle.getAttribute('aria-describedby')).toBe('execution-checklist')
	const ready: ReadinessRow[] = rows.map(row => (row.label === 'Trading venue' ? { ...row, ready: true } : row))
	expect(renderExecutionMode(ready, { live: false, queued: false, saved: false })).toBe(true)
	expect(toggle.disabled).toBe(false)
	expect(document.querySelector('#execution-mode-summary')?.textContent).toBe('Dry run · ready to go live')
	// A live operator can always disarm, even when a prerequisite has since lapsed.
	renderExecutionMode(rows, { live: true, queued: false, saved: true })
	expect(toggle.disabled).toBe(false)
	expect(document.querySelector('#execution-mode-summary')?.textContent).toBe('Live')
	renderExecutionMode(ready, { live: false, queued: true, saved: true })
	expect(document.querySelector('#execution-mode-summary')?.textContent).toBe('Armed · bot paused')
	renderExecutionMode(ready, { live: true, queued: true, saved: false })
	expect(document.querySelector('#execution-mode-summary')?.textContent).toBe('Live · dry run at the next scan')
})
