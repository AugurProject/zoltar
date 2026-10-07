/// <reference types="bun-types" />

import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'

function ScalarOutcomePickerHarness() {
	const [selectedTick, setSelectedTick] = useState('2')
	const [isInvalid, setIsInvalid] = useState(false)

	return (
		<ScalarOutcomePicker
			details={{
				answerUnit: 'USD',
				displayValueMax: 100n * 10n ** 18n,
				displayValueMin: 0n,
				maxValueLabel: '100 USD',
				minValueLabel: '0 USD',
				numTicks: 10n,
			}}
			isInvalid={isInvalid}
			label='Select scalar target'
			onInvalidChange={setIsInvalid}
			onSelectedTickChange={setSelectedTick}
			selectedOutcomeLabel={isInvalid ? 'Invalid' : `Tick ${selectedTick}`}
			selectedTick={selectedTick}
		/>
	)
}

const UNSAFE_TICK_COUNT = BigInt(Number.MAX_SAFE_INTEGER) + 10n

function ExactScalarOutcomePickerHarness() {
	const [selectedTick, setSelectedTick] = useState(UNSAFE_TICK_COUNT.toString())
	const selectedTickValue = BigInt(selectedTick)

	return (
		<ScalarOutcomePicker
			details={{ answerUnit: '', displayValueMax: UNSAFE_TICK_COUNT * 10n ** 18n, displayValueMin: 0n, maxValueLabel: 'Max', minValueLabel: 'Min', numTicks: UNSAFE_TICK_COUNT }}
			isInvalid={false}
			label='Select exact scalar target'
			onInvalidChange={() => undefined}
			onSelectedTickChange={setSelectedTick}
			selectedOutcomeLabel={`Tick ${selectedTickValue.toString()}`}
			selectedTick={selectedTick}
		/>
	)
}

