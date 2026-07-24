const DECIMAL_SCALE = 18

function parseSignedDecimal(value: string) {
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid decimal amount: ${value}`)
	const negative = value.startsWith('-')
	const unsigned = negative ? value.slice(1) : value
	const [whole = '0', fraction = ''] = unsigned.split('.')
	const scaled = BigInt(whole) * 10n ** BigInt(DECIMAL_SCALE) + BigInt(fraction.padEnd(DECIMAL_SCALE, '0'))
	return negative ? -scaled : scaled
}

function decimalFromScaled(value: bigint) {
	const negative = value < 0n
	const unsigned = negative ? -value : value
	const scale = 10n ** BigInt(DECIMAL_SCALE)
	const whole = unsigned / scale
	const fraction = (unsigned % scale).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '')
	const decimal = fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
	return negative ? `-${decimal}` : decimal
}

export function exactAmount(value: string | undefined, symbol: string) {
	return value === undefined ? 'Unavailable' : `${value} ${symbol}`
}

export function sumSignedDecimals(values: readonly string[]) {
	return decimalFromScaled(values.reduce((total, value) => total + parseSignedDecimal(value), 0n))
}
