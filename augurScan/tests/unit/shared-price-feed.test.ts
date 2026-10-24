import { expect, test } from 'bun:test'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { discoveriesFrom } from '../../src/metadata.ts'
import { projectionsFrom } from '../../src/projections.ts'
import type { StoredLog } from '../../src/types.ts'

const coordinator = getAddress('0x1111111111111111111111111111111111111111')
const feed = getAddress('0x2222222222222222222222222222222222222222')
const hash: Hex = `0x${'12'.repeat(32)}`

const log = (name: string, args: Record<string, unknown>): StoredLog => ({
	transactionHash: hash,
	blockHash: hash,
	blockNumber: 10n,
	transactionIndex: 0,
	logIndex: 0,
	address: feed,
	contractKind: 'sharedPoolPriceFeed',
	topics: [hash],
	data: '0x',
	decoded: { name, arguments: args, status: 'decoded', summary: name },
})

test('discovers the shared report contract from its authenticated coordinator binding', () => {
	expect(discoveriesFrom({ name: 'SharedPriceFeedSet', arguments: { priceFeed: feed }, status: 'decoded', summary: 'Pool feed configured' })).toEqual([{ address: feed, kind: 'sharedPoolPriceFeed', label: 'Shared Pool Price Feed' }])
})

test('projects shared funding, aggregate exposure, and price acceptance under the feed identity', () => {
	for (const [name, args] of [
		['ReportFundingAssigned', { reportId: '7', coordinator, sponsor: coordinator }],
		['ExposureCheckpoint', { coordinator, exposureAttoEth: 100n.toString(), aggregateExposureAttoEth: 200n.toString() }],
		['CoordinatorSettlementDeferred', { reportId: '7', coordinator }],
	] as const) {
		expect(projectionsFrom(log(name, args))).toContainEqual(expect.objectContaining({ type: 'domainEvent', domain: 'oracle', entityType: 'price-feed', entityIdentity: feed.toLowerCase(), semanticEventKind: name }))
	}
	expect(projectionsFrom(log('PriceReported', { reportId: '7', price: '2000000000000000000', lastSettlementTimestamp: '1000' }))).toContainEqual(expect.objectContaining({ type: 'repEthPrice', coordinatorAddress: feed.toLowerCase(), reportId: '7', repPerEth1e18: '2000000000000000000' }))
})
