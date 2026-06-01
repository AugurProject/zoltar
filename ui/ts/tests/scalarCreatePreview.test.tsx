/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'
import { ScalarCreatePreview } from '../components/ScalarCreatePreview.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const SCALE = 10n ** 18n

function createScalarCreatePreviewDetails() {
	return {
		answerUnit: 'USD',
		displayValueMax: 100n * SCALE,
		displayValueMin: 0n,
		numTicks: 10n,
	}
}

function StatefulScalarCreatePreview({ initialTick, onSelectedTickChange }: { initialTick: string; onSelectedTickChange?: (tick: string) => void }) {
	const [selectedTick, setSelectedTick] = useState(initialTick)
	return (
		<ScalarCreatePreview
			details={createScalarCreatePreviewDetails()}
			selectedTick={selectedTick}
			onSelectedTickChange={tick => {
				setSelectedTick(tick)
				onSelectedTickChange?.(tick)
			}}
		/>
	)
}

describe('ScalarCreatePreview', () => {
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

	test('clamps out-of-range initial ticks and emits the clamped value', async () => {
		const onSelectedTickChangeCalls: string[] = []
		const renderedComponent = await renderIntoDocument(
			<StatefulScalarCreatePreview
				initialTick='20'
				onSelectedTickChange={tick => {
					onSelectedTickChangeCalls.push(tick)
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const slider = within(document.body).getByRole('slider') as HTMLInputElement
		await waitFor(() => {
			expect(onSelectedTickChangeCalls).toContain('10')
		})
		expect(slider.value).toBe('10')
		expect(slider.getAttribute('aria-valuetext')).toBe('100 USD')
	})

	test('toggles invalid mode and forwards user-selected ticks through callbacks', async () => {
		const onSelectedTickChangeCalls: string[] = []
		const renderedComponent = await renderIntoDocument(
			<StatefulScalarCreatePreview
				initialTick='2'
				onSelectedTickChange={tick => {
					onSelectedTickChangeCalls.push(tick)
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const slider = documentQueries.getByRole('slider') as HTMLInputElement
		const invalidCheckbox = documentQueries.getByRole('checkbox', { name: 'Invalid' }) as HTMLInputElement

		await act(() => {
			fireEvent.click(invalidCheckbox)
		})
		expect(slider.getAttribute('aria-valuetext')).toBe('Invalid')
		expect(invalidCheckbox.checked).toBe(true)
		expect(document.body.querySelector('.scalar-slider-rail')?.className).toContain('is-disabled')

		await act(() => {
			fireEvent.input(slider, { target: { value: '20' } })
		})
		await waitFor(() => {
			expect(onSelectedTickChangeCalls).toContain('10')
			expect(slider.value).toBe('10')
		})
	})
})
