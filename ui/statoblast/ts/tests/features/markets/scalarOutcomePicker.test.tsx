/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { ScalarOutcomePicker } from '../../../features/markets/components/ScalarOutcomePicker.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

function ScalarOutcomePickerHarness() {
	const [selectedTick, setSelectedTick] = useState('2')
	const [isInvalid, setIsInvalid] = useState(false)

	return (
		<ScalarOutcomePicker
			details={{
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
			selectedTickLabel={isInvalid ? 'Invalid' : `${selectedTick} / 10`}
		/>
	)
}

const UNSAFE_TICK_COUNT = BigInt(Number.MAX_SAFE_INTEGER) + 10n

function ExactScalarOutcomePickerHarness() {
	const [selectedTick, setSelectedTick] = useState(UNSAFE_TICK_COUNT.toString())
	const selectedTickValue = BigInt(selectedTick)

	return (
		<ScalarOutcomePicker
			details={{ maxValueLabel: 'Max', minValueLabel: 'Min', numTicks: UNSAFE_TICK_COUNT }}
			isInvalid={false}
			label='Select exact scalar target'
			onInvalidChange={() => undefined}
			onSelectedTickChange={setSelectedTick}
			selectedOutcomeLabel={`Tick ${selectedTickValue.toString()}`}
			selectedTick={selectedTick}
			selectedTickLabel={selectedTick}
		/>
	)
}

describe('ScalarOutcomePicker', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('updates the controlled tick, toggles invalid mode, and renders min/max metrics', async () => {
		const renderedComponent = await renderIntoDocument(<ScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider', { name: 'Select scalar target' }) as HTMLInputElement
		const invalidToggle = documentQueries.getByRole('checkbox', { name: 'Invalid' }) as HTMLInputElement

		expect(documentQueries.getByText('0 USD')).not.toBeNull()
		expect(documentQueries.getByText('100 USD')).not.toBeNull()
		expect(documentQueries.getByText('2 / 10')).not.toBeNull()
		expect(slider.getAttribute('aria-valuetext')).toBe('Tick 2')

		await act(() => {
			fireEvent.input(slider, {
				target: { value: '7' },
			})
		})

		expect(documentQueries.getByText('7 / 10')).not.toBeNull()
		expect(slider.value).toBe('7')
		expect(slider.getAttribute('aria-valuetext')).toBe('Tick 7')

		await act(() => {
			fireEvent.click(invalidToggle)
		})

		expect(invalidToggle.checked).toBe(true)
		expect(slider.disabled).toBe(true)
		expect(documentQueries.getAllByText('Invalid').length).toBeGreaterThan(0)
	})

	test('uses a bigint-safe exact tick input when the native slider range is unsafe', async () => {
		const renderedComponent = await renderIntoDocument(<ExactScalarOutcomePickerHarness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const exactInput = within(document.body).getByRole('textbox', { name: 'Select exact scalar target' }) as HTMLInputElement
		expect(within(document.body).queryByRole('slider')).toBeNull()
		expect(exactInput.value).toBe(UNSAFE_TICK_COUNT.toString())

		await act(() => {
			fireEvent.input(exactInput, { target: { value: '-' } })
		})
		expect(exactInput.value).toBe('-')
		expect(within(document.body).getByText(`Tick ${UNSAFE_TICK_COUNT.toString()}`)).not.toBeNull()

		await act(() => {
			fireEvent.input(exactInput, { target: { value: (UNSAFE_TICK_COUNT - 1n).toString() } })
		})
		expect(exactInput.value).toBe((UNSAFE_TICK_COUNT - 1n).toString())
		expect(within(document.body).getByText(`Tick ${(UNSAFE_TICK_COUNT - 1n).toString()}`)).not.toBeNull()
	})
})
