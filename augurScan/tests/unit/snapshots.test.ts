import { expect, test } from 'bun:test'
import { abiForKind } from '../../src/abi-catalog.ts'
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, toFunctionSelector } from '../../src/ethereum.ts'
import { normalizeSnapshotTarget, type StateRead, sampleEntityStateWithRead } from '../../src/snapshots.ts'

const pool = getAddress('0x1111111111111111111111111111111111111111')
const vault = getAddress('0x2222222222222222222222222222222222222222')
const coordinator = getAddress('0x3333333333333333333333333333333333333333')

for (const [entityType, contractKind] of [
	['pool', 'securityPool'],
	['auction', 'securityPoolUniformPriceAuction'],
	['escalation', 'escalationGame'],
] as const) {
	test(`${entityType} snapshot reads match the compiled contract interfaces`, async () => {
		const mismatches: string[] = []
		const outputValues: Readonly<Record<string, readonly unknown[]>> = {
			getOutcomeBalancesAttoRep: [[1n, 2n, 3n]],
			clearing: [2n, 200n, 400n, 800n, 0n, 2n, 100n, 100n, 100n, true],
			initialized: [true],
			awaitingForkContinuation: [false],
			isEscalationResolved: [false],
			isPriceValid: [false],
			priceFeed: [coordinator],
			finalized: [false],
		}
		const read: StateRead = async (address, abi, functionName, args = []) => {
			const kind = address === coordinator ? 'priceCoordinator' : contractKind
			const compiled = abiForKind(kind)
			if (compiled === undefined) throw new Error(`Missing compiled ABI ${kind}`)
			for (const item of abi) {
				if (item.type !== 'function') continue
				const canonical = compiled.find(candidate => candidate.type === 'function' && toFunctionSelector(candidate) === toFunctionSelector(item))
				if (canonical?.type !== 'function' || JSON.stringify((canonical.outputs ?? []).map(output => output.type)) !== JSON.stringify((item.outputs ?? []).map(output => output.type))) mismatches.push(`${kind}.${item.name}`)
			}
			const input = encodeFunctionData({ abi: compiled, functionName, args })
			const method = compiled.find(item => item.type === 'function' && toFunctionSelector(item) === input.slice(0, 10))
			if (method?.type !== 'function' || method.outputs === undefined) throw new Error(`Missing compiled function outputs ${kind}.${functionName}`)
			if (functionName === 'securityPool') throw new Error('Claim fixture unavailable')
			const values = outputValues[functionName] ?? [1n]
			return decodeFunctionResult({ abi, functionName, data: encodeAbiParameters(method.outputs, values) })
		}
		const snapshot = await sampleEntityStateWithRead({ entityType, entityIdentity: vault, address: vault, poolAddress: pool, coordinatorAddress: coordinator }, read)
		expect(mismatches).toEqual([])
		expect(snapshot.readStatus).toBe('success')
	})
}

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
	expect(() => normalizeSnapshotTarget({ entity_type: 'vault', entity_identity: 'x', address: pool })).toThrow('Unsupported snapshot entity type')
	expect(() => normalizeSnapshotTarget({ entity_type: 'unknown', entity_identity: 'x', address: pool })).toThrow('Unsupported snapshot entity type')
})

test('samples a complete auction state through tagged reads', async () => {
	const values: Readonly<Record<string, unknown>> = {
		opensAt: 100n,
		closesAt: 200n,
		lotAttoEth: 2n,
		targetLots: 250n,
		inventoryAttoRep: 1_000n,
		maximumBidAttoRepPerLot: 100n,
		repGrid: 1n,
		depositedAttoEth: 400n,
		bidCount: 3n,
		initialized: true,
		finalized: true,
		clearing: [2n, 200n, 400n, 800n, 0n, 2n, 100n, 100n, 100n, true],
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
			opensAt: '100',
			closesAt: '200',
			clearing: { attoRepPerLot: '2', filledLots: '200', raisedAttoEth: '400', soldAttoRep: '800', raiseLimitReached: true },
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

test('allows pruning failures to escape for provider-floor rediscovery', async () => {
	const pruned = new Error('state at block #10 is pruned')
	await expect(
		sampleEntityStateWithRead(
			{ entityType: 'escalation', entityIdentity: pool.toLowerCase(), address: pool },
			async () => {
				throw pruned
			},
			error => {
				throw error
			},
		),
	).rejects.toBe(pruned)
})

test('prioritizes delayed pruning over an earlier ordinary snapshot failure', async () => {
	const ordinary = new Error('temporary provider failure')
	const pruned = new Error('state at block #10 is pruned')
	await expect(
		sampleEntityStateWithRead(
			{ entityType: 'escalation', entityIdentity: pool.toLowerCase(), address: pool },
			async (_address, _abi, functionName) => {
				if (functionName === 'activationTime') throw ordinary
				await Promise.resolve()
				throw pruned
			},
			error => {
				if (error === pruned) throw error
			},
		),
	).rejects.toBe(pruned)
})

test('unavailable claim reconstruction preserves the tagged basic escalation state', async () => {
	const read: StateRead = async (_address, _abi, name) => {
		if (name === 'securityPool') throw new Error('Claim ancestry unavailable')
		if (name === 'getOutcomeBalancesAttoRep') return [1n, 2n, 3n]
		return 1n
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'escalation', entityIdentity: pool, address: pool }, read)
	expect(snapshot.readStatus).toBe('success')
	expect(snapshot.readResult).toMatchObject({ outcomeBalancesAttoRep: ['1', '2', '3'], claimEvidence: { status: 'unavailable', reason: 'Claim ancestry unavailable' } })
})

test('attributes a member ledger snapshot to its shared pool price feed', async () => {
	const feed = getAddress('0x4444444444444444444444444444444444444444')
	const read: StateRead = async (_address, _abi, name) => {
		if (name === 'priceFeed') return feed
		if (name === 'isPriceValid') return true
		if (name === 'awaitingForkContinuation' || name === 'isEscalationResolved') return false
		return 1n
	}
	const snapshot = await sampleEntityStateWithRead({ entityType: 'pool', entityIdentity: pool, address: pool, coordinatorAddress: coordinator }, read)
	expect(snapshot.readStatus).toBe('success')
	expect(snapshot.readResult?.['price']).toEqual({ repPerEth1e18: '1', settlementTimestamp: '1', protocolValid: true, sourceContract: feed.toLowerCase() })
})
