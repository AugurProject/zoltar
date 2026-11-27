import { isHex, type Hex } from '@zoltar/bot-shared/ethereum'
import type { SecurityPoolScope } from '#monitoring/security-pool-monitor'
import { parseSecurityPoolSelections } from '#config/security-pool-policy'

export function parseSecurityPoolScopes(value: unknown): SecurityPoolScope[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 64) throw new Error('Invalid managed security pool scope history')
	return value.map(entry => {
		const selection = parseSecurityPoolSelections([entry])[0]
		if (selection === undefined || typeof entry !== 'object' || entry === null) throw new Error('Invalid managed security pool scope')
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
		const sponsoredReports = parseSponsoredReports(Reflect.get(entry, 'sponsoredReports'))
		return { ...selection, ...(sponsoredReports === undefined ? {} : { sponsoredReports }), ...auctionPage, nextPositionId: BigInt(cursor), sweepEnd: BigInt(end), retirementObservations }
	})
}

function parseSponsoredReports(value: unknown) {
	if (value === undefined) return undefined
	if (typeof value !== 'object' || value === null) throw new Error('Invalid sponsored report cursor')
	const integer = (raw: unknown) => {
		if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw) || BigInt(raw) >= 2n ** 256n) throw new Error('Invalid sponsored report integer')
		return BigInt(raw)
	}
	const nextBlock = integer(Reflect.get(value, 'nextBlock'))
	const rawIds: unknown = Reflect.get(value, 'reportIds')
	if (!Array.isArray(rawIds)) throw new Error('Invalid sponsored report identifiers')
	const reportIds = rawIds.map(integer)
	if (reportIds.some(id => id === 0n) || new Set(reportIds).size !== reportIds.length) throw new Error('Invalid sponsored report identifiers')
	const blockHash: unknown = Reflect.get(value, 'blockHash')
	if (typeof blockHash !== 'string' || !isHex(blockHash) || blockHash.length !== 66) throw new Error('Invalid sponsored report block hash')
	const canonicalHash: Hex = `0x${blockHash.slice(2)}`
	return { nextBlock, reportIds, blockHash: canonicalHash }
}
