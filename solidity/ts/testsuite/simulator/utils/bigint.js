export function bigintToDecimalString(value, power) {
	const sign = value < 0n ? '-' : ''
	const magnitude = abs(value)
	const integerPart = magnitude / 10n ** power
	const fractionalPart = magnitude % 10n ** power
	if (fractionalPart === 0n) return `${sign}${integerPart.toString(10)}`
	return `${sign}${integerPart.toString(10)}.${fractionalPart.toString(10).padStart(Number(power), '0').replace(/0+$/, '')}`
}
export const addressString = address => `0x${address.toString(16).padStart(40, '0')}`
export const bytes32String = bytes32 => `0x${bytes32.toString(16).padStart(64, '0')}`
export const abs = x => (x < 0n ? -1n * x : x)
export const dateToBigintSeconds = date => BigInt(date.getTime()) / 1000n
export const rpow = (x, exponent, baseUnit) => {
	if (baseUnit === 0n) throw new Error('baseUnit cannot be zero')
	let result = exponent % 2n !== 0n ? x : baseUnit
	for (exponent = exponent / 2n; exponent !== 0n; exponent = exponent / 2n) {
		x = (x * x) / baseUnit
		if (exponent % 2n !== 0n) {
			result = (result * x) / baseUnit
		}
	}
	return result
}
//# sourceMappingURL=bigint.js.map
