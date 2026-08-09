export function formatUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	const negative = value < 0n
	const absolute = negative ? -value : value
	const base = 10n ** BigInt(decimals)
	const whole = absolute / base
	const fraction = (absolute % base).toString().padStart(decimals, '0').slice(0, maximumFractionDigits).replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toLocaleString()}${fraction.length > 0 ? `.${fraction}` : ''}`
}

export function formatShareAmount(value: bigint, maximumFractionDigits = 4) {
	return `${formatUnits(value, 18, maximumFractionDigits)} shares`
}

export function formatEthPerShare(collateralWei: bigint, atomicShareSupply: bigint, maximumSignificantDigits = 4) {
	if (collateralWei < 0n || atomicShareSupply <= 0n) throw new Error('Collateral rate requires nonnegative collateral and positive share supply')
	const precision = 36
	const scaled = (collateralWei * 10n ** BigInt(precision)) / atomicShareSupply
	const digits = scaled.toString().padStart(precision + 1, '0')
	const whole = digits.slice(0, -precision)
	const fraction = digits.slice(-precision)
	const firstNonzero = fraction.search(/[1-9]/)
	if (firstNonzero === -1) return `${whole} ETH / share`
	const visibleEnd = Math.min(fraction.length, firstNonzero + maximumSignificantDigits)
	return `${whole}.${fraction.slice(0, visibleEnd).replace(/0+$/, '')} ETH / share`
}

export function formatBpsMultiplier(value: bigint) {
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole}${fraction.length > 0 ? `.${fraction}` : ''}×`
}

export function parseUnits(value: string, decimals = 18) {
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') throw new Error('Enter a valid nonnegative amount')
	const [whole = '0', fraction = ''] = value.split('.')
	if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places`)
	return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

export function parseUnitsOrUndefined(value: string, decimals = 18) {
	if (!Number.isSafeInteger(decimals) || decimals < 0) return undefined
	if (!/^\d*(?:\.\d*)?$/.test(value) || value.length === 0 || value === '.') return undefined
	const [whole = '0', fraction = ''] = value.split('.')
	if (fraction.length > decimals) return undefined
	return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

export function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`
}
