/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { EnumDropdown } from '../components/EnumDropdown.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createMouseDownOutside() {
	const outsideButton = document.createElement('button')
	outsideButton.type = 'button'
	outsideButton.textContent = 'Outside'
	outsideButton.id = 'outside-button'
	document.body.appendChild(outsideButton)
	return outsideButton
}

describe('EnumDropdown', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		document.querySelector('#outside-button')?.remove()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders an explicit placeholder without silently selecting the first option', async () => {
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				ariaLabel='Outcome'
				options={[
					{ label: 'Yes', value: 'yes' },
					{ label: 'No', value: 'no' },
				]}
				value={undefined}
				onChange={() => undefined}
				placeholder='Select outcome side'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const trigger = documentQueries.getByRole('button', { name: 'Outcome: Select outcome side' })
		expect(trigger).not.toBeNull()

		await act(() => {
			fireEvent.click(trigger)
		})

		const options = documentQueries.getAllByRole('option')
		expect(document.body.querySelectorAll('.enum-dropdown-option.selected').length).toBe(0)
		for (const option of options) {
			expect(option.getAttribute('aria-selected')).toBe('false')
		}
	})

	test('opens and closes from keyboard and outside interaction events', async () => {
		let changedValue: string | undefined
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				ariaLabel='Outcome'
				options={[
					{ label: 'Yes', value: 'yes' },
					{ label: 'No', value: 'no' },
				]}
				value={undefined}
				onChange={value => {
					changedValue = value
				}}
				placeholder='Select outcome side'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const trigger = documentQueries.getByRole('button', { name: 'Outcome: Select outcome side' })

		await act(() => {
			fireEvent.keyDown(trigger, { key: 'Enter' })
		})
		const openedByKeyboard = documentQueries.getAllByRole('option')
		expect(openedByKeyboard.length).toBe(2)
		expect(document.activeElement).toBe(openedByKeyboard[0] as HTMLElement)

		await act(() => {
			fireEvent.keyDown(openedByKeyboard[0] as HTMLElement, { key: 'ArrowDown' })
		})
		expect(document.activeElement).toBe(openedByKeyboard[1] as HTMLElement)

		await act(() => {
			fireEvent.click(openedByKeyboard[1] as HTMLElement)
		})
		expect(changedValue).toBe('no')
		expect(document.activeElement).toBe(trigger)

		await act(() => {
			fireEvent.click(trigger)
		})
		expect(documentQueries.getAllByRole('option').length).toBe(2)

		await act(() => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(document.body.querySelectorAll('.enum-dropdown-option').length).toBe(0)

		await act(() => {
			fireEvent.click(trigger)
		})

		const outsideButton = createMouseDownOutside()
		await act(() => {
			fireEvent.mouseDown(outsideButton)
		})
		expect(document.body.querySelectorAll('.enum-dropdown-option').length).toBe(0)
		expect(changedValue).toBe('no')
	})

	test('includes the selected value in the trigger accessible name when labeled', async () => {
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				ariaLabel='Question Type'
				options={[
					{ label: 'Binary', value: 'binary' },
					{ label: 'Categorical', value: 'categorical' },
				]}
				value='binary'
				onChange={() => undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('button', { name: 'Question Type: Binary' })).not.toBeNull()
	})

	test('handles Escape and reverse-arrow navigation across dropdown options', async () => {
		let changedValue: string | undefined
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				options={[
					{ label: 'Red', value: 'red' },
					{ label: 'Blue', value: 'blue' },
				]}
				value={undefined}
				onChange={value => {
					changedValue = value
				}}
				placeholder='Pick color'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const trigger = documentQueries.getByRole('button', { name: 'Pick color' })

		await act(() => {
			fireEvent.click(trigger)
		})

		const options = documentQueries.getAllByRole('option') as HTMLButtonElement[]
		const firstOption = options[0]
		const secondOption = options[1]
		if (firstOption === undefined || secondOption === undefined) throw new Error('Expected dropdown options to render')
		expect(options.length).toBe(2)

		await act(() => {
			secondOption.focus()
			fireEvent.keyDown(secondOption, { key: 'ArrowUp' })
		})
		expect(document.activeElement).toBe(firstOption)

		await act(() => {
			fireEvent.keyDown(firstOption, { key: 'Escape' })
		})
		expect(document.body.querySelectorAll('.enum-dropdown-option').length).toBe(0)
		expect(changedValue).toBeUndefined()
		expect(document.activeElement).toBe(trigger)
	})

	test('does not open when disabled', async () => {
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				disabled
				options={[
					{ label: 'Yes', value: 'yes' },
					{ label: 'No', value: 'no' },
				]}
				value={undefined}
				onChange={() => undefined}
				placeholder='Select outcome side'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const trigger = within(document.body).getByRole('button', { name: 'Select outcome side' })
		await act(() => {
			fireEvent.click(trigger)
		})
		expect(document.querySelector('.enum-dropdown-menu')).toBeNull()
	})

	test('closes via Escape from the trigger', async () => {
		let changedValue: string | undefined
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
				options={[
					{ label: 'High', value: 'high' },
					{ label: 'Low', value: 'low' },
				]}
				value={undefined}
				onChange={value => {
					changedValue = value
				}}
				placeholder='Select'
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const trigger = within(document.body).getByRole('button', { name: 'Select' })
		await act(() => {
			fireEvent.click(trigger)
		})
		expect(document.body.querySelectorAll('.enum-dropdown-option').length).toBe(2)

		await act(() => {
			fireEvent.keyDown(trigger, { key: 'Escape' })
		})
		expect(document.body.querySelectorAll('.enum-dropdown-option').length).toBe(0)
		expect(changedValue).toBeUndefined()
	})
})
