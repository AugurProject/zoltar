import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from './settings.ts'

export function updateSupportedPool(settings: OperatorSettings, value: unknown) {
	if (typeof value !== 'object' || value === null) throw new Error('Pool selection request must be an object')
	if (Reflect.get(value, 'chainId') !== settings.network.chainId) throw new Error('Pool selection belongs to a different chain')
	const rawAddress = Reflect.get(value, 'address')
	const supported = Reflect.get(value, 'supported')
	if (typeof rawAddress !== 'string' || typeof supported !== 'boolean') throw new Error('Pool selection requires an address and supported flag')
	const address = getAddress(rawAddress)
	const remaining = settings.selectedPools.filter(pool => pool.toLowerCase() !== address.toLowerCase())
	return { ...settings, selectedPools: supported ? [...remaining, address] : remaining }
}

export function parsePoolSelection(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Selected pools must be an array of addresses')
	return [
		...new Map(
			value.map(raw => {
				if (typeof raw !== 'string') throw new Error('Selected pools must contain addresses')
				const address = getAddress(raw)
				return [address.toLowerCase(), address] as const
			}),
		).values(),
	]
}
