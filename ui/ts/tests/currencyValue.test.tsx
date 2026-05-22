/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { CurrencyValue } from '../components/CurrencyValue.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('CurrencyValue', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let setClientWidth = (_nextWidth: number) => undefined
	let setMeasureWidth = (_nextWidth: number) => undefined
	let triggerResizeObservers = () => undefined

	async function renderCurrencyValue(overrides: Partial<Parameters<typeof CurrencyValue>[0]> = {}) {
		const baseProps: Parameters<typeof CurrencyValue>[0] = {
			compactWhenOverflow: true,
			suffix: 'ETH',
			value: 999999990000n * 10n ** 18n,
		}

		const renderedComponent = await renderIntoDocument(<CurrencyValue {...baseProps} {...overrides} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return within(document.body)
	}

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup

		let currentClientWidth = 200
		let currentMeasureWidth = 120
		const resizeObservers: MockResizeObserver[] = []
		const originalGetBoundingClientRect = domEnvironment.window.HTMLElement.prototype.getBoundingClientRect

		Object.defineProperty(domEnvironment.window.HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get() {
				if (this.classList.contains('currency-value')) return currentClientWidth
				return 0
			},
		})

		domEnvironment.window.HTMLElement.prototype.getBoundingClientRect = function () {
			if (this.classList.contains('currency-value-measure')) {
				return new domEnvironment.window.DOMRect(0, 0, currentMeasureWidth, 0)
			}
			return originalGetBoundingClientRect.call(this)
		}

		class MockResizeObserver implements ResizeObserver {
			callback: ResizeObserverCallback

			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
				resizeObservers.push(this)
			}

			disconnect() {}

			observe(_target: Element, _options?: ResizeObserverOptions) {}

			unobserve(_target: Element) {}
		}

		Reflect.set(globalThis, 'ResizeObserver', MockResizeObserver)
		Reflect.set(navigator, 'clipboard', {
			writeText: mock(async () => undefined),
		})

		setClientWidth = nextWidth => {
			currentClientWidth = nextWidth
		}

		setMeasureWidth = nextWidth => {
			currentMeasureWidth = nextWidth
		}

		triggerResizeObservers = () => {
			for (const observer of resizeObservers) {
				observer.callback([], observer)
			}
		}
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		Reflect.deleteProperty(globalThis, 'ResizeObserver')
		triggerResizeObservers = () => undefined
		setClientWidth = (_nextWidth: number) => undefined
		setMeasureWidth = (_nextWidth: number) => undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('compacts a large balance when the normal display value does not fit', async () => {
		setClientWidth(80)
		setMeasureWidth(180)

		const documentQueries = await renderCurrencyValue()
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })
		expect(copyButton.textContent).toBe('≈ 1T ETH')
	})

	test('keeps the full display value when enough width is available', async () => {
		setClientWidth(240)
		setMeasureWidth(180)

		const documentQueries = await renderCurrencyValue()
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })
		expect(copyButton.textContent).toBe('≈ 999 999 990 000.00 ETH')
	})

	test('re-expands from compact to full after a resize observer update', async () => {
		setClientWidth(80)
		setMeasureWidth(180)

		const documentQueries = await renderCurrencyValue()
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })
		expect(copyButton.textContent).toBe('≈ 1T ETH')

		setClientWidth(240)
		await act(() => {
			triggerResizeObservers()
		})

		expect(copyButton.textContent).toBe('≈ 999 999 990 000.00 ETH')
	})

	test('keeps the exact hover title and copy label while compacted', async () => {
		setClientWidth(80)
		setMeasureWidth(180)

		const documentQueries = await renderCurrencyValue()
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })

		expect(copyButton.getAttribute('title')).toBe('999 999 990 000 ETH')
		await act(async () => {
			fireEvent.click(copyButton)
			await Promise.resolve()
		})
		expect(copyButton.textContent).toBe('Copied')
	})
})
