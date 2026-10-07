/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { EnumDropdown } from '../components/EnumDropdown.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createMouseDownOutside() {
	const outsideButton = document.createElement('button')
	outsideButton.type = 'button'
	outsideButton.textContent = 'Outside'
	outsideButton.id = 'outside-button'
	document.body.appendChild(outsideButton)
	return outsideButton
}

type DropdownProps = Parameters<typeof EnumDropdown<string>>[0]

const yesNoOptions = [
	{ label: 'Yes', value: 'yes' },
	{ label: 'No', value: 'no' },
]

describe('EnumDropdown', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			document.querySelector('#outside-button')?.remove()
		},
	})

	/** Renders an unselected Yes/No dropdown unless the test overrides its props. */
	async function renderDropdown(overrides: Partial<DropdownProps> = {}) {
		const props: DropdownProps = { options: yesNoOptions, value: undefined, onChange: () => undefined, placeholder: 'Select outcome side', ...overrides }
		const renderedComponent = await renderIntoDocument(<EnumDropdown {...props} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return async (nextOverrides: Partial<DropdownProps>) => await act(() => render(<EnumDropdown {...props} {...nextOverrides} />, renderedComponent.container))
	}

	test('renders an explicit placeholder without silently selecting the first option', async () => {
		await renderDropdown({ ariaLabel: 'Outcome' })

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
		await renderDropdown({
			ariaLabel: 'Outcome',
			onChange: value => {
				changedValue = value
			},
		})
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

	test('keeps the menu open for internal Tab focus and closes after Tab moves outside', async () => {
		await renderDropdown()
		const trigger = within(document.body).getByRole('button', { name: 'Select outcome side' })

		await act(() => {
			fireEvent.click(trigger)
		})
		const options = within(document.body).getAllByRole('option') as HTMLButtonElement[]
		const firstOption = options[0]
		const lastOption = options.at(-1)
		const outsideButton = createMouseDownOutside()
		if (firstOption === undefined || lastOption === undefined) throw new Error('Expected open dropdown options')

		await act(() => {
			fireEvent.keyDown(firstOption, { key: 'Tab' })
			lastOption.focus()
		})
		expect(document.body.querySelector('.enum-dropdown-menu')).not.toBeNull()
		expect(document.activeElement).toBe(lastOption)

		await act(() => {
			fireEvent.keyDown(lastOption, { key: 'Tab' })
			outsideButton.focus()
		})
		expect(document.body.querySelector('.enum-dropdown-menu')).toBeNull()
		expect(document.activeElement).toBe(outsideButton)
	})

	test('includes the selected value in the trigger accessible name when labeled', async () => {
		await renderDropdown({
			ariaLabel: 'Question type',
			options: [
				{ label: 'Binary', value: 'binary' },
				{ label: 'Categorical', value: 'categorical' },
			],
			value: 'binary',
		})

		expect(within(document.body).getByRole('button', { name: 'Question type: Binary' })).not.toBeNull()
	})

	test('handles Escape and reverse-arrow navigation across dropdown options', async () => {
		let changedValue: string | undefined
		await renderDropdown({
			options: [
				{ label: 'Red', value: 'red' },
				{ label: 'Blue', value: 'blue' },
			],
			onChange: value => {
				changedValue = value
			},
			placeholder: 'Pick color',
		})

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
		await renderDropdown({ disabled: true })

		const trigger = within(document.body).getByRole('button', { name: 'Select outcome side' })
		await act(() => {
			fireEvent.click(trigger)
		})
		expect(document.querySelector('.enum-dropdown-menu')).toBeNull()
	})

	test('closes an open menu when it becomes disabled', async () => {
		const rerender = await renderDropdown({ disabled: false })

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Select outcome side' }))
		})
		expect(within(document.body).getAllByRole('option')).toHaveLength(2)

		await rerender({ disabled: true })
		expect(document.querySelector('.enum-dropdown-menu')).toBeNull()
	})

	test('dismisses only the menu on Escape so an enclosing dialog stays open', async () => {
		const documentEscapes: string[] = []
		const recordEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') documentEscapes.push(event.key)
		}
		document.addEventListener('keydown', recordEscape)
		try {
			await renderDropdown({ ariaLabel: 'Outcome' })
			const trigger = within(document.body).getByRole('button', { name: 'Outcome: Select outcome side' })
			await act(() => {
				fireEvent.click(trigger)
			})
			const firstOption = within(document.body).getAllByRole('option')[0]
			if (firstOption === undefined) throw new Error('Expected an option')
			await act(() => {
				fireEvent.keyDown(firstOption, { key: 'Escape' })
			})
			expect(document.querySelector('.enum-dropdown-menu')).toBeNull()
			expect(documentEscapes).toEqual([])

			await act(() => {
				fireEvent.click(trigger)
			})
			await act(() => {
				fireEvent.keyDown(trigger, { key: 'Escape' })
			})
			expect(document.querySelector('.enum-dropdown-menu')).toBeNull()
			expect(documentEscapes).toEqual([])

			// With the menu closed, Escape belongs to the enclosing dialog again.
			await act(() => {
				fireEvent.keyDown(trigger, { key: 'Escape' })
			})
			expect(documentEscapes).toEqual(['Escape'])
		} finally {
			document.removeEventListener('keydown', recordEscape)
		}
	})

	test('keeps options out of the Tab order, names the listbox from its label, and supports Home, End, and type-ahead', async () => {
		await renderDropdown({
			ariaLabel: 'Sort',
			options: [
				{ label: 'Closing soon', value: 'closing' },
				{ label: 'Liquidity', value: 'liquidity' },
				{ label: 'Recently added', value: 'recent' },
			],
			value: 'liquidity',
		})
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Sort: Liquidity' }))
		})
		const listbox = within(document.body).getByRole('listbox', { name: 'Sort' })
		const options = within(listbox).getAllByRole('option') as HTMLButtonElement[]
		const [closing, liquidity, recent] = options
		if (closing === undefined || liquidity === undefined || recent === undefined) throw new Error('Expected three options')
		expect(options.map(option => option.tabIndex)).toEqual([-1, -1, -1])
		expect(document.activeElement).toBe(liquidity)

		await act(() => {
			fireEvent.keyDown(liquidity, { key: 'End' })
		})
		expect(document.activeElement).toBe(recent)
		await act(() => {
			fireEvent.keyDown(recent, { key: 'Home' })
		})
		expect(document.activeElement).toBe(closing)
		await act(() => {
			fireEvent.keyDown(closing, { key: 'r' })
		})
		expect(document.activeElement).toBe(recent)
		await act(() => {
			fireEvent.keyDown(recent, { key: 'L' })
		})
		expect(document.activeElement).toBe(liquidity)
	})

	test('closes via Escape from the trigger', async () => {
		let changedValue: string | undefined
		await renderDropdown({
			options: [
				{ label: 'High', value: 'high' },
				{ label: 'Low', value: 'low' },
			],
			onChange: value => {
				changedValue = value
			},
			placeholder: 'Select',
		})

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
