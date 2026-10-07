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
		expect(input.getAttribute('pattern')).toBe('[0-9 ]*[.,]?[0-9]*')
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

	test('disables Max with a visible reason that describes the button instead of a hover title', async () => {
		const renderedComponent = await renderIntoDocument(<Harness fillMax={{ amount: undefined, unavailableReason: 'Loading wallet balance.' }} label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = within(document.body).getByRole('button', { name: 'Max' })
		if (!(maxButton instanceof HTMLButtonElement)) throw new Error('Expected a button')
		expect(maxButton.disabled).toBe(true)
		expect(maxButton.title).toBe('')
		const reason = within(document.body).getByText('Loading wallet balance.', { selector: 'p.field-hint' })
		expect(maxButton.getAttribute('aria-describedby')).toBe(reason.id)
	})

	test('leaves a Max reason the form already presents to the form', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<p>Select an outcome side.</p>
				<Harness fillMax={{ amount: undefined, unavailableReason: 'Select an outcome side.', showUnavailableReason: false }} label='Amount' />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = within(document.body).getByRole('button', { name: 'Max' })
		expect(maxButton.getAttribute('aria-describedby')).toBeNull()
		expect(maxButton.title).toBe('Select an outcome side.')
		expect(within(document.body).getAllByText('Select an outcome side.')).toHaveLength(1)
	})

	test('points Max at the field hint when the hint already states its reason', async () => {
		const renderedComponent = await renderIntoDocument(<Harness fillMax={{ amount: undefined, unavailableReason: 'Load the vault first.' }} hint='Load the vault first.' label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const hint = within(document.body).getByText('Load the vault first.', { selector: 'p.field-hint' })
		expect(within(document.body).getAllByText('Load the vault first.')).toHaveLength(1)
		expect(within(document.body).getByRole('button', { name: 'Max' }).getAttribute('aria-describedby')).toBe(hint.id)
		expect(getInput().getAttribute('aria-describedby')?.split(' ')).toContain(hint.id)
	})

	test('leaves the reason of a disabled field to the surrounding form', async () => {
		const renderedComponent = await renderIntoDocument(<Harness disabled fillMax={{ amount: undefined, unavailableReason: 'Reporting is locked.' }} label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).queryByText('Reporting is locked.')).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Max' }).getAttribute('aria-describedby')).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Max' }).title).toBe('Reporting is locked.')
	})

	test('hides the Max reason once the amount is available', async () => {
		const renderedComponent = await renderIntoDocument(<Harness fillMax={{ amount: ONE, unavailableReason: 'Loading wallet balance.' }} label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const maxButton = within(document.body).getByRole('button', { name: 'Max' })
		expect(maxButton.getAttribute('aria-describedby')).toBeNull()
		expect(within(document.body).queryByText('Loading wallet balance.')).toBeNull()
	})

	test('explains zero and negative amounts instead of showing a red field without text', async () => {
		const renderedComponent = await renderIntoDocument(<Harness label='Amount' unit='REP' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		for (const value of ['0', '0.0', '-5']) {
			await typeValue(input, value)
			await blur(input)
			const error = within(document.body).getByText('Enter an amount greater than 0.', { selector: 'p.field-error' })
			expect(input.getAttribute('aria-invalid')).toBe('true')
			expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
		}
	})

	test('keeps the field valid-looking whenever no error text is shown', async () => {
		const renderedComponent = await renderIntoDocument(<Harness allowZero label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		await typeValue(input, '0')
		await blur(input)
		expect(renderedComponent.container.querySelector('.field-error')).toBeNull()
		expect(input.getAttribute('aria-invalid')).toBeNull()
	})

	test('names the separator rule when a thousands separator is typed', async () => {
		const renderedComponent = await renderIntoDocument(<Harness label='Amount' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = getInput()
		await typeValue(input, '1,234.56')
		await blur(input)
		expect(within(document.body).getByText(/without thousands separators\./u, { selector: 'p.field-error' })).not.toBeNull()
		expect(input.getAttribute('aria-invalid')).toBe('true')
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
