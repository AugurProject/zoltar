/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { AddressValue } from '../components/AddressValue.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('AddressValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let setClientWidth = (_nextWidth: number) => undefined
	let setMeasureWidth = (_nextWidth: number) => undefined
	let clipboardWriteText = mock(async () => undefined)

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let currentClientWidth = 300
		let currentMeasureWidth = 120

		clipboardWriteText = mock(async () => undefined)

		const originalGetBoundingClientRect = domEnvironment.window.HTMLElement.prototype.getBoundingClientRect
		Object.defineProperty(domEnvironment.window.HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get() {
				if (this.classList.contains('address-value')) return currentClientWidth
				return 0
			},
		})

		domEnvironment.window.HTMLElement.prototype.getBoundingClientRect = function () {
			if (this.classList.contains('address-value-measure')) return new domEnvironment.window.DOMRect(0, 0, currentMeasureWidth, 0)
			return originalGetBoundingClientRect.call(this)
		}

		Reflect.set(navigator, 'clipboard', {
			writeText: clipboardWriteText,
		})
		Reflect.set(domEnvironment.window.navigator, 'clipboard', {
			writeText: clipboardWriteText,
		})

		setClientWidth = nextWidth => {
			currentClientWidth = nextWidth
		}

		setMeasureWidth = nextWidth => {
			currentMeasureWidth = nextWidth
		}
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
		setClientWidth(300)
		setMeasureWidth(120)

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

	test('shortens the displayed address when it does not fit the button width', async () => {
		const address = '0x1234567890abcdef1234567890abcdef12345678'
		setClientWidth(40)
		setMeasureWidth(160)
		const renderedComponent = await renderIntoDocument(<AddressValue address={address} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		const copyButton = documentQueries.getByRole('button', { name: `Copy address ${address}` }) as HTMLButtonElement
		expect(copyButton.childNodes[0]?.textContent).toBe('0x1234…5678')
	})
})
