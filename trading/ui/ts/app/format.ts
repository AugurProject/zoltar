export function formatUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	const negative = value < 0n
	const absolute = negative ? -value : value
	const base = 10n ** BigInt(decimals)
	const whole = absolute / base
	const fraction = (absolute % base).toString().padStart(decimals, '0').slice(0, maximumFractionDigits).replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toLocaleString()}${fraction.length > 0 ? `.${fraction}` : ''}`
}

export function parseUnits(value: string, decimals = 18) {
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') throw new Error('Enter a valid nonnegative amount')
	const [whole = '0', fraction = ''] = value.split('.')
	if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places`)
	return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

export function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`
}
