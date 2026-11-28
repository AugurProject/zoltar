import { expect, test } from 'bun:test'
import { abiForKind } from '../../src/abi-catalog.ts'
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from '../../src/ethereum.ts'
import { decodeLogRecord, discoveriesFrom } from '../../src/metadata.ts'
import { projectionsFrom } from '../../src/projections.ts'
import type { StoredLog } from '../../src/types.ts'

const questionLedger = getAddress('0x1111111111111111111111111111111111111111')
const feed = getAddress('0x2222222222222222222222222222222222222222')
const hash: Hex = `0x${'12'.repeat(32)}`

const log = (name: string, args: Record<string, unknown>): StoredLog => {
	const event = abiForKind('sharedPoolPriceFeed')?.find(item => item.type === 'event' && item.name === name)
	if (event?.type !== 'event' || event.inputs === undefined) throw new Error(`Missing compiled shared feed event ${name}`)
	const topics = encodeEventTopics({ abi: [event], eventName: name, args }).map(topic => {
		if (typeof topic !== 'string') throw new Error('Expected one topic per indexed event input')
		return topic
	})
	const inputs = event.inputs.filter(input => !input.indexed)
	const data =
		inputs.length === 0
			? '0x'
			: encodeAbiParameters(
					inputs,
					inputs.map(input => args[input.name ?? '']),
				)
	return {
		transactionHash: hash,
		blockHash: hash,
		blockNumber: 10n,
		transactionIndex: 0,
		logIndex: 0,
		address: feed,
		contractKind: 'sharedPoolPriceFeed',
		topics,
		data,
		decoded: decodeLogRecord('sharedPoolPriceFeed', topics, data, new Map()),
	}
}

test('discovers the shared report contract from its canonical factory registration', () => {
	expect(discoveriesFrom({ name: 'SharedPriceFeedRegistered', arguments: { securityPool: questionLedger, universeId: 0n, priceFeed: feed }, status: 'decoded', summary: 'Pool feed configured' })).toEqual([{ address: feed, kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }])
})

test('projects shared funding and price acceptance under the feed identity', () => {
	for (const [name, args] of [
		['ReportFundingAssigned', { reportId: 7n, sponsor: questionLedger }],
		['PriceReportRejected', { reportId: 7n, reason: 'Report stale', pendingReportId: 8n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 1n, lastPrice: 2000000000000000000n, lastSettlementTimestamp: 1000n }],
	] as const) {
		expect(projectionsFrom(log(name, args))).toContainEqual(expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'price-feed', entityIdentity: feed.toLowerCase(), semanticEventKind: name }))
	}
	expect(projectionsFrom(log('PriceReported', { reportId: 7n, price: 2000000000000000000n, lastSettlementTimestamp: 1000n }))).toContainEqual(expect.objectContaining({ type: 'repEthPrice', coordinatorAddress: feed.toLowerCase(), reportId: '7', repPerEth1e18: '2000000000000000000' }))
})

test('accepted candidates at one observation time do not add candidate prices to canonical history', () => {
	const timestamp = 1000n
	const canonicalPrice = 2000000000000000000n
	for (const [reportId, candidatePrice, canonicalUpdated] of [
		[7n, canonicalPrice, true],
		[8n, 3000000000000000000n, false],
	] as const) {
		const accepted = { reportId, candidatePrice, canonicalPrice, observationTimestamp: timestamp, canonicalUpdated }
		const occurrence = log('PriceCandidateAccepted', accepted)
		const projections = projectionsFrom(occurrence)
		expect(projectionsFrom({ ...occurrence, contractKind: 'shareToken' })).toEqual([])
		expect(projections).toEqual([expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'price-feed', entityIdentity: feed.toLowerCase(), semanticEventKind: 'PriceCandidateAccepted' })])
		expect(projections[0]).toHaveProperty('data', { reportId: reportId.toString(), candidatePrice: candidatePrice.toString(), canonicalPrice: canonicalPrice.toString(), observationTimestamp: timestamp.toString(), canonicalUpdated })
		expect(projectionsFrom(log('PriceReported', { reportId, price: canonicalPrice, lastSettlementTimestamp: timestamp }))).toContainEqual(expect.objectContaining({ type: 'repEthPrice', reportId: reportId.toString(), repPerEth1e18: canonicalPrice.toString() }))
	}
})
