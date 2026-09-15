/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { FormInput } from '../components/FormInput.js'
import { within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function getInput() {
	const input = within(document.body).getByRole('textbox')
	if (!(input instanceof HTMLInputElement)) throw new Error('Expected an input element')
	return input
}

describe('FormInput', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders a bare input when no error, hint, or adornment is provided', async () => {
		const renderedComponent = await renderIntoDocument(<FormInput aria-describedby='external-help' className='custom' invalid value='' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		expect(input.className).toBe('form-input is-invalid custom')
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.getAttribute('aria-describedby')).toBe('external-help')
		expect(renderedComponent.container.querySelector('.form-input-adorned')).toBeNull()
		expect(renderedComponent.container.querySelector('.field-error')).toBeNull()
		expect(renderedComponent.container.querySelector('.field-hint')).toBeNull()
	})

	test('renders an error message, marks the input invalid, and merges the description ids', async () => {
		const renderedComponent = await renderIntoDocument(<FormInput aria-describedby='external-help' error='Enter a valid address.' hint='Use a checksummed address.' value='' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		const error = within(document.body).getByText('Enter a valid address.', { selector: 'p' })
		const hint = within(document.body).getByText('Use a checksummed address.', { selector: 'p' })
		expect(error.className).toBe('field-error')
		expect(hint.className).toBe('field-hint')
		expect(error.id).not.toBe('')
		expect(hint.id).not.toBe('')
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.classList.contains('is-invalid')).toBe(true)
		expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['external-help', error.id, hint.id])
		expect(input.nextElementSibling).toBe(error)
	})

	test('renders a hint without marking the input invalid', async () => {
		const renderedComponent = await renderIntoDocument(<FormInput hint='Optional.' value='' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		const hint = within(document.body).getByText('Optional.', { selector: 'p.field-hint' })
		expect(input.getAttribute('aria-invalid')).toBeNull()
		expect(input.getAttribute('aria-describedby')).toBe(hint.id)
	})

	test('wraps an adorned input and adds the adornment to the accessible description', async () => {
		const renderedComponent = await renderIntoDocument(<FormInput adornment='REP' value='' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		const wrapper = renderedComponent.container.querySelector('.form-input-adorned')
		const adornment = renderedComponent.container.querySelector('.form-input-adornment')
		if (wrapper === null || adornment === null) throw new Error('Expected the adorned wrapper')
		expect(wrapper.firstElementChild).toBe(input)
		expect(wrapper.lastElementChild).toBe(adornment)
		expect(adornment.getAttribute('aria-hidden')).toBe('true')
		expect(adornment.textContent).toBe('REP')
		expect(adornment.id).not.toBe('')
		expect(input.getAttribute('aria-describedby')).toBe(adornment.id)
	})
})
