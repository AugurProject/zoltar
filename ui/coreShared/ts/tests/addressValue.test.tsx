/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createRef } from 'preact'
import { AddressValue, ReadOnlyAddressValue } from '../components/AddressValue.js'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('AddressValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let clipboardWriteText = mock(async () => undefined)

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
			clipboardWriteText = mock(async () => undefined)

			Reflect.set(navigator, 'clipboard', {
				writeText: clipboardWriteText,
			})
			Reflect.set(domEnvironment.window.navigator, 'clipboard', {
				writeText: clipboardWriteText,
			})
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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
		expect(copyButton.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(copyButton.getAttribute('aria-label')).toBe(`Copy address ${address}`)

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(copyButton.childNodes[0]?.textContent).toBe('Copied address')
		})
		expect(documentQueries.getByRole('status').textContent).toBe('Copied address')
	})

	test.each([true, false])('measures available space and responds to resizing with copyable=%s', async copyable => {
		let resize = () => {}
		const disconnect = mock(() => {})
		const previousObserver = globalThis.ResizeObserver
		Reflect.set(globalThis, 'ResizeObserver', function (callback: () => void) {
			resize = callback
			return { observe: () => {}, disconnect }
		})
		try {
			const address = '0x1234567890abcdef1234567890abcdef12345678'
			const rendered = await renderIntoDocument(<AddressValue address={address} copyable={copyable} />)
			cleanupRenderedComponent = rendered.cleanup
			const text = document.querySelector('.address-value-text')
			const full = document.querySelector('.address-value-full')
			if (!(text instanceof HTMLElement) || !(full instanceof HTMLElement)) throw new Error('Address measurement elements are missing')
			Reflect.defineProperty(full, 'scrollWidth', { configurable: true, value: 420 })
			for (const width of [420, 180, 500]) {
				Reflect.defineProperty(text, 'clientWidth', { configurable: true, value: width })
				await act(() => resize())
				expect(text.getAttribute('data-abbreviated')).toBe(String(width < 420))
			}
			await rendered.cleanup()
			cleanupRenderedComponent = undefined
			expect(disconnect).toHaveBeenCalled()
		} finally {
			Reflect.set(globalThis, 'ResizeObserver', previousObserver)
		}
	})

	test('restores a compact control from its available slot rather than its shortened text width', async () => {
		let resize = () => {}
		const previousObserver = globalThis.ResizeObserver
		Reflect.set(globalThis, 'ResizeObserver', function (callback: () => void) {
			resize = callback
			return { observe: () => {}, disconnect: () => {} }
		})
		try {
			const slot = createRef<HTMLDivElement>()
			const control = createRef<HTMLButtonElement>()
			const rendered = await renderIntoDocument(
				<div ref={slot}>
					<button ref={control}>
						<ReadOnlyAddressValue address='0x1234567890abcdef1234567890abcdef12345678' widthConstraint={{ slot, control }} />
					</button>
				</div>,
			)
			cleanupRenderedComponent = rendered.cleanup
			const text = rendered.container.querySelector('.address-value-text')
			const full = rendered.container.querySelector('.address-value-full')
			if (!(text instanceof HTMLElement) || !(full instanceof HTMLElement) || slot.current === null || control.current === null) throw new Error('Address layout is missing')
			Reflect.defineProperty(full, 'scrollWidth', { value: 420 })
			Reflect.defineProperty(text, 'clientWidth', { value: 150 })
			Reflect.defineProperty(control.current, 'offsetWidth', { value: 190 })
			for (const width of [250, 460, 500, 250]) {
				Reflect.defineProperty(slot.current, 'clientWidth', { configurable: true, value: width })
				await act(() => resize())
				expect(text.getAttribute('data-abbreviated')).toBe(String(width < 460))
			}
		} finally {
			Reflect.set(globalThis, 'ResizeObserver', previousObserver)
		}
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
			expect(copyButton.textContent).toBe('Copied address')
		})
		expect(copyButton.getAttribute('title')).toBe(address)
	})

	test('shows the full inline address when it fits, while keeping the complete copy target', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(copyButton.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(copyButton.querySelector('.address-value-text')?.getAttribute('data-abbreviated')).toBe('false')
		expect(copyButton.getAttribute('title')).toBe(address)
		await act(() => fireEvent.click(copyButton))
		await waitFor(() => expect(copyButton.textContent).toBe('Copied address'))
	})

	test('uses a shorter visible hash while preserving the complete copy target', async () => {
		const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
		const renderedComponent = await renderIntoDocument(<AddressValue address={hash} responsiveAbbreviation compactAbbreviation />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${hash}` })
		expect(copyButton.querySelector('.address-value-abbreviated')?.textContent).toBe('0x1234…cdef')
		expect(copyButton.querySelector('.address-value-full')?.textContent).toBe(hash)
		await act(() => fireEvent.click(copyButton))
		await waitFor(() => expect(copyButton.textContent).toBe('Copied address'))
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
		expect(copyButton.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(error.textContent).toBe('Copy failed — select the value and copy it manually.')
		expect(copyButton.getAttribute('aria-describedby')).toBe(error.id)
		expect((documentQueries.getByLabelText('Exact value for manual copy') as HTMLInputElement).value).toBe(address)
	})
})
