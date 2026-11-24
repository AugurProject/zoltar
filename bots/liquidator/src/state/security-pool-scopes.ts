import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import type { SecurityPoolScope } from '#monitoring/security-pool-monitor'
import { parseSecurityPoolSelections } from '#config/security-pool-policy'

export function parseSecurityPoolScopes(value: unknown): SecurityPoolScope[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid managed security pool scope history')
	return value.map(entry => {
		const selection = parseSecurityPoolSelections([entry])[0]
		if (selection === undefined || typeof entry !== 'object' || entry === null) throw new Error('Invalid managed security pool scope')
		const rawVaults = Reflect.get(entry, 'managedVaults') ?? []
		if (!Array.isArray(rawVaults)) throw new Error('Invalid managed vault history')
		const managedVaults: Address[] = rawVaults.map(value => {
			if (typeof value !== 'string') throw new Error('Invalid managed vault address')
			return getAddress(value)
		})
		const cursor = Reflect.get(entry, 'nextPositionId')
		const end = Reflect.get(entry, 'sweepEnd')
		if (typeof cursor !== 'string' || !/^[1-9]\d*$/.test(cursor) || typeof end !== 'string' || !/^(0|[1-9]\d*)$/.test(end) || BigInt(cursor) >= 2n ** 96n || BigInt(end) >= 2n ** 96n) throw new Error('Invalid managed security pool cursor')
		const auctionCursor = Reflect.get(entry, 'auctionAfterBidId')
		let auctionPage = {}
		if (auctionCursor !== undefined) {
			if (typeof auctionCursor !== 'string' || !/^(0|[1-9]\d*)$/.test(auctionCursor) || BigInt(auctionCursor) >= 2n ** 96n) throw new Error('Invalid managed auction cursor')
			auctionPage = { auctionAfterBidId: BigInt(auctionCursor) }
		}
		const observations = Reflect.get(entry, 'retirementObservations') ?? []
		if (!Array.isArray(observations) || observations.length > 256) throw new Error('Invalid retirement observation history')
		const retirementObservations = observations.map(value => {
			if (typeof value !== 'object' || value === null) throw new Error('Invalid retirement observation')
			const field = (key: string) => {
				const raw = Reflect.get(value, key)
				if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw) || BigInt(raw) >= 2n ** 256n) throw new Error('Invalid retirement observation integer')
				return BigInt(raw)
			}
			return { id: field('id'), commitment: field('commitment'), batch: field('batch'), since: field('since') }
		})
		return { ...selection, ...auctionPage, managedVaults, nextPositionId: BigInt(cursor), sweepEnd: BigInt(end), retirementObservations }
	})
}
