/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { act } from 'preact/test-utils'
import { OutcomeSelectionList } from '../../../features/markets/components/OutcomeSelectionList.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

describe('OutcomeSelectionList', () => {
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

	test('renders an empty-state message when no items are available', async () => {
		const renderedComponent = await renderIntoDocument(<OutcomeSelectionList emptyMessage='No target child universes available.' items={[]} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('No target child universes available.')).not.toBeNull()
	})

	test('renders selected and disabled states and only triggers enabled items', async () => {
		let enabledSelections = 0
		let disabledSelections = 0
		const renderedComponent = await renderIntoDocument(
			<OutcomeSelectionList
				items={[
					{
						details: 'Selected',
						key: 'yes',
						label: 'Yes',
						onSelect: () => {
							enabledSelections += 1
						},
						selected: true,
					},
					{
						details: 'Disabled',
						disabled: true,
						key: 'no',
						label: 'No',
						onSelect: () => {
							disabledSelections += 1
						},
						selected: false,
					},
				]}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const enabledButton = within(document.body).getByRole('button', { name: /^Yes/ }) as HTMLButtonElement
		const disabledButton = within(document.body).getByRole('button', { name: /^No/ }) as HTMLButtonElement

		expect(enabledButton.getAttribute('aria-pressed')).toBe('true')
		expect(disabledButton.getAttribute('aria-pressed')).toBe('false')
		expect(disabledButton.disabled).toBe(true)

		await act(() => {
			fireEvent.click(enabledButton)
		})
		await act(() => {
			fireEvent.click(disabledButton)
		})

		expect(enabledSelections).toBe(1)
		expect(disabledSelections).toBe(0)
	})
})
