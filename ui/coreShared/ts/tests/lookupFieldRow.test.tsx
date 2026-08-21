/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { LookupFieldRow } from '../components/LookupFieldRow.js'
import { AddressValue } from '../components/AddressValue.js'
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

		const documentQueries = within(document.body)
		const input = documentQueries.getByLabelText('Wallet Address') as HTMLInputElement

		expect(input.classList.contains('form-input')).toBe(true)
		expect(input.classList.contains('custom-input')).toBe(true)
		expect(input.disabled).toBe(true)
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(input.placeholder).toBe('0x...')
		expect(documentQueries.getByRole('button', { name: 'Refresh' })).not.toBeNull()
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

	test('shows a copyable resolved address separately from the editable lookup value', async () => {
		const address = '0x00000000000000000000000000000000000000A1'
		const renderedComponent = await renderIntoDocument(<LookupFieldRow label='Pool Address' onInput={() => undefined} resolvedValue={<AddressValue address={address} />} resolvedValueLabel='Selected Pool' value={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Selected Pool')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: `Copy address ${address}` }).textContent).toBe(address)
	})
})
