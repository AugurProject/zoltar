import { formatEther, formatUnits, type Address } from 'viem'

export function formatAddress(address: Address) {
	return `${ address.slice(0, 6) }...${ address.slice(-4) }`
}

export function formatCurrencyBalance(value: bigint | null, units: number = 18) {
	if (value === null) return 'Unavailable'
	return units === 18 ? Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : Number(formatUnits(value, units)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}
