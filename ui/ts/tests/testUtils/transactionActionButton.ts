import { expect } from 'bun:test'
import { within } from '@testing-library/dom'

type ButtonState = {
	disabled: boolean
	reason: string | undefined
}

export function getTransactionButtonState(scope: HTMLElement, label: string): ButtonState {
	const buttons = within(scope).getAllByRole('button', { name: label })
	const button = buttons[0]
	if (button === undefined) {
		throw new Error(`Expected button ${label}`)
	}
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Expected button ${label}`)
	}

	return {
		disabled: button.disabled,
		reason: button.title === '' ? undefined : button.title,
	}
}

export function expectTransactionButtonDisabled(scope: HTMLElement, label: string, reason: string) {
	const state = getTransactionButtonState(scope, label)
	expect(state.disabled).toBe(true)
	expect(state.reason).toBe(reason)
}

export function expectTransactionButtonEnabled(scope: HTMLElement, label: string) {
	const state = getTransactionButtonState(scope, label)
	expect(state.disabled).toBe(false)
	expect(state.reason).toBeUndefined()
}
