/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { LookupFieldRow } from '../components/LookupFieldRow.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('LookupFieldRow', () => {
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

	test('renders the shared form input with forwarded state and action content', async () => {
		const renderedComponent = await renderIntoDocument(<LookupFieldRow action={<button type='button'>Refresh</button>} disabled inputClassName='custom-input' invalid label='Wallet Address' onInput={() => undefined} placeholder='0x...' value='0x123' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = within(document.body).getByRole('textbox') as HTMLInputElement

		expect(input.classList.contains('form-input')).toBe(true)
		expect(input.classList.contains('custom-input')).toBe(true)
		expect(input.disabled).toBe(true)
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.placeholder).toBe('0x...')
		expect(within(document.body).getByText('Refresh')).not.toBeNull()
	})

	test('forwards input changes through the shared input wrapper', async () => {
		let nextValue = ''
		const renderedComponent = await renderIntoDocument(
			<LookupFieldRow
				label='Pool Address'
				onInput={value => {
					nextValue = value
				}}
				value=''
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const input = within(document.body).getByRole('textbox') as HTMLInputElement
		await act(() => {
			fireEvent.input(input, {
				target: { value: '0xabc' },
			})
		})

		expect(nextValue).toBe('0xabc')
	})
})
