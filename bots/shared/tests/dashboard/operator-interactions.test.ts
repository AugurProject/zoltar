import { afterEach, expect, test } from 'bun:test'
import { confirmOperatorAction } from '../../src/dashboard/confirmation.ts'
import { createFocusedFormSubmitter } from '../../src/dashboard/focused-form.ts'
import { markFormClean, trackForm } from '../../src/dashboard/form-state.ts'
import { renderOperatorHealth } from '../../src/dashboard/health-panel.ts'
import { openResumePreflight, updateResumePreflight } from '../../src/dashboard/resume-preflight.ts'
import { createUniverseExplorer } from '../../src/dashboard/universe-explorer.ts'
import { installDom } from '../support/dom.ts'

let dom: ReturnType<typeof installDom> | undefined

function install(markup: string) {
	dom = installDom(markup)
	return dom.view
}

afterEach(async () => {
	await dom?.restore()
	dom = undefined
})

function required<T extends Element>(selector: string, constructor: { new (): T }) {
	const found = document.querySelector(selector)
	if (!(found instanceof constructor)) throw new Error(`Missing ${selector}`)
	return found
}

async function settle(milliseconds = 30) {
	await new Promise(resolve => setTimeout(resolve, milliseconds))
}

test('a dismissed confirmation returns keyboard focus to the control that opened it', async () => {
	install('<main><button id="opener" type="button">Clear signer</button></main>')
	const opener = required('#opener', HTMLButtonElement)
	for (const [label, expected] of [
		['Cancel', false],
		['Confirm', true],
	] as const) {
		opener.focus()
		const confirmation = confirmOperatorAction({ title: 'Clear signer', description: 'Remove the active signer.' })
		await settle()
		const button = Array.from(document.querySelectorAll('.operator-confirm-dialog button')).find(candidate => candidate.textContent === label)
		if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing ${label} button`)
		button.focus()
		expect(document.activeElement).toBe(button)
		button.click()
		expect(await confirmation).toBe(expected)
		expect(document.querySelector('.operator-confirm-dialog')).toBeNull()
		expect(document.activeElement).toBe(opener)
	}
})

test('a failed focused-form save is announced and styled as an error, and a later success clears it', async () => {
	install('<form id="limits-form"><fieldset><input name="limit" /><span id="limits-status" class="action-status muted" role="status"></span><button type="submit">Save</button></fieldset></form>')
	trackForm('limits-form')
	const status = required('#limits-status', HTMLElement)
	const submit = createFocusedFormSubmitter({ refresh: async () => undefined, syncControls: () => undefined })
	await submit('limits-form', 'limits-status', 'Saving…', async () => {
		throw new Error('Enter a nonnegative WETH amount with at most 18 decimal places.')
	})
	expect(status.textContent).toBe('Enter a nonnegative WETH amount with at most 18 decimal places.')
	expect(status.classList.contains('error')).toBe(true)
	expect(status.getAttribute('role')).toBe('alert')
	await submit('limits-form', 'limits-status', 'Saving…', async () => 'Limits saved.')
	expect(status.textContent).toBe('Limits saved.')
	expect(status.classList.contains('error')).toBe(false)
	expect(status.getAttribute('role')).toBe('status')
})

test('leaving the page is guarded only while a tracked form has unsaved changes', () => {
	const view = install('<form id="guarded-form"><fieldset><input name="limit" /><button type="submit">Save</button></fieldset></form>')
	trackForm('guarded-form')
	const leave = () => {
		const event = new view.Event('beforeunload', { cancelable: true })
		view.dispatchEvent(event)
		return event.defaultPrevented
	}
	expect(leave()).toBe(false)
	const limit = required('#guarded-form input', HTMLInputElement)
	limit.value = '5'
	limit.dispatchEvent(new Event('input', { bubbles: true }))
	expect(leave()).toBe(true)
	markFormClean('guarded-form')
	expect(leave()).toBe(false)
})

test('approving a universe from the keyboard keeps focus on its checkbox while the selection saves', async () => {
	install('<div id="universes"></div>')
	let finishSave: (() => void) | undefined
	const saved: string[][] = []
	const explorer = createUniverseExplorer(required('#universes', HTMLElement), {
		onChange: next =>
			new Promise<void>(resolve => {
				saved.push([...next])
				finishSave = resolve
			}),
		savedMessage: 'Saved.',
	})
	explorer.update({ universes: [{ id: '1' }, { id: '2', parentId: '1', outcomeIndex: '0' }], approved: new Set(), network: 'mainnet', disabled: false })
	const checkbox = () => required('input[data-universe-focus="approve:1"]', HTMLInputElement)
	const first = checkbox()
	first.focus()
	first.checked = true
	first.dispatchEvent(new Event('change', { bubbles: true }))
	expect(saved).toEqual([['1']])
	expect(document.activeElement).toBe(checkbox())
	expect(checkbox().getAttribute('aria-disabled')).toBe('true')
	expect(required('input[data-universe-focus="approve:2"]', HTMLInputElement).disabled).toBe(true)
	// A second toggle while the save is pending is ignored and leaves the box showing the saved state.
	const pending = checkbox()
	pending.checked = true
	pending.dispatchEvent(new Event('change', { bubbles: true }))
	expect(saved).toEqual([['1']])
	expect(pending.checked).toBe(false)
	finishSave?.()
	await settle(0)
	expect(document.activeElement).toBe(checkbox())
	expect(checkbox().checked).toBe(true)
	expect(checkbox().getAttribute('aria-disabled')).toBeNull()
})

test('the health panel keeps its stale-state live region mounted so a later change is announced', () => {
	install('<div id="health"></div>')
	const target = required('#health', HTMLElement)
	const health = { mode: 'Dry run', capitalAtRisk: '0 REP', recoveryItems: 0, lastAction: 'None', paused: false, stale: false, stateReceivedAt: Date.now() } as const
	renderOperatorHealth(target, health)
	const region = target.querySelector('[role="status"]')
	expect(region?.textContent).toBe('')
	renderOperatorHealth(target, { ...health, stale: true })
	expect(target.querySelector('[role="status"]')).toBe(region)
	expect(region?.textContent).toBe('Dashboard state is stale; retrying.')
})

test('an open resume preflight follows newer rows and a closed one is left untouched', () => {
	install('<dialog id="resume-dialog"><h2 id="resume-title" tabindex="-1">Resume</h2><ul id="resume-preflight"></ul></dialog>')
	const rows = required('#resume-preflight', HTMLElement)
	updateResumePreflight([['Mode', 'Live execution']])
	expect(rows.textContent).toBe('')
	openResumePreflight([['Execution signer', 'Missing']])
	updateResumePreflight([['Execution signer', '0xabc queued for the next scan']])
	expect(rows.textContent).toBe('Execution signer0xabc queued for the next scan')
})
