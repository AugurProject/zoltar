import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'

/** Execution protection shared by every Trading transaction: how far the price may move, and how long a signed transaction stays valid. */
export type TradeSettings = Readonly<{ slippageBps: bigint; validityMinutes: bigint }>

export const DEFAULT_TRADE_SETTINGS: TradeSettings = { slippageBps: 50n, validityMinutes: 20n }
export const SLIPPAGE_PRESETS_BPS: readonly bigint[] = [10n, 50n, 100n]
export const VALIDITY_PRESETS_MINUTES: readonly bigint[] = [10n, 20n, 60n]
const MAXIMUM_SLIPPAGE_BPS = 500n
const MAXIMUM_VALIDITY_MINUTES = 1_440n
const TRADE_SETTINGS_STORAGE_KEY = 'zoltar.trading.tradeSettings'

/** A slippage percentage from 0% to 5% with at most two decimals, in basis points. */
export function parseSlippagePercent(value: string) {
	const parsed = tryParseNonNegativeDecimalInput(value.trim(), 2)
	return parsed !== undefined && parsed <= MAXIMUM_SLIPPAGE_BPS ? parsed : undefined
}

/** A whole number of minutes from 1 to 1440. */
export function parseValidityMinutes(value: string) {
	const trimmed = value.trim()
	if (!/^\d+$/.test(trimmed)) return undefined
	const parsed = BigInt(trimmed)
	return parsed >= 1n && parsed <= MAXIMUM_VALIDITY_MINUTES ? parsed : undefined
}

export function formatSlippagePercent(slippageBps: bigint) {
	const whole = slippageBps / 100n
	const fraction = (slippageBps % 100n).toString().padStart(2, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

/** Stored settings are user-editable browser state, so anything malformed or out of range falls back to the defaults field by field. */
function parseStoredTradeSettings(raw: string | null | undefined): TradeSettings {
	if (raw === null || raw === undefined) return DEFAULT_TRADE_SETTINGS
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return DEFAULT_TRADE_SETTINGS
	}
	if (typeof parsed !== 'object' || parsed === null) return DEFAULT_TRADE_SETTINGS
	const slippage = Reflect.get(parsed, 'slippageBps')
	const validity = Reflect.get(parsed, 'validityMinutes')
	const slippageBps = typeof slippage === 'string' && /^\d+$/.test(slippage) && BigInt(slippage) <= MAXIMUM_SLIPPAGE_BPS ? BigInt(slippage) : DEFAULT_TRADE_SETTINGS.slippageBps
	const validityMinutes = typeof validity === 'string' ? (parseValidityMinutes(validity) ?? DEFAULT_TRADE_SETTINGS.validityMinutes) : DEFAULT_TRADE_SETTINGS.validityMinutes
	return { slippageBps, validityMinutes }
}

function serializeTradeSettings(settings: TradeSettings) {
	return JSON.stringify({ slippageBps: settings.slippageBps.toString(), validityMinutes: settings.validityMinutes.toString() })
}

export function loadTradeSettings() {
	try {
		return parseStoredTradeSettings(getBrowserStorage('localStorage')?.getItem(TRADE_SETTINGS_STORAGE_KEY))
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		return DEFAULT_TRADE_SETTINGS
	}
}

export function saveTradeSettings(settings: TradeSettings) {
	try {
		getBrowserStorage('localStorage')?.setItem(TRADE_SETTINGS_STORAGE_KEY, serializeTradeSettings(settings))
	} catch (error) {
		// Storage can be full or blocked; the settings still apply for this session.
		if (!(error instanceof DOMException)) throw error
	}
}
