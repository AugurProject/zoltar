/** Formats an exact decimal without converting its significant digits to a Number. */
export function formatAmount(value: string | number | undefined, unit: string) {
	if (value === undefined) return 'Unavailable'
	if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) return 'Unavailable'
	const raw = String(value)
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return 'Unavailable'
	const negative = raw.startsWith('-')
	const unsigned = negative ? raw.slice(1) : raw
	const [integer = '0', fractional = ''] = unsigned.split('.')
	const fraction = fractional.replace(/0+$/, '')
	const normalized = `${negative ? '-' : ''}${integer}${fraction === '' ? '' : `.${fraction}`}`
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
	if (!Number.isSafeInteger(decimals) || decimals < 0 || !new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new Error(`Enter a nonnegative ${unit} amount with at most ${decimals.toString()} decimal places.`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'))
}
