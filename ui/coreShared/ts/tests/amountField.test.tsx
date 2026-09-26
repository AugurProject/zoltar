/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { AmountField } from '../components/AmountField.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const ONE = 10n ** 18n

type HarnessProps = Omit<Parameters<typeof AmountField>[0], 'onChange' | 'value'> & { initialValue?: string }

function Harness({ initialValue = '', ...props }: HarnessProps) {
	const [value, setValue] = useState(initialValue)
	return <AmountField {...props} value={value} onChange={setValue} />
}

function getInput() {
	const input = within(document.body).getByRole('textbox')
	if (!(input instanceof HTMLInputElement)) throw new Error('Expected an input element')
	return input
}

async function typeValue(input: HTMLInputElement, value: string) {
	await act(() => {
		fireEvent.input(input, { target: { value } })
	})
}

async function blur(input: HTMLInputElement) {
	await act(() => {
		input.dispatchEvent(new Event('blur'))
	})
}

describe('AmountField', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders a labelled decimal input with a unit and a balance hint', async () => {
		const renderedComponent = await renderIntoDocument(<Harness balance={1_200n * ONE} label='Deposit amount' unit='REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = within(document.body).getByLabelText('Deposit amount')
		if (!(input instanceof HTMLInputElement)) throw new Error('Expected an input element')
		expect(input.inputMode).toBe('decimal')
		expect(input.getAttribute('pattern')).toBe('[0-9 ]*[.]?[0-9]*')
		expect(input.getAttribute('autocomplete')).toBe('off')
		const adornment = renderedComponent.container.querySelector('.form-input-adornment')
		const hint = within(document.body).getByText('Balance: 1 200 REP', { selector: 'p.field-hint' })
		expect(adornment?.textContent).toBe('REP')
		expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual([hint.id, adornment?.id])
		expect(input.getAttribute('aria-invalid')).toBeNull()
	})

	test('waits for blur before showing an error, announces it politely, and hides it again while typing', async () => {
		const renderedComponent = await renderIntoDocument(<Harness balance={10n * ONE} label='Deposit amount' unit='REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		const liveRegion = renderedComponent.container.querySelector('.field-error-live-region')
		expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
		expect(liveRegion?.childElementCount).toBe(0)

		await typeValue(input, '11')
		expect(renderedComponent.container.querySelector('.field-error')).toBeNull()
		expect(input.getAttribute('aria-invalid')).toBeNull()

		await blur(input)
		const error = within(document.body).getByText('Exceeds your balance of 10 REP.', { selector: 'p.field-error' })
		expect(error.parentElement).toBe(liveRegion)
		expect(error.getAttribute('role')).toBeNull()
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.getAttribute('aria-describedby')?.split(' ')[0]).toBe(error.id)
		expect(document.body.querySelector('[role="alert"]')).toBeNull()
		expect(input.closest('.form-input-adorned')?.classList.contains('is-invalid')).toBe(true)
		expect(renderedComponent.container.querySelector('.field-hint')).toBeNull()

		await typeValue(input, '1')
		expect(renderedComponent.container.querySelector('.field-error')).toBeNull()
		expect(input.getAttribute('aria-invalid')).toBeNull()

		await blur(input)
		expect(renderedComponent.container.querySelector('.field-error')).toBeNull()
	})

	test('fills the Max amount and percentage presets with the token decimals', async () => {
		const renderedComponent = await renderIntoDocument(<Harness decimals={6} fillMax={{ amount: 2_500_000n }} label='Amount' percentPresets={[50]} unit='USDC' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Max' }))
		})
		expect(input.value).toBe('2.5')
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: '50%' }))
		})
		expect(input.value).toBe('1.25')
	})

	test('disables Max with its reason while the amount is unavailable', async () => {
		const renderedComponent = await renderIntoDocument(<Harness fillMax={{ amount: undefined, unavailableReason: 'Loading wallet balance.' }} label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = within(document.body).getByRole('button', { name: 'Max' })
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected a button')
		expect(maxButton.disabled).toBe(true)
		expect(maxButton.title).toBe('Loading wallet balance.')
	})

	test('prefers a caller error and lets the caller own the reveal state', async () => {
		const revealChanges: boolean[] = []
		const renderedComponent = await renderIntoDocument(<Harness error='Enter a multiplier of at least 1.0002×.' errorId='multiplier-error' errorRevealed initialValue='1' label='Multiplier' onErrorRevealedChange={revealed => revealChanges.push(revealed)} unit='×' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		const error = within(document.body).getByText('Enter a multiplier of at least 1.0002×.', { selector: 'p.field-error' })
		expect(error.id).toBe('multiplier-error')
		expect(input.getAttribute('aria-describedby')?.split(' ')).toContain('multiplier-error')

		await typeValue(input, '1.5')
		await blur(input)
		expect(revealChanges).toEqual([false, true])
		expect(within(document.body).getByText('Enter a multiplier of at least 1.0002×.', { selector: 'p.field-error' }).id).toBe('multiplier-error')
	})
})
