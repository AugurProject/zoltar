/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { AddressValue } from '../components/AddressValue.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('AddressValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let clipboardWriteText = mock(async () => undefined)

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup

		clipboardWriteText = mock(async () => undefined)

		Reflect.set(navigator, 'clipboard', {
			writeText: clipboardWriteText,
		})
		Reflect.set(domEnvironment.window.navigator, 'clipboard', {
			writeText: clipboardWriteText,
		})
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders a placeholder when no address is available', async () => {
		const renderedComponent = await renderIntoDocument(<AddressValue address={undefined} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('—')).not.toBeNull()
		expect(document.body.querySelector('button')).toBeNull()
	})

	test('copies the full address when clicked and shows copied state', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: `Copy address ${address}` }) as HTMLButtonElement
		expect(copyButton.childNodes[0]?.textContent).toBe(address)
		expect(copyButton.getAttribute('aria-label')).toBe(`Copy address ${address}`)

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(copyButton.childNodes[0]?.textContent).toBe('Copied')
		})
	})

	test('keeps the complete address visible in constrained layouts', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(
			<div style={{ width: '4rem' }}>
				<AddressValue address={address} />
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		const copyButton = documentQueries.getByRole('button', { name: `Copy address ${address}` }) as HTMLButtonElement
		expect(copyButton.textContent).toBe(address)
		expect(copyButton.querySelector('.address-value-measure')).toBeNull()
	})

	test('provides a start-and-end abbreviation without changing the accessible name or copied value', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} responsiveAbbreviation />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(copyButton.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(copyButton.querySelector('.address-value-abbreviated')?.textContent).toBe('0x123456…345678')
		expect(copyButton.querySelector('.address-value-abbreviated')?.getAttribute('aria-hidden')).toBe('true')

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(copyButton.textContent).toBe('Copied')
		})
		expect(copyButton.getAttribute('title')).toBe(address)
	})

	test('keeps the address visible and associates an announced clipboard error', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const clipboard = {
			writeText: async () => {
				throw new DOMException('clipboard unavailable', 'NotAllowedError')
			},
		}
		Reflect.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
		Reflect.defineProperty(window.navigator, 'clipboard', { configurable: true, value: clipboard })
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: `Copy address ${address}` })

		await act(() => {
			fireEvent.click(copyButton)
		})
		const error = await waitFor(() => documentQueries.getByRole('alert'))
		expect(copyButton.textContent).toBe(address)
		expect(error.textContent).toBe('Copy failed — select the value and copy it manually.')
		expect(copyButton.getAttribute('aria-describedby')).toBe(error.id)
		expect((documentQueries.getByLabelText('Exact value for manual copy') as HTMLInputElement).value).toBe(address)
	})
})
