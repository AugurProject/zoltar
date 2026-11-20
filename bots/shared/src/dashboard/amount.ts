/** Expands the exponent notation `String(number)` uses for small magnitudes into plain decimal digits. */
function plainNumberString(value: number) {
	if (Object.is(value, -0)) return '0'
	const text = String(value)
	const match = /^(-?)(\d)(?:\.(\d+))?e-(\d+)$/.exec(text)
	if (match === null) return text
	const [, sign = '', leading = '', rest = '', exponent = '1'] = match
	return `${sign}0.${'0'.repeat(Number(exponent) - 1)}${leading}${rest}`
}

/** Formats an exact decimal without converting its significant digits to a Number. */
export function formatAmount(value: string | number | undefined, unit: string) {
	if (value === undefined) return 'Unavailable'
	if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) return 'Unavailable'
	const raw = typeof value === 'number' ? plainNumberString(value) : value
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return 'Unavailable'
	const negative = raw.startsWith('-')
	const unsigned = negative ? raw.slice(1) : raw
	const [integer = '0', fractional = ''] = unsigned.split('.')
	const fraction = fractional.replace(/0+$/, '')
	// A value that rounds away to nothing is plain zero, never `-0`.
	const sign = negative && (integer !== '0' || fraction !== '') ? '-' : ''
	const normalized = `${sign}${integer}${fraction === '' ? '' : `.${fraction}`}`
	return `${normalized} ${unit}`
}

/** Atomic values are integer strings; preserve all nonzero fractional digits. */
export function formatAtomicAmount(value: string | number | undefined, unit: string, decimals = 18) {
	if (value === undefined) return 'Unavailable'
	if (typeof value === 'number' && !Number.isSafeInteger(value)) return 'Unavailable'
	const raw = String(value)
	if (!/^(?:0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(decimals) || decimals < 0) return 'Unavailable'
	if (decimals === 0) return `${raw} ${unit}`
	const padded = raw.padStart(decimals + 1, '0')
	return formatAmount(`${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`, unit)
}

export function nonnegativeAtomicValue(value: string, unit: string, decimals = 18) {
	if (!Number.isSafeInteger(decimals) || decimals < 0) throw new Error(`Unsupported ${unit} decimal precision.`)
	const fractionPattern = decimals === 0 ? '' : `(?:\\.\\d{1,${decimals.toString()}})?`
	if (!new RegExp(`^(?:0|[1-9]\\d*)${fractionPattern}$`).test(value)) throw new Error(`Enter a nonnegative ${unit} amount with at most ${decimals.toString()} decimal places.`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'))
}
