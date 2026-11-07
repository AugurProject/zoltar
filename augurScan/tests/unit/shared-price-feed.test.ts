import { expect, test } from 'bun:test'
import { abiForKind } from '../../src/abi-catalog.ts'
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from '../../src/ethereum.ts'
import { decodeLogRecord, discoveriesFrom } from '../../src/metadata.ts'
import { projectionsFrom } from '../../src/projections.ts'
import type { StoredLog } from '../../src/types.ts'

const coordinator = getAddress('0x1111111111111111111111111111111111111111')
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

test('discovers the shared report contract from its authenticated coordinator binding', () => {
	expect(discoveriesFrom({ name: 'SharedPriceFeedSet', arguments: { priceFeed: feed }, status: 'decoded', summary: 'Pool feed configured' })).toEqual([{ address: feed, kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }])
})

test('projects shared funding, aggregate exposure, and price acceptance under the feed identity', () => {
	for (const [name, args] of [
		['ReportFundingAssigned', { reportId: 7n, coordinator, sponsor: coordinator }],
		['ExposureCheckpoint', { coordinator, exposureAttoEth: 100n, aggregateExposureAttoEth: 200n }],
		['PriceReportRejected', { reportId: 7n, reason: 'Invalid candidate', pendingReportId: 8n, pendingReportMaxSettlementBaseFeeAttoEthPerGas: 1n, lastPrice: 2000000000000000000n, lastSettlementTimestamp: 1000n }],
	] as const) {
		expect(projectionsFrom(log(name, args))).toContainEqual(expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'price-feed', entityIdentity: feed.toLowerCase(), semanticEventKind: name }))
	}
	expect(projectionsFrom(log('PriceReported', { reportId: 7n, price: 2000000000000000000n, lastSettlementTimestamp: 1000n }))).toContainEqual(expect.objectContaining({ type: 'repEthPrice', coordinatorAddress: feed.toLowerCase(), reportId: '7', repPerEth1e18: '2000000000000000000' }))
})