describe('ScalarOutcomePicker', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('updates the controlled tick, toggles invalid mode, and renders min/max metrics', async () => {
		const renderedComponent = await renderIntoDocument(<ScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider', { name: 'Select scalar target' }) as HTMLInputElement
		const invalidToggle = documentQueries.getByRole('checkbox', { name: 'Invalid' }) as HTMLInputElement

		expect(documentQueries.getByText('0 USD')).not.toBeNull()
		expect(documentQueries.getByText('100 USD')).not.toBeNull()
		expect(documentQueries.queryByText('Selected tick')).toBeNull()
		expect(documentQueries.queryByText('2 / 10')).toBeNull()
		expect(slider.getAttribute('aria-valuetext')).toBe('Tick 2')

		await act(() => {
			fireEvent.input(slider, {
				target: { value: '7' },
			})
		})

		expect(documentQueries.queryByText('7 / 10')).toBeNull()
		expect(slider.value).toBe('7')
		expect(slider.getAttribute('aria-valuetext')).toBe('Tick 7')

		await act(() => {
			fireEvent.click(invalidToggle)
		})

		expect(invalidToggle.checked).toBe(true)
		expect(slider.disabled).toBe(true)
		expect(documentQueries.getAllByText('Invalid').length).toBeGreaterThan(0)
		expect(documentQueries.queryByRole('textbox', { name: 'Scalar value' })).toBeNull()

		await act(() => {
			fireEvent.click(invalidToggle)
		})

		expect((documentQueries.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement).value).toBe('70')
	})

	test('keeps direct scalar value entry synchronized with the slider', async () => {
		const renderedComponent = await renderIntoDocument(<ScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider', { name: 'Select scalar target' }) as HTMLInputElement
		const scalarValueInput = documentQueries.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement
		expect(scalarValueInput.value).toBe('20')
		const scalarHelp = document.getElementById(scalarValueInput.getAttribute('aria-describedby') ?? '')
		expect(scalarHelp?.getAttribute('data-message-placement')).toBe('field')
		expect(scalarHelp?.tagName).toBe('SPAN')
		expect(scalarValueInput.closest('strong')).toBeNull()
		// The help names the step and range instead of an increment the picker never shows.
		expect(documentQueries.getByText('Steps of 10 from 0 to 100.')).not.toBeNull()
		expect(scalarValueInput.getAttribute('inputmode')).toBe('decimal')

		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '70' } })
		})
		expect(slider.value).toBe('7')
		expect(scalarValueInput.value).toBe('70')

		// A partly typed value is not an error yet and the slider keeps the last valid position instead of jumping to the minimum.
		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '7' } })
		})
		expect(slider.value).toBe('7')
		expect(scalarValueInput.getAttribute('aria-invalid')).toBeNull()
		expect(documentQueries.queryByText('Enter a value from 0 to 100 in steps of 10.')).toBeNull()

		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '75' } })
		})
		expect(slider.value).toBe('7')
		expect(scalarValueInput.getAttribute('aria-invalid')).toBeNull()

		await act(() => {
			scalarValueInput.dispatchEvent(new Event('blur'))
		})
		const error = documentQueries.getByText('Enter a value from 0 to 100 in steps of 10.')
		expect(error.parentElement?.getAttribute('aria-live')).toBe('polite')
		expect(scalarValueInput.getAttribute('aria-invalid')).toBe('true')
		expect(scalarValueInput.getAttribute('aria-describedby')).toBe(error.id)
		expect(documentQueries.queryByText('Steps of 10 from 0 to 100.')).toBeNull()

		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '80' } })
		})
		expect(slider.value).toBe('8')
		expect(scalarValueInput.getAttribute('aria-invalid')).toBeNull()
		expect(documentQueries.queryByText('Enter a value from 0 to 100 in steps of 10.')).toBeNull()
	})

	test('restores the canonical scalar value after leaving invalid mode', async () => {
		const renderedComponent = await renderIntoDocument(<ScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const scalarValueInput = documentQueries.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement
		const invalidToggle = documentQueries.getByRole('checkbox', { name: 'Invalid' }) as HTMLInputElement
		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '75' } })
		})
		await act(() => {
			scalarValueInput.dispatchEvent(new Event('blur'))
		})
		expect(documentQueries.getByText('Enter a value from 0 to 100 in steps of 10.')).not.toBeNull()

		await act(() => {
			fireEvent.click(invalidToggle)
		})
		await act(() => {
			fireEvent.click(invalidToggle)
		})

		const restoredScalarValueInput = documentQueries.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement
		expect(restoredScalarValueInput.value).toBe('20')
		expect(restoredScalarValueInput.getAttribute('aria-invalid')).not.toBe('true')
		expect(documentQueries.queryByText('Enter a value from 0 to 100 in steps of 10.')).toBeNull()
	})

	test('uses human values without exposing tick inputs or counts for enormous ranges', async () => {
		const renderedComponent = await renderIntoDocument(<ExactScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const q = within(document.body)
		const scalarValueInput = q.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement
		expect(q.queryByRole('slider')).toBeNull()
		expect(q.queryByRole('textbox', { name: 'Select exact scalar target' })).toBeNull()
		expect(q.queryByText('Selected tick')).toBeNull()
		expect(document.querySelector('.scalar-exact-tick-input')).toBeNull()
		expect(scalarValueInput.value).toBe(UNSAFE_TICK_COUNT.toString())
		await act(() => fireEvent.input(scalarValueInput, { target: { value: '25' } }))
		expect(scalarValueInput.value).toBe('25')
		await act(() => fireEvent.input(scalarValueInput, { target: { value: '-' } }))
		expect(scalarValueInput.value).toBe('-')
		expect(scalarValueInput.getAttribute('aria-invalid')).toBeNull()
		await act(() => scalarValueInput.dispatchEvent(new Event('blur')))
		expect(scalarValueInput.getAttribute('aria-invalid')).toBe('true')
		await act(() => fireEvent.input(scalarValueInput, { target: { value: '26' } }))
		expect(scalarValueInput.value).toBe('26')
		expect(scalarValueInput.getAttribute('aria-invalid')).not.toBe('true')
	})

	test('accepts negative fractional values and rejects values between increments', async () => {
		function FractionalHarness() {
			const [selectedTick, setSelectedTick] = useState('50')
			return (
				<ScalarOutcomePicker
					details={{ answerUnit: '°C', displayValueMin: -5n * 10n ** 18n, displayValueMax: 5n * 10n ** 18n, numTicks: 100n }}
					isInvalid={false}
					label='Temperature'
					onInvalidChange={() => undefined}
					onSelectedTickChange={setSelectedTick}
					selectedOutcomeLabel='Temperature'
					selectedTick={selectedTick}
				/>
			)
		}
		const view = await renderIntoDocument(<FractionalHarness />)
		cleanupRenderedComponent = view.cleanup
		const q = within(document.body)
		const input = q.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement
		const slider = q.getByRole('slider', { name: 'Temperature' }) as HTMLInputElement
		await act(() => fireEvent.input(input, { target: { value: '-2.5' } }))
		expect(input.value).toBe('-2.5')
		expect(slider.value).toBe('25')
		// The iOS decimal keypad has no minus key, so a range with negative values keeps the full keyboard.
		expect(input.getAttribute('inputmode')).toBeNull()
		await act(() => fireEvent.input(input, { target: { value: '-2.55' } }))
		await act(() => input.dispatchEvent(new Event('blur')))
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(q.getByText('Enter a value from -5 to 5 in steps of 0.1.')).not.toBeNull()
		await act(() => fireEvent.input(input, { target: { value: '5' } }))
		expect(slider.value).toBe('100')
		expect(input.getAttribute('aria-invalid')).not.toBe('true')
	})

	test('maps both endpoints of a non-divisible scalar range to canonical ticks', async () => {
		function NonDivisibleHarness() {
			const [selectedTick, setSelectedTick] = useState('0')
			return (
				<ScalarOutcomePicker
					details={{ answerUnit: '', displayValueMax: 10n * 10n ** 18n, displayValueMin: 0n, maxValueLabel: '10', minValueLabel: '0', numTicks: 3n }}
					isInvalid={false}
					label='Select non-divisible scalar target'
					onInvalidChange={() => undefined}
					onSelectedTickChange={setSelectedTick}
					selectedOutcomeLabel={`Tick ${selectedTick}`}
					selectedTick={selectedTick}
				/>
			)
		}

		const renderedComponent = await renderIntoDocument(<NonDivisibleHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider', { name: 'Select non-divisible scalar target' }) as HTMLInputElement
		const scalarValueInput = documentQueries.getByRole('textbox', { name: 'Scalar value' }) as HTMLInputElement

		await act(() => {
			fireEvent.input(scalarValueInput, { target: { value: '10' } })
		})
		expect(slider.value).toBe('3')
		expect(scalarValueInput.value).toBe('10')

		await act(() => {
			fireEvent.input(slider, { target: { value: '1' } })
		})
		expect(scalarValueInput.value).toBe('3.333333333333333333')
	})
})
