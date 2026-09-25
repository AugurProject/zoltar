import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { TradeSettingsPanel } from '../../components/TradeSettingsPanel.js'
import { DEFAULT_TRADE_SETTINGS, formatSlippagePercent, loadTradeSettings, saveTradeSettings, type TradeSettings } from '../../lib/tradeSettings.js'

const STORAGE_KEY = 'zoltar.trading.tradeSettings'

function storedSettings(raw: string | undefined) {
	if (raw === undefined) window.localStorage.removeItem(STORAGE_KEY)
	else window.localStorage.setItem(STORAGE_KEY, raw)
	return loadTradeSettings()
}

describe('trade settings storage', () => {
	installDomTestLifecycle()

	test('round-trips settings and falls back field by field on malformed storage', () => {
		const settings: TradeSettings = { slippageBps: 125n, validityMinutes: 45n }
		saveTradeSettings(settings)
		expect(loadTradeSettings()).toEqual(settings)
		expect(storedSettings(undefined)).toEqual(DEFAULT_TRADE_SETTINGS)
		expect(storedSettings('not json')).toEqual(DEFAULT_TRADE_SETTINGS)
		expect(storedSettings('{"slippageBps":"900","validityMinutes":"30"}')).toEqual({ slippageBps: DEFAULT_TRADE_SETTINGS.slippageBps, validityMinutes: 30n })
		expect(storedSettings('{"slippageBps":"10","validityMinutes":"0"}')).toEqual({ slippageBps: 10n, validityMinutes: DEFAULT_TRADE_SETTINGS.validityMinutes })
	})

	test('formats basis points as a trimmed percentage', () => {
		expect(formatSlippagePercent(50n)).toBe('0.5')
		expect(formatSlippagePercent(100n)).toBe('1')
		expect(formatSlippagePercent(125n)).toBe('1.25')
	})

	test('applies presets and valid custom values, and flags invalid custom values without applying them', async () => {
		const changes: TradeSettings[] = []
		const rendered = await renderIntoDocument(<TradeSettingsPanel settings={DEFAULT_TRADE_SETTINGS} onChange={settings => changes.push(settings)} />)
		const preset = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '1%')
		if (!(preset instanceof HTMLButtonElement)) throw new Error('Missing 1% preset')
		expect(Array.from(document.querySelectorAll('button[aria-pressed="true"]')).map(button => button.textContent)).toEqual(['0.5%', '20 min'])
		await act(() => preset.click())
		expect(changes.at(-1)).toEqual({ slippageBps: 100n, validityMinutes: 20n })
		const [slippageInput, validityInput] = Array.from(document.querySelectorAll('input'))
		if (slippageInput === undefined || validityInput === undefined) throw new Error('Missing custom inputs')
		await act(() => {
			slippageInput.value = '9'
			slippageInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(changes).toHaveLength(1)
		expect(slippageInput.getAttribute('aria-invalid')).toBe('true')
		expect(document.body.textContent).toContain('Enter 0% to 5%')
		await act(() => {
			validityInput.value = '45'
			validityInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(changes.at(-1)).toEqual({ slippageBps: 50n, validityMinutes: 45n })
		await rendered.cleanup()
	})
})
