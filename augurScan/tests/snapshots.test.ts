import { expect, test } from 'bun:test'
import { getAddress } from '../src/ethereum.ts'
import { normalizeSnapshotTarget, type StateRead, sampleEntityStateWithRead } from '../src/snapshots.ts'

const pool = getAddress('0x1111111111111111111111111111111111111111')

test('normalizes chain snapshot targets and rejects unsupported entity types', () => {
	expect(
		normalizeSnapshotTarget({
			entity_type: 'pool',
			entity_identity: pool.toLowerCase(),
			address: pool,
			pool_address: null,
			coordinator_address: null,
			escalation_address: null,
		}),
	).toEqual({ entityType: 'pool', entityIdentity: pool.toLowerCase(), address: pool })
	expect(() => normalizeSnapshotTarget({ entity_type: 'unknown', entity_identity: 'x', address: pool })).toThrow('Unsupported snapshot entity type')
})

test('samples a complete auction state through tagged reads', async () => {
	const values: Readonly<Record<string, unknown>> = {
		auctionStarted: 100n,
		maxAttoRepBeingSold: 1_000n,
		attoEthRaiseCap: 500n,
		minBidSizeAttoEth: 1n,
		finalized: false,
		clearingTick: -2n,
		ethFilledAtClearingAttoEth: 4n,
		attoEthRaised: 400n,
		totalAttoRepPurchased: 800n,
		activeTickCount: 3n,
		computeClearing: [true, -2n, 400n, 4n],
	}
	const read: StateRead = async (_address, _abi, functionName) => {
		const value = values[functionName]
		if (value === undefined) throw new Error(`Unexpected function ${functionName}`)
		return value
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'auction', entityIdentity: pool.toLowerCase(), address: pool }, read)
	expect(snapshot).toMatchObject({
		readStatus: 'success',
		sourceMethod: 'augurscan.auction-state.v1',
		readResult: {
			auctionStarted: '100',
			clearingTick: '-2',
			indicativeClearing: { hitCap: true, accumulatedBidAttoEth: String(400) },
		},
	})
})

test('stores bounded tagged-read failures as availability evidence', async () => {
	const read: StateRead = async () => {
		throw new Error('historical state unavailable\nprovider detail')
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'escalation', entityIdentity: pool.toLowerCase(), address: pool }, read)
	expect(snapshot).toEqual({
		entityType: 'escalation',
		entityIdentity: pool.toLowerCase(),
		sourceMethod: 'augurscan.escalation-state.v1',
		readStatus: 'failed',
		readFailureReason: 'historical state unavailable provider detail',
	})
})
