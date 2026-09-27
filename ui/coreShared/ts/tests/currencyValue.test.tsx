/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { CurrencyValue } from '../components/CurrencyValue.js'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('CurrencyValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	async function renderCurrencyValue(overrides: Partial<Parameters<typeof CurrencyValue>[0]> = {}) {
		const baseProps: Parameters<typeof CurrencyValue>[0] = {
			suffix: 'ETH',
			value: 999999990000n * 10n ** 18n,
		}

		const renderedComponent = await renderIntoDocument(<CurrencyValue {...baseProps} {...overrides} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return { container: renderedComponent.container, documentQueries: within(document.body) }
	}

	installDomTestLifecycle({
		beforeTest: () => {
			Reflect.set(navigator, 'clipboard', {
				writeText: mock(async () => undefined),
			})
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('renders plain text with the exact value and unit in its title by default', async () => {
		const { container, documentQueries } = await renderCurrencyValue({ value: 1_234_567n * 10n ** 15n })

		expect(documentQueries.queryByRole('button')).toBeNull()
		const value = container.querySelector('.currency-value')
		expect(value?.textContent).toBe('≈ 1 234.57 ETH')
		expect(value?.getAttribute('title')).toBe('1 234.567 ETH')
	})

	test('omits the approximation marker when rounding keeps every digit, including zero', async () => {
		const { container } = await renderCurrencyValue({ value: 0n })
		expect(container.querySelector('.currency-value')?.textContent).toBe('0.00 ETH')

		await act(() => {
			render(<CurrencyValue suffix='ETH' value={2n * 10n ** 18n} />, container)
		})
		expect(container.querySelector('.currency-value')?.textContent).toBe('2.00 ETH')
	})

	test('compact notation is deterministic and marks only lossy values', async () => {
		const { container } = await renderCurrencyValue({ notation: 'compact' })
		expect(container.querySelector('.currency-value')?.textContent).toBe('≈ 1T ETH')

		await act(() => {
			render(<CurrencyValue notation='compact' suffix='ETH' value={10_000n * 10n ** 18n} />, container)
		})
		expect(container.querySelector('.currency-value')?.textContent).toBe('10k ETH')

		await act(() => {
			render(<CurrencyValue notation='compact' suffix='ETH' value={999n * 10n ** 18n} />, container)
		})
		expect(container.querySelector('.currency-value')?.textContent).toBe('999.00 ETH')
	})

	test('attaches percent and multiplier suffixes without a space', async () => {
		const { container } = await renderCurrencyValue({ suffix: '%', value: 946n * 10n ** 16n })
		expect(container.querySelector('.currency-value')?.textContent).toBe('9.46%')
		expect(container.querySelector('.currency-value')?.getAttribute('title')).toBe('9.46%')
	})

	test('names the unit in the copy button when copying is enabled', async () => {
		const { documentQueries } = await renderCurrencyValue({ copyable: true, notation: 'compact' })
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000 ETH' })

		expect(copyButton.textContent).toBe('≈ 1T ETH')
		expect(copyButton.getAttribute('title')).toBe('999 999 990 000 ETH')
		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(copyButton.textContent).toBe('Copied')
		})
	})

	test('uses the accessible unit when a surrounding label shows the unit instead of a suffix', async () => {
		const { documentQueries } = await renderCurrencyValue({ accessibleUnit: 'WETH', copyable: true, notation: 'compact', suffix: '', value: 10_000n * 10n ** 18n })
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 10 000 WETH' })

		expect(copyButton.textContent).toBe('10k')
		expect(copyButton.getAttribute('title')).toBe('10 000 WETH')
	})

	test('clears copied feedback when the exact value changes', async () => {
		const renderedComponent = await renderIntoDocument(<CurrencyValue copyable value={1n * 10n ** 18n} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 1' })

		await act(() => {
			fireEvent.click(copyButton)
		})
		await waitFor(() => {
			expect(copyButton.textContent).toBe('Copied')
		})

		await act(() => {
			render(<CurrencyValue copyable value={2n * 10n ** 18n} />, renderedComponent.container)
		})
		expect(documentQueries.getByRole('button', { name: 'Copy exact value 2' }).textContent).toBe('2.00')
	})

	test('keeps an exact-precision value fully visible without an approximation marker', async () => {
		const { container } = await renderCurrencyValue({ precision: 'exact', value: 137760122n })
		const value = container.querySelector('.currency-value')

		expect(value?.textContent).toBe('0.000000000137760122 ETH')
		expect(value?.textContent).not.toContain('≈')
	})

	test('marks a rounded tiny value as approximate', async () => {
		const { container } = await renderCurrencyValue({ value: 137760122n })
		expect(container.querySelector('.currency-value')?.textContent).toBe('≈ 0.00000000014 ETH')
	})

	test('shows the exact value when rounded output would collapse to zero', async () => {
		const { container } = await renderCurrencyValue({ exactWhenRoundedToZero: true, value: 1n })
		const value = container.querySelector('.currency-value')

		expect(value?.textContent).toBe('0.000000000000000001 ETH')
		expect(value?.textContent).not.toContain('≈')
	})

	test('keeps maximum exact values inside the ellipsizing number-unit group', async () => {
		const maximumUint256 = (1n << 256n) - 1n
		const formattedMaximum = maximumUint256.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
		const { documentQueries } = await renderCurrencyValue({ copyable: true, precision: 'exact', units: 0, value: maximumUint256 })
		const copyButton = documentQueries.getByRole('button', { name: `Copy exact value ${formattedMaximum} ETH` })
		const numberUnit = copyButton.querySelector('.currency-value-number-unit')

		expect(numberUnit).not.toBeNull()
		expect(numberUnit?.textContent).toContain('ETH')
		expect(copyButton.getAttribute('title')).toBe(`${formattedMaximum} ETH`)
	})

	test('keeps the value visible and associates an announced clipboard error', async () => {
		const clipboard = {
			writeText: async () => {
				throw new DOMException('clipboard unavailable', 'NotAllowedError')
			},
		}
		Reflect.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
		Reflect.defineProperty(window.navigator, 'clipboard', { configurable: true, value: clipboard })
		const { documentQueries } = await renderCurrencyValue({ copyable: true })
		const copyButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000 ETH' })

		await act(() => {
			fireEvent.click(copyButton)
		})
		const error = await waitFor(() => documentQueries.getByRole('alert'))
		expect(copyButton.textContent).toBe('999 999 990 000.00 ETH')
		expect(error.textContent).toBe('Copy failed — select the value and copy it manually.')
		expect(copyButton.getAttribute('aria-describedby')).toBe(error.id)
		expect((documentQueries.getByLabelText('Exact value for manual copy') as HTMLInputElement).value).toBe('999 999 990 000')
	})
})
