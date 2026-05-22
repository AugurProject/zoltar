/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { EnumDropdown } from '../components/EnumDropdown.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders an explicit placeholder without silently selecting the first option', async () => {
		const renderedComponent = await renderIntoDocument(
			<EnumDropdown
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
		const trigger = documentQueries.getByRole('button', { name: 'Select outcome side' })
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
})
