import { formatEther, formatUnits, type Address } from 'viem'

export function formatAddress(address: Address) {
	return `${ address.slice(0, 6) }...${ address.slice(-4) }`
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return 'Unavailable'
	return units === 18 ? Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : Number(formatUnits(value, units)).toLocaleString(undefined, { maximumFractionDigits: 6 })
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

	if (days > 0n) return `${ days }d ${ hours }h`
	if (hours > 0n) return `${ hours }h ${ minutes }m`
	return `${ minutes }m`
}
