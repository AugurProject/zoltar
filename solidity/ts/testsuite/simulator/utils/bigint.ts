export function bigintToDecimalString(value: bigint, power: bigint): string {
	if (value >= 0n) {
		const integerPart = value / 10n ** power
		const fractionalPart = value % 10n ** power
		if (fractionalPart === 0n) return integerPart.toString(10)
		return `${ integerPart.toString(10) }.${ fractionalPart.toString(10).padStart(Number(power), '0').replace(/0+$/, '') }`
	}
	const integerPart = -value / 10n ** power
	const fractionalPart = -value % 10n ** power
	if (fractionalPart === 0n) return `-${ integerPart.toString(10) }`
	return `-${ integerPart.toString(10) }.${ fractionalPart.toString(10).padStart(Number(power), '0').replace(/0+$/, '') }`
}

export const addressString = (address: bigint): `0x${ string }` => `0x${ address.toString(16).padStart(40, '0') }`

export const bytes32String = (bytes32: bigint): `0x${ string }` => `0x${ bytes32.toString(16).padStart(64, '0') }`

export const abs = (x: bigint) => (x < 0n ? -1n * x : x)

export function isHexEncodedNumber(input: string): boolean {
	const hexNumberRegex = /^(0x)?[0-9a-fA-F]+$/
	return hexNumberRegex.test(input)
}

export const dateToBigintSeconds = (date: Date) => BigInt(date.getTime()) / 1000n

export const rpow = (x: bigint, exponent: bigint, baseUnit: bigint) => {
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
