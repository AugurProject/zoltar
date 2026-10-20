/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createRef } from 'preact'
import { AddressValue } from '../components/AddressValue.js'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '../wallet/networkProfile.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('AddressValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let clipboardWriteText = mock(async () => undefined)

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
			clipboardWriteText = mock(async () => undefined)

			Reflect.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWriteText } })
			Reflect.defineProperty(domEnvironment.window.navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWriteText } })
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

	test('opens the address on Etherscan independently of copying it', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const rendered = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = rendered.cleanup
		const link = within(document.body).getByRole('link')
		expect(link.getAttribute('href')).toBe(`https://sepolia.etherscan.io/address/${address}`)
		expect(link.getAttribute('target')).toBe('_blank')
		expect(link.getAttribute('rel')).toBe('noopener noreferrer')
		const copy = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(link.contains(copy)).toBe(false)
		expect(copy.contains(link)).toBe(false)
		await act(() => fireEvent.click(copy))
		await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(address))
	})

	test('uses an explicit mainnet profile while the application is on Sepolia', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const rendered = await renderIntoDocument(<AddressValue address={address} explorerProfile={MAINNET_NETWORK_PROFILE} />)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).getByRole('link').getAttribute('href')).toBe(`https://etherscan.io/address/${address}`)
	})

	test('keeps address copying keyboard accessible inside a disabled transaction fieldset', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const rendered = await renderIntoDocument(
			<fieldset disabled>
				<AddressValue address={address} />
			</fieldset>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const copy = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(copy.matches(':disabled')).toBe(false)
		copy.focus()
		expect(document.activeElement).toBe(copy)
		await act(() => fireEvent.keyDown(copy, { key: 'Enter' }))
		await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(1))
		await act(() => fireEvent.keyDown(copy, { key: ' ' }))
		expect(clipboardWriteText).toHaveBeenCalledTimes(1)
		await act(() => copy.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ' })))
		await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(2))
		expect(clipboardWriteText).toHaveBeenLastCalledWith(address)
	})

	test('keeps copying available when the network has no explorer', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const rendered = await renderIntoDocument(<AddressValue address={address} explorerProfile={{ ...SEPOLIA_NETWORK_PROFILE, transactionExplorerBaseUrl: undefined }} />)
		cleanupRenderedComponent = rendered.cleanup
		const link = within(document.body).getByRole('link')
		expect(link.getAttribute('aria-disabled')).toBe('true')
		expect(link.getAttribute('href')).toBeNull()
		expect(link.getAttribute('title')).toBe('Explorer unavailable for this network.')
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: `Copy address ${address}` })))
		await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(address))
	})

	test('copies the full address when clicked and confirms it beside the unchanged button', async () => {
		const address = '0x0000000000000000000000000000000000000001'
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: `Copy address ${address}` })
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(copyButton.getAttribute('aria-label')).toBe(`Copy address ${address}`)
		expect(copyButton.querySelector('.copy-glyph[aria-hidden="true"]')).not.toBeNull()
		// The live region is mounted before the copy so the confirmation is announced.
		const status = document.querySelector('.copy-feedback')
		if (status === null) throw new Error('Expected the copy confirmation region')
		expect(status.getAttribute('aria-live')).toBe('polite')
		expect(status.textContent).toBe('')
		expect(copyButton.contains(status)).toBe(false)

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(status.textContent).toBe('Copied address')
		})
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(copyButton.getAttribute('aria-label')).toBe(`Copy address ${address}`)
		expect(copyButton.getAttribute('data-copied')).toBe('true')
	})

	test('measures available space and responds to resizing', async () => {
		let resize = () => {}
		const disconnect = mock(() => {})
		const previousObserver = globalThis.ResizeObserver
		Reflect.set(globalThis, 'ResizeObserver', function (callback: () => void) {
			resize = callback
			return { observe: () => {}, disconnect }
		})
		try {
			const address = '0x1234567890abcdef1234567890abcdef12345678'
			const rendered = await renderIntoDocument(<AddressValue address={address} />)
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
			const control = createRef<HTMLSpanElement>()
			const rendered = await renderIntoDocument(
				<div ref={slot}>
					<span ref={control}>
						<AddressValue address='0x1234567890abcdef1234567890abcdef12345678' widthConstraint={{ slot, control }} />
					</span>
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
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(document.querySelector('.address-value-abbreviated')?.textContent).toBe('0x123456…345678')
		expect(document.querySelector('.address-value-abbreviated')?.getAttribute('aria-hidden')).toBe('true')

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(document.querySelector('.copy-feedback')?.textContent).toBe('Copied address')
		})
		expect(document.querySelector('.address-value-abbreviated')?.textContent).toBe('0x123456…345678')
		expect(copyButton.getAttribute('title')).toBe(address)
	})

	test('shows the full inline address when it fits, while keeping the complete copy target', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(document.querySelector('.address-value-text')?.getAttribute('data-abbreviated')).toBe('false')
		expect(copyButton.getAttribute('title')).toBe(address)
		await act(() => fireEvent.click(copyButton))
		await waitFor(() => expect(document.querySelector('.copy-feedback')?.textContent).toBe('Copied address'))
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
	})

	test('always shows the start-and-end form when abbreviated, while keeping the complete copy target', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(<AddressValue abbreviated address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${address}` })
		expect(document.querySelector('.address-value [aria-hidden="true"]')?.textContent).toBe('0x123456…345678')
		expect(document.querySelector('.address-value .visually-hidden')?.textContent).toBe(address)
		expect(copyButton.getAttribute('title')).toBe(address)
		await act(() => fireEvent.click(copyButton))
		await waitFor(() => expect(document.querySelector('.copy-feedback')?.textContent).toBe('Copied address'))
	})

	test('keeps the full address readable by assistive technology when the explorer address is abbreviated', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		const renderedComponent = await renderIntoDocument(<AddressValue abbreviated address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const value = document.querySelector('.address-value')
		expect(value?.querySelector('.visually-hidden')?.textContent).toBe(address)
		expect(value?.querySelector('[aria-hidden="true"]')?.textContent).toBe('0x123456…345678')
		expect(value?.textContent).toContain(address)
	})

	test('keeps non-address values copyable without creating an invalid explorer URL', async () => {
		const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
		const renderedComponent = await renderIntoDocument(<AddressValue address={hash} compactAbbreviation />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const copyButton = within(document.body).getByRole('button', { name: `Copy address ${hash}` })
		expect(document.querySelector('a[href]')).toBeNull()
		expect(within(document.body).getByRole('link').getAttribute('aria-disabled')).toBe('true')
		expect(document.querySelector('.address-value-abbreviated')?.textContent).toBe('0x1234…cdef')
		expect(document.querySelector('.address-value-full')?.textContent).toBe(hash)
		await act(() => fireEvent.click(copyButton))
		await waitFor(() => expect(document.querySelector('.copy-feedback')?.textContent).toBe('Copied address'))
		expect(document.querySelector('.address-value-abbreviated')?.textContent).toBe('0x1234…cdef')
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
		expect(document.querySelector('.address-value-full')?.textContent).toBe(address)
		expect(error.textContent).toBe('Copy failed — select the value and copy it manually.')
		expect(copyButton.getAttribute('aria-describedby')).toBe(error.id)
		expect(documentQueries.getByLabelText('Exact value for manual copy').textContent).toBe(address)
	})
})
