import { formatEther, formatUnits, type Address } from 'viem'

export function formatAddress(address: Address) {
	return `${ address.slice(0, 6) }...${ address.slice(-4) }`
}

function formatDecimalString(value: string) {
	const isNegative = value.startsWith('-')
	const unsignedValue = isNegative ? value.slice(1) : value
	const [integerPart = '0', fractionalPart] = unsignedValue.split('.')
	const formattedIntegerPart = BigInt(integerPart).toLocaleString()

	return `${ isNegative ? '-' : '' }${ formattedIntegerPart }${ fractionalPart === undefined ? '' : `.${ fractionalPart }` }`
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return 'Unavailable'
	const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units)
	return formatDecimalString(formattedValue)
}

export function formatTimestamp(timestamp: bigint) {
	if (timestamp === 0n) return 'Immediate'
	return new Date(Number(timestamp) * 1000).toLocaleString()
}

export function formatDuration(seconds: bigint) {
	if (seconds <= 0n) return '0m'

	const days = seconds / 86_400n
	const hours = (seconds % 86_400n) / 3_600n
	const minutes = (seconds % 3_600n) / 60n

	if (days > 0n) return `${ days }d ${ hours }h ${ minutes }m`
	if (hours > 0n) return `${ hours }h ${ minutes }m`
	return `${ minutes }m`
}
