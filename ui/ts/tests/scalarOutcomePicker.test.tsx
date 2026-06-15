/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { ScalarOutcomePicker } from '../components/ScalarOutcomePicker.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
			label='Select Scalar Target'
			onInvalidChange={setIsInvalid}
			onSelectedTickChange={setSelectedTick}
			selectedOutcomeLabel={isInvalid ? 'Invalid' : `Tick ${selectedTick}`}
			selectedTick={selectedTick}
			selectedTickLabel={isInvalid ? 'Invalid' : `${selectedTick} / 10`}
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
		const slider = documentQueries.getByRole('slider') as HTMLInputElement
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
})
