import { expect } from 'bun:test'
import { within } from './queries'

type ButtonState = {
	disabled: boolean
	reason: string | undefined
}

/** Reads the disabled reason from the button's accessible description, preferring the inline action hint over other referenced elements. */
function getDescribedByText(button: HTMLButtonElement) {
	const ids = (button.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id !== '')
	const elements = ids.map(id => button.ownerDocument.getElementById(id)).filter(element => element !== null)
	const inlineHint = elements.find(element => element.classList.contains('tx-action-notice'))
	const text = (inlineHint ?? elements[0])?.textContent?.trim() ?? ''
	return text === '' ? undefined : text
}

export function getTransactionButtonState(scope: HTMLElement, label: string): ButtonState {
	const buttons = within(scope).getAllByRole('button', { name: label })
	const button = buttons[0]
	if (button === undefined) throw new Error(`Expected button ${label}`)
	if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected button ${label}`)

	return {
		disabled: button.disabled,
		reason: button.disabled ? getDescribedByText(button) : undefined,
	}
}

export function expectTransactionButtonDisabled(scope: HTMLElement, label: string, reason?: string) {
	const state = getTransactionButtonState(scope, label)
	expect(state.disabled).toBe(true)
	if (reason !== undefined) expect(state.reason?.replaceAll(' ', ' ')).toBe(reason.replaceAll(' ', ' '))
}

export function expectTransactionButtonEnabled(scope: HTMLElement, label: string) {
	const state = getTransactionButtonState(scope, label)
	expect(state.disabled).toBe(false)
	expect(state.reason).toBeUndefined()
}
