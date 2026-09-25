import { expect, test } from 'bun:test'
import { getAddress } from '../../src/ethereum.ts'
import { normalizeSnapshotTarget, type StateRead, sampleEntityStateWithRead } from '../../src/snapshots.ts'

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

test('records the current coverage epoch beside pool and vault obligation units across resets', async () => {
	for (const epoch of [2n, 3n]) {
		const values: Readonly<Record<string, unknown>> = {
			settlementCollateralAttoEth: 1n,
			totalCapacityOwnershipAttoRep: 1n,
			totalRepBackingUnits: 1n,
			totalClaimableVaultFeesAttoEth: 0n,
			totalAccruedFeesAttoEth: 0n,
			getTotalPoolHeldAttoRep: 1n,
			getCurrentMintingCapacityAttoEth: 1n,
			totalBadDebtAttoEth: 0n,
			systemState: 0n,
			awaitingForkContinuation: false,
			isEscalationResolved: true,
			shareTokenSupplyAttoShares: 1n,
			currentRetentionRate: 1n,
			statoblastSecurityMultiplierBps: 10000n,
			totalObligationUnits: epoch === 2n ? 7n : 0n,
			writtenOffObligationUnits: 0n,
			unassignedObligationUnits: 0n,
			coverageEpoch: epoch,
			securityVaults: [1n, 1n, 0n, 0n],
			vaultTargetBackingFactorBps: 10000n,
			getVaultOpenInterestAttoEth: 1n,
			vaultBadDebtAttoEth: 0n,
			getVaultObligationUnits: epoch === 2n ? 7n : 0n,
			coverageOffers: [true, 100n, 10000n],
			backingUnitsToAttoRep: 1n,
		}
		const read: StateRead = async (_address, _abi, name) => {
			if (!(name in values)) throw new Error(`Unexpected read ${name}`)
			return values[name]
		}
		for (const entityType of ['pool', 'vault'] as const) {
			const snapshot = await sampleEntityStateWithRead({ entityType, entityIdentity: pool.toLowerCase(), address: pool, poolAddress: pool }, read)
			expect(snapshot).toMatchObject({ readStatus: 'success', readResult: { coverageEpoch: epoch.toString(), [entityType === 'pool' ? 'totalObligationUnits' : 'obligationUnits']: epoch === 2n ? '7' : '0' } })
		}
	}
})
