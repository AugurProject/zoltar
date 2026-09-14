/// <reference types="bun-types" />

import { OutcomeSelectionList } from '@zoltar/ui-core-shared/components/OutcomeSelectionList.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

describe('OutcomeSelectionList', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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
