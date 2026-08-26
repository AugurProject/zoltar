import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, type Address } from '@zoltar/bot-shared/ethereum'
import {
	assertCanonicalPairGraph,
	assertCanonicalPoolGraph,
	authenticatePoolProtocolBindings,
	canonicalDiscoveryWarnings,
	collectCountedPages,
	DISCOVERY_RPC_CONCURRENCY,
	discoverEcosystemSnapshot,
	discoverStagedOperations,
	forkMigrationWindowIsOpen,
	forkRepMigrationTarget,
	limitDiscoveryConcurrency,
	minimumSafeVaultDeposit,
	relevantTokenSpenders,
	trustedIndexedReportsForDiscovery,
	type ChaosReadClient,
} from '../../src/monitoring/discovery.ts'
import type { OracleGameSnapshot } from '../../src/operations/types.ts'
import type { CanonicalImmutableTopologyCache } from '../../src/monitoring/topology-cache.ts'
import { address, hash, snapshotFixture } from '../operations/fixture.ts'

interface GraphOverrides {
	childOutcomesByUniverse?: Readonly<Record<string, readonly bigint[]>>
	forkerZoltar?: Address
	historicalBlockErrors?: readonly string[]
	historicalBlockHashes?: Readonly<Record<string, `0x${string}`>>
	questionIds?: readonly bigint[]
	routerFactory?: Address
	tradingSecurityPoolFactory?: Address
}

function fakeClient(anchorBlockNumber: bigint, blockHash = hash(99), graph: GraphOverrides = {}, poisonToken?: Address) {
	const pinnedReads: Array<bigint | undefined> = []
	const contractReads: Array<{ args?: readonly unknown[]; functionName: string }> = []
	let requestedBlock: bigint | undefined
	const implementation = {
		async getBalance(parameters: { address: Address; blockNumber?: bigint }) {
			pinnedReads.push(parameters.blockNumber)
			return 10n
		},
		async getBlock(parameters: { blockNumber?: bigint }) {
			requestedBlock = parameters.blockNumber
			const number = parameters.blockNumber ?? anchorBlockNumber
			if (graph.historicalBlockErrors?.includes(number.toString()) === true) throw new Error(`Historical block ${number.toString()} unavailable`)
			return { hash: graph.historicalBlockHashes?.[number.toString()] ?? (number === anchorBlockNumber ? blockHash : hash(Number(number))), number, timestamp: 1_000n }
		},
		async getChainId() {
			return 31337
		},
		async readContract(parameters: { address?: Address; args?: readonly unknown[]; blockNumber?: bigint; functionName: string }) {
			pinnedReads.push(parameters.blockNumber)
			contractReads.push({ ...(parameters.args === undefined ? {} : { args: parameters.args }), functionName: parameters.functionName })
			if ((parameters.functionName === 'balanceOf' || parameters.functionName === 'allowance') && parameters.address !== undefined && poisonToken !== undefined && parameters.address.toLowerCase() === poisonToken.toLowerCase()) {
				throw new Error('Hostile token read reverted')
			}
			switch (parameters.functionName) {
				case 'zoltarQuestionData':
					return address(3)
				case 'zoltar':
					return graph.forkerZoltar ?? address(2)
				case 'securityPoolFactory':
					return graph.tradingSecurityPoolFactory ?? address(4)
				case 'factory':
					return graph.routerFactory ?? address(8)
				case 'universes': {
					const universeId = parameters.args?.[0]
					if (typeof universeId !== 'bigint') throw new Error('Universe ID required')
					return [0n, 0n, universeId, address(10 + Number(universeId)), 0n]
				}
				case 'getForkThresholdAttoRep':
					return 100n
				case 'getNonDecisionThresholdAttoRep':
					return 200n
				case 'getTotalTheoreticalSupplyAttoRep':
					return 1_000_000n
				case 'forkBurnDivisor':
					return 5n
				case 'getMigrationRepBalanceAttoRep':
					return 0n
				case 'getDeployedChildUniverses': {
					const universeId = parameters.args?.[0]
					const start = parameters.args?.[1]
					const count = parameters.args?.[2]
					if (typeof universeId !== 'bigint' || typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Child-universe page arguments required')
					const outcomes = [...(graph.childOutcomesByUniverse?.[universeId.toString()] ?? [])].slice(Number(start), Number(start + count))
					const childIds = outcomes.map(outcome => (universeId === 0n ? outcome : universeId * 100n + outcome))
					return [outcomes, childIds, childIds.map(() => ({}))]
				}
				case 'getQuestionCount':
					return BigInt(graph.questionIds?.length ?? 0)
				case 'getQuestions': {
					const start = parameters.args?.[0]
					const count = parameters.args?.[1]
					if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Question page arguments required')
					return [...(graph.questionIds ?? [])].slice(Number(start), Number(start + count))
				}
				case 'questions':
					return ['Question', 'Description', 1_000n, 2_000n, 2n, 0n, 1n, 'shares']
				case 'questionCreatedTimestamp':
					return 900n
				case 'getOutcomeLabels':
					return ['Yes', 'No']
				case 'securityPoolDeploymentCount':
					return 0n
				case 'securityPoolDeploymentsRange':
					return []
				case 'balanceOf':
				case 'allowance':
					return 0n
				case 'tokenHolder':
					return 1n
				case 'internalAllowance':
					return 0n
				default:
					throw new Error(`Unexpected read ${parameters.functionName}`)
			}
		},
	}
	const client = new Proxy({} as ChaosReadClient, {
		get(_target, property) {
			const value = implementation[property as keyof typeof implementation]
			if (value === undefined) throw new Error(`Unexpected client method ${String(property)}`)
			return value
		},
	})
	return { client, contractReads, pinnedReads, requested: () => requestedBlock }
}

interface PoolBindingOverrides {
	coordinatorOpenOracle?: Address
	coordinatorRepToken?: Address
	coordinatorWeth?: Address
	poolOpenOracle?: Address
	readFailure?: Error
}

function poolBindingClient(pool: Address, coordinator: Address, overrides: PoolBindingOverrides = {}) {
	const reads: Array<{ address: Address; blockNumber?: bigint; functionName: string }> = []
	const implementation = {
		async readContract(parameters: { address: Address; blockNumber?: bigint; functionName: string }) {
			reads.push(parameters)
			if (overrides.readFailure !== undefined) throw overrides.readFailure
			if (parameters.functionName === 'openOracle' && parameters.address.toLowerCase() === pool.toLowerCase()) return overrides.poolOpenOracle ?? address(6)
			if (parameters.functionName === 'openOracle' && parameters.address.toLowerCase() === coordinator.toLowerCase()) return overrides.coordinatorOpenOracle ?? address(6)
			if (parameters.functionName === 'weth' && parameters.address.toLowerCase() === coordinator.toLowerCase()) return overrides.coordinatorWeth ?? address(7)
			if (parameters.functionName === 'reputationToken' && parameters.address.toLowerCase() === coordinator.toLowerCase()) return overrides.coordinatorRepToken ?? address(24)
			throw new Error(`Unexpected binding read ${parameters.address} ${parameters.functionName}`)
		},
	}
	const client = new Proxy({} as ChaosReadClient, {
		get(_target, property) {
			const value = implementation[property as keyof typeof implementation]
			if (value === undefined) throw new Error(`Unexpected client method ${String(property)}`)
			return value
		},
	})
	return { client, reads }
}

describe('anchored ecosystem discovery', () => {
	test('never queries or schedules an indexed report backed by an untrusted token', async () => {
		const hostileToken = address(99)
		const fake = fakeClient(10n, hash(1), {}, hostileToken)
		const report: OracleGameSnapshot = {
			currentAmount1: '10',
			currentAmount2: '20',
			currentReporter: address(1),
			disputeDelay: '1',
			escalationHalt: '100',
			flags: 7,
			game: {
				callbackContract: address(0),
				callbackGasLimit: 0,
				feePercentage: 0,
				lastReportOppoTime: '1',
				numReports: 1,
				protocolFee: 0,
				protocolFeeRecipient: address(0),
				settlerReward: '0',
			},
			helper: { blockNumber: '10', blockTimestamp: '1000', creator: address(1) },
			multiplier: 140,
			openOracle: address(6),
			reportId: '42',
			reportTimestamp: '1',
			settlementTime: '2',
			settlementTimestamp: '0',
			stateHash: hash(42),
			token1: address(7),
			token2: hostileToken,
		}
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: fake.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			indexedReports: [report],
			wallet: address(1),
		})
		expect(snapshot.reports).toEqual([])
		expect(snapshot.wallet.tokens.map(token => token.address)).toEqual([address(7), address(10)])
		expect(trustedIndexedReportsForDiscovery({ deployments: snapshot.deployments, pools: snapshot.pools, reports: [report], universes: snapshot.universes, wallet: snapshot.wallet.address })).toEqual([])
	})

	test('bounds provider concurrency under maximum-limit fan-out', async () => {
		let active = 0
		let peak = 0
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				if (property !== 'getChainId') throw new Error(`Unexpected client method ${String(property)}`)
				return async () => {
					active += 1
					peak = Math.max(peak, active)
					await new Promise(resolve => setTimeout(resolve, 1))
					active -= 1
					return 31337
				}
			},
		})
		const limited = limitDiscoveryConcurrency(client)
		await Promise.all(Array.from({ length: 10_000 }, () => limited.getChainId()))
		expect(peak).toBe(DISCOVERY_RPC_CONCURRENCY)
	})

	test('uses topology limits as page sizes and exhausts questions and the universe tree', async () => {
		const fake = fakeClient(10n, hash(1), {
			childOutcomesByUniverse: { '0': [1n, 2n, 3n] },
			questionIds: [101n, 102n, 103n],
		})
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: fake.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 2, maxQuestions: 2, maxStagedOperationsPerPool: 2, maxUniverses: 2, maxVaultsPerPool: 2 },
			wallet: address(1),
		})
		expect(snapshot.questions.map(question => question.id)).toEqual(['101', '102', '103'])
		expect(snapshot.universes.map(universe => universe.id)).toEqual(['0', '1', '2', '3'])
		expect(snapshot.warnings).toEqual([])
	})

	test('reuses only checkpoint-authenticated immutable topology and pages from prior collection boundaries', async () => {
		const first = fakeClient(10n, hash(10), {
			childOutcomesByUniverse: { '0': [1n, 2n, 3n] },
			questionIds: [101n, 102n, 103n],
		})
		let checkpoint: CanonicalImmutableTopologyCache | undefined
		let initialChanged: boolean | undefined
		await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: first.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 2, maxQuestions: 2, maxStagedOperationsPerPool: 2, maxUniverses: 2, maxVaultsPerPool: 2 },
			recordTopologyCache: (value, changed) => {
				checkpoint = value
				initialChanged = changed
			},
			wallet: address(1),
		})
		if (checkpoint === undefined) throw new Error('Initial immutable topology checkpoint was not recorded')
		expect(initialChanged).toBe(true)

		const next = fakeClient(11n, hash(11), {
			childOutcomesByUniverse: { '0': [1n, 2n, 3n, 4n] },
			historicalBlockHashes: { '10': hash(10) },
			questionIds: [101n, 102n, 103n, 104n],
		})
		let nextCheckpoint: CanonicalImmutableTopologyCache | undefined
		let extendedChanged: boolean | undefined
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 11n,
			client: next.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 2, maxQuestions: 2, maxStagedOperationsPerPool: 2, maxUniverses: 2, maxVaultsPerPool: 2 },
			recordTopologyCache: (value, changed) => {
				nextCheckpoint = value
				extendedChanged = changed
			},
			topologyCache: checkpoint,
			wallet: address(1),
		})
		expect(snapshot.questions.map(question => question.id)).toEqual(['101', '102', '103', '104'])
		expect(snapshot.universes.map(universe => universe.id)).toEqual(['0', '1', '2', '3', '4'])
		expect(next.contractReads.filter(read => read.functionName === 'questions')).toHaveLength(1)
		expect(next.contractReads.filter(read => read.functionName === 'questionCreatedTimestamp')).toHaveLength(1)
		expect(next.contractReads.filter(read => read.functionName === 'getOutcomeLabels')).toHaveLength(1)
		expect(next.contractReads.filter(read => read.functionName === 'getQuestions').map(read => read.args)).toEqual([[3n, 1n]])
		expect(next.contractReads.filter(read => read.functionName === 'forkBurnDivisor')).toHaveLength(1)
		expect(next.contractReads.filter(read => read.functionName === 'getDeployedChildUniverses' && read.args?.[0] === 0n).map(read => read.args)).toEqual([[0n, 3n, 2n]])
		expect(nextCheckpoint?.anchor).toEqual({ blockHash: hash(11), blockNumber: '11' })
		expect(extendedChanged).toBe(true)

		if (nextCheckpoint === undefined) throw new Error('Extended immutable topology checkpoint was not recorded')
		const unchanged = fakeClient(12n, hash(13), {
			childOutcomesByUniverse: { '0': [1n, 2n, 3n, 4n] },
			historicalBlockHashes: { '11': hash(11) },
			questionIds: [101n, 102n, 103n, 104n],
		})
		let unchangedCheckpoint: CanonicalImmutableTopologyCache | undefined
		let unchangedChanged: boolean | undefined
		await discoverEcosystemSnapshot({
			anchorBlockNumber: 12n,
			client: unchanged.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 2, maxQuestions: 2, maxStagedOperationsPerPool: 2, maxUniverses: 2, maxVaultsPerPool: 2 },
			recordTopologyCache: (value, changed) => {
				unchangedCheckpoint = value
				unchangedChanged = changed
			},
			topologyCache: nextCheckpoint,
			wallet: address(1),
		})
		expect(unchangedChanged).toBe(false)
		expect(unchangedCheckpoint?.anchor).toEqual({ blockHash: hash(13), blockNumber: '12' })
		expect(unchanged.contractReads.filter(read => read.functionName === 'questions')).toHaveLength(0)

		const reorged = fakeClient(11n, hash(12), {
			childOutcomesByUniverse: { '0': [1n, 2n] },
			historicalBlockHashes: { '10': hash(99) },
			questionIds: [101n, 102n],
		})
		let reorgChanged: boolean | undefined
		await discoverEcosystemSnapshot({
			anchorBlockNumber: 11n,
			client: reorged.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 2, maxQuestions: 2, maxStagedOperationsPerPool: 2, maxUniverses: 2, maxVaultsPerPool: 2 },
			recordTopologyCache: (_value, changed) => {
				reorgChanged = changed
			},
			topologyCache: checkpoint,
			wallet: address(1),
		})
		expect(reorged.contractReads.filter(read => read.functionName === 'questions')).toHaveLength(2)
		expect(reorged.contractReads.filter(read => read.functionName === 'getQuestions').map(read => read.args)).toEqual([[0n, 2n]])
		expect(reorgChanged).toBe(true)
	})

	test('discards and rebuilds an ahead, current-hash-mismatched, or unreadable topology checkpoint', async () => {
		const base: CanonicalImmutableTopologyCache = {
			anchor: { blockHash: hash(10), blockNumber: '10' },
			pairsByPool: {},
			poolDeployments: [],
			questions: [{ createdAt: '1', endTime: '3', id: '101', kind: 'binary', numTicks: '2', outcomeLabels: ['Yes', 'No'], startTime: '2' }],
			schemaVersion: 1,
			universeChildren: {},
			vaultsByPool: {},
		}
		const cases = [
			{ anchorBlockNumber: 9n, cache: base, graph: { questionIds: [101n] } },
			{ anchorBlockNumber: 10n, cache: base, graph: { questionIds: [101n] }, hash: hash(11) },
			{ anchorBlockNumber: 11n, cache: base, graph: { historicalBlockErrors: ['10'], questionIds: [101n] } },
		]
		for (const candidate of cases) {
			const fake = fakeClient(candidate.anchorBlockNumber, candidate.hash ?? hash(Number(candidate.anchorBlockNumber)), candidate.graph)
			let changed: boolean | undefined
			await discoverEcosystemSnapshot({
				anchorBlockNumber: candidate.anchorBlockNumber,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				recordTopologyCache: (_value, valueChanged) => {
					changed = valueChanged
				},
				topologyCache: candidate.cache,
				wallet: address(1),
			})
			expect(changed).toBe(true)
			expect(fake.contractReads.filter(read => read.functionName === 'questions')).toHaveLength(1)
		}
	})

	test('exhausts a counted pool-style collection in bounded pages', async () => {
		const calls: Array<[bigint, bigint]> = []
		const values = [10n, 11n, 12n, 13n, 14n]
		const discovered = await collectCountedPages({
			count: BigInt(values.length),
			label: 'Pool discovery',
			pageSize: 2,
			readPage: async (start, count) => {
				calls.push([start, count])
				return values.slice(Number(start), Number(start + count))
			},
		})
		expect(discovered).toEqual(values)
		expect(calls).toEqual([
			[0n, 2n],
			[2n, 2n],
			[4n, 1n],
		])
	})

	test('keeps a 100-pool by 100-REP topology allowance scan linear', () => {
		const fixture = snapshotFixture()
		const template = fixture.pools[0]
		if (template === undefined) throw new Error('Pool fixture missing')
		const pools = Array.from({ length: 100 }, (_, index) => ({ ...template, address: address(1_000 + index), coordinator: address(1_100 + index), repToken: address(2_000 + index) }))
		const tokens = [fixture.deployments.weth, ...pools.map(pool => pool.repToken)]
		const allowanceReads = tokens.reduce((total, token) => total + relevantTokenSpenders(fixture.deployments, pools, token).length, 0)
		expect(allowanceReads).toBeLessThanOrEqual(502)
	})

	test('rounds the wallet REP deposit up until post-transfer backing satisfies the minimum', () => {
		expect(minimumSafeVaultDeposit(1n, 0n, 3n, 2n)).toBe(2n)
	})

	test('selects the normal or own-fork REP migration bucket and rejects inconsistent reads', () => {
		const pool = address(11)
		expect(forkRepMigrationTarget({ auctionableAttoRepAtFork: 90n, ownFork: false }, { auctionableAttoRepAtFork: 90n, ownFork: false, vaultRepAtForkAttoRep: 70n }, pool)).toBe(90n)
		expect(forkRepMigrationTarget({ auctionableAttoRepAtFork: 90n, ownFork: true }, { auctionableAttoRepAtFork: 90n, ownFork: true, vaultRepAtForkAttoRep: 70n }, pool)).toBe(70n)
		expect(() => forkRepMigrationTarget({ auctionableAttoRepAtFork: 90n, ownFork: false }, { auctionableAttoRepAtFork: 91n, ownFork: false, vaultRepAtForkAttoRep: 70n }, pool)).toThrow('inconsistent fork migration buckets')
	})

	test('bounds fork-wide vault and unresolved-escalation discovery to the exact migration window', () => {
		const activation = 1_000n
		const deadline = activation + 8n * 7n * 24n * 60n * 60n
		expect(forkMigrationWindowIsOpen(1n, activation, activation)).toBe(true)
		expect(forkMigrationWindowIsOpen(1n, activation, deadline)).toBe(true)
		expect(forkMigrationWindowIsOpen(1n, activation, deadline + 1n)).toBe(false)
		expect(forkMigrationWindowIsOpen(0n, activation, activation)).toBe(false)
		expect(forkMigrationWindowIsOpen(1n, 0n, activation)).toBe(false)
	})

	test('marks a staged liquidation executable only after exact coordinator-context simulation', async () => {
		const fixture = snapshotFixture()
		const pool = fixture.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		const anchor = 555n
		let simulationFailure: Error | undefined
		let registryCoordinator = pool.coordinator
		let reservationSettled = false
		let reservationAmount = 80n
		let approvalReceiver = address(87)
		let approvalRevoked = false
		const simulations: Array<{ account?: Address; blockNumber?: bigint; functionName: string; args?: readonly unknown[] }> = []
		const implementation = {
			async readContract(parameters: { functionName: string }) {
				switch (parameters.functionName) {
					case 'getActiveStagedOperationCount':
						return 1n
					case 'getPendingSettlementOperationIds':
						return []
					case 'getActiveStagedOperations':
						return [
							[42n],
							[
								{
									liquidationApprovalId: hash(5),
									operation: 0n,
									operationAmountAttoRepOrAttoEth: 100n,
									operator: fixture.wallet.address,
									queuedAt: 500n,
									receiverVault: address(87),
									reservedLiquidationDebtAttoEth: 80n,
									snapshotTargetBackingUnits: 10n,
									snapshotTargetCapacityOwnershipAttoRep: 20n,
									snapshotTargetDisputeStakedAttoRep: 0n,
									snapshotTargetOpenInterestAttoEth: 100n,
									snapshotTotalPoolHeldAttoRep: 1_000n,
									snapshotTotalRepBackingUnits: 900n,
									targetVault: address(88),
									validForSeconds: 3_600n,
								},
							],
						]
					case 'minLiquidationPriceDistanceBps':
						return 250n
					case 'liquidationApprovalRegistry':
						return address(89)
					case 'coordinator':
						return registryCoordinator
					case 'liquidationReservations':
						return { approvalId: hash(5), reservedDebtAttoEth: reservationAmount, settled: reservationSettled }
					case 'getLiquidationApproval':
						return {
							availableDebtAttoEth: 20n,
							consumedDebtAttoEth: 0n,
							params: {
								maxCumulativeDebtAttoEth: 100n,
								maxDebtPerLiquidationAttoEth: 100n,
								minPostLiquidationHealthFactorBps: 12_000n,
								nonce: 1n,
								operator: fixture.wallet.address,
								receiverVault: approvalReceiver,
								securityPool: pool.address,
								targetVault: address(88),
								validAfter: 0n,
								validUntil: 10_000n,
							},
							reservedDebtAttoEth: 80n,
							revoked: approvalRevoked,
						}
					default:
						throw new Error(`Unexpected read ${parameters.functionName}`)
				}
			},
			async simulateContract(parameters: { account?: Address; blockNumber?: bigint; functionName: string; args?: readonly unknown[] }) {
				simulations.push(parameters)
				if (simulationFailure !== undefined) throw simulationFailure
				return { result: [80n, 20n, 0n] }
			},
		}
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				const value = implementation[property as keyof typeof implementation]
				if (value === undefined) throw new Error(`Unexpected client method ${String(property)}`)
				return value
			},
		})
		const executable = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(executable[0]?.executionExpectedSuccess).toBe(true)
		expect(executable[0]?.executionExpectedResult).toBe(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [80n, 20n, 0n]))
		expect(simulations[0]?.account).toBe(pool.coordinator)
		expect(simulations[0]?.blockNumber).toBe(anchor)
		expect(simulations[0]?.functionName).toBe('performLiquidation')
		expect(simulations[0]?.args?.[0]).toMatchObject({ minimumReceiverHealthFactorBps: 12_000n, operationId: 42n, requestedDebtAttoEth: 80n })

		const revertedSimulation = new Error('Contract simulation failed', { cause: new Error('execution reverted: stale liquidation snapshot') })
		revertedSimulation.name = 'ContractFunctionExecutionError'
		simulationFailure = revertedSimulation
		const blocked = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(blocked[0]?.executionExpectedSuccess).toBe(false)

		simulationFailure = new Error('RPC transport timed out')
		await expect(discoverStagedOperations(client, pool, anchor, 10, [])).rejects.toThrow('RPC transport timed out')

		simulationFailure = undefined
		registryCoordinator = address(99)
		const wrongRegistry = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(wrongRegistry[0]?.executionExpectedSuccess).toBe(false)

		registryCoordinator = pool.coordinator
		reservationSettled = true
		const settledReservation = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(settledReservation[0]?.executionExpectedSuccess).toBe(false)

		reservationSettled = false
		reservationAmount = 79n
		const mismatchedReservation = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(mismatchedReservation[0]?.executionExpectedSuccess).toBe(false)

		reservationAmount = 80n
		approvalReceiver = address(99)
		const mismatchedApproval = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(mismatchedApproval[0]?.executionExpectedSuccess).toBe(false)

		approvalReceiver = address(87)
		approvalRevoked = true
		const durableReservedRoute = await discoverStagedOperations(client, pool, anchor, 10, [])
		expect(durableReservedRoute[0]?.executionExpectedSuccess).toBe(true)
	})

	test('retains an exact direct downstream simulation for operation type 1 REP withdrawal', async () => {
		const fixture = snapshotFixture()
		const pool = fixture.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		let receiver = fixture.wallet.address
		let simulationFailure: Error | undefined
		const simulations: Array<{ account?: Address; functionName: string; args?: readonly unknown[] }> = []
		const pageRequests: Array<readonly unknown[]> = []
		const operation = () => ({
			liquidationApprovalId: hash(0),
			operation: 1n,
			operationAmountAttoRepOrAttoEth: 100n,
			operator: fixture.wallet.address,
			queuedAt: 500n,
			receiverVault: receiver,
			reservedLiquidationDebtAttoEth: 0n,
			snapshotTargetBackingUnits: 10n,
			snapshotTargetCapacityOwnershipAttoRep: 20n,
			snapshotTargetDisputeStakedAttoRep: 0n,
			snapshotTargetOpenInterestAttoEth: 0n,
			snapshotTotalPoolHeldAttoRep: 1_000n,
			snapshotTotalRepBackingUnits: 900n,
			targetVault: fixture.wallet.address,
			validForSeconds: 3_600n,
		})
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				if (property === 'readContract') {
					return async (parameters: { args?: readonly unknown[]; functionName: string }) => {
						if (parameters.functionName === 'getActiveStagedOperationCount') return 2n
						if (parameters.functionName === 'getPendingSettlementOperationIds') return []
						if (parameters.functionName === 'getActiveStagedOperations') {
							pageRequests.push(parameters.args ?? [])
							const start = parameters.args?.[0]
							if (start === 0n) return [[42n], [operation()]]
							if (start === 1n) return [[43n], [operation()]]
							return [[], []]
						}
						throw new Error(`Unexpected read ${parameters.functionName}`)
					}
				}
				if (property === 'simulateContract') {
					return async (parameters: { account?: Address; functionName: string; args?: readonly unknown[] }) => {
						simulations.push(parameters)
						if (simulationFailure !== undefined) throw simulationFailure
						return { result: undefined }
					}
				}
				throw new Error(`Unexpected client method ${String(property)}`)
			},
		})
		const executable = await discoverStagedOperations(client, pool, 555n, 1, [])
		expect(executable[0]).toMatchObject({ executionExpectedResult: '0x', executionExpectedSuccess: true, operation: 1 })
		expect(executable).toHaveLength(2)
		expect(pageRequests).toEqual([
			[0n, 1n],
			[1n, 1n],
		])
		expect(simulations[0]).toMatchObject({ account: pool.coordinator, args: [fixture.wallet.address, 100n], functionName: 'withdrawRepFromVault' })
		simulationFailure = new Error('execution reverted: stale withdrawal')
		expect((await discoverStagedOperations(client, pool, 555n, 1, []))[0]?.executionExpectedSuccess).toBe(false)
		simulationFailure = new Error('RPC connection closed')
		await expect(discoverStagedOperations(client, pool, 555n, 1, [])).rejects.toThrow('RPC connection closed')
		simulationFailure = undefined
		receiver = address(99)
		expect((await discoverStagedOperations(client, pool, 555n, 1, []))[0]?.executionExpectedSuccess).toBe(false)
	})

	test('canonicalizes concurrent warnings before quorum comparison', () => {
		expect(canonicalDiscoveryWarnings(['z warning', 'a warning', 'z warning'])).toEqual(['a warning', 'z warning'])
	})

	test('pins the block fetch, every contract read, and wallet balance to the supplied anchor', async () => {
		const anchor = 1234n
		const expectedHash = hash(99)
		const fake = fakeClient(anchor, expectedHash)
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: anchor,
			client: fake.client,
			deployments: {
				openOracle: address(6),
				questionData: address(3),
				securityPoolFactory: address(4),
				securityPoolForker: address(5),
				tradingFactory: address(8),
				tradingRouter: address(9),
				weth: address(7),
				zoltar: address(2),
			},
			expectedAnchorHash: expectedHash,
			wallet: address(1),
		})
		expect(fake.requested()).toBe(anchor)
		expect(fake.pinnedReads.length).toBeGreaterThan(10)
		expect(fake.pinnedReads.every(block => block === anchor)).toBe(true)
		expect(snapshot.anchor).toEqual({ blockHash: expectedHash, blockNumber: anchor.toString(), timestamp: '1000' })
		expect(snapshot.wallet.tokens.every(token => token.openOracleInternalAllowanceToSelf === 0n.toString())).toBe(true)
		expect(fake.contractReads.filter(read => read.functionName === 'internalAllowance')).toHaveLength(snapshot.wallet.tokens.length)
	})

	test('rejects a provider whose exact block does not match the quorum hash', async () => {
		const fake = fakeClient(10n, hash(1))
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 10n,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				expectedAnchorHash: hash(2),
				wallet: address(1),
			}),
		).rejects.toThrow('does not match quorum anchor')
	})

	test('rejects mismatched configured deployment-graph roots before inventory discovery', async () => {
		const cases: Array<{ graph: GraphOverrides; expected: string }> = [
			{ expected: 'SecurityPoolForker Zoltar edge', graph: { forkerZoltar: address(99) } },
			{ expected: 'Trading factory security-pool-factory edge', graph: { tradingSecurityPoolFactory: address(99) } },
			{ expected: 'Trading router factory edge', graph: { routerFactory: address(99) } },
		]
		for (const candidate of cases) {
			const fake = fakeClient(10n, hash(1), candidate.graph)
			await expect(
				discoverEcosystemSnapshot({
					anchorBlockNumber: 10n,
					client: fake.client,
					deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
					wallet: address(1),
				}),
			).rejects.toThrow(candidate.expected)
		}
	})

	test('authenticates every pool and coordinator oracle/token binding at the pinned block', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const binding = poolBindingClient(pool, coordinator)
		await expect(
			authenticatePoolProtocolBindings({
				blockNumber: 55n,
				canonicalRepToken: address(24),
				client: binding.client,
				configuredOpenOracle: address(6),
				configuredWeth: address(7),
				coordinator,
				pool,
			}),
		).resolves.toBeUndefined()
		expect(binding.reads.map(read => [read.address, read.functionName])).toEqual([
			[pool, 'openOracle'],
			[coordinator, 'openOracle'],
			[coordinator, 'weth'],
			[coordinator, 'reputationToken'],
		])
		expect(binding.reads.every(read => read.blockNumber === 55n)).toBe(true)
	})

	test('rejects mismatched pool and coordinator oracle/token bindings', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const cases: Array<{ expected: string; overrides: PoolBindingOverrides }> = [
			{ expected: `Pool ${pool} OpenOracle edge`, overrides: { poolOpenOracle: address(99) } },
			{ expected: `Coordinator ${coordinator} OpenOracle edge`, overrides: { coordinatorOpenOracle: address(99) } },
			{ expected: `Coordinator ${coordinator} WETH edge`, overrides: { coordinatorWeth: address(99) } },
			{ expected: `Coordinator ${coordinator} REP edge`, overrides: { coordinatorRepToken: address(99) } },
		]
		for (const candidate of cases) {
			await expect(
				authenticatePoolProtocolBindings({
					blockNumber: 55n,
					canonicalRepToken: address(24),
					client: poolBindingClient(pool, coordinator, candidate.overrides).client,
					configuredOpenOracle: address(6),
					configuredWeth: address(7),
					coordinator,
					pool,
				}),
			).rejects.toThrow(candidate.expected)
		}
	})

	test('propagates pool binding transport failures without accepting an unauthenticated graph', async () => {
		const pool = address(20)
		const coordinator = address(21)
		const readFailure = new Error('RPC transport closed during immutable binding read')
		await expect(
			authenticatePoolProtocolBindings({
				blockNumber: 55n,
				canonicalRepToken: address(24),
				client: poolBindingClient(pool, coordinator, { readFailure }).client,
				configuredOpenOracle: address(6),
				configuredWeth: address(7),
				coordinator,
				pool,
			}),
		).rejects.toThrow(readFailure.message)
	})

	test('rejects forged pool and pair edges before their assets can be approved', () => {
		const pool = address(20)
		const poolIdentity = {
			configuredFactory: address(4),
			configuredForker: address(5),
			configuredQuestionData: address(3),
			configuredZoltar: address(2),
			coordinatorPool: pool,
			deploymentCoordinator: address(21),
			deploymentQuestionId: '7',
			deploymentShareToken: address(22),
			deploymentTruthAuction: address(23),
			deploymentUniverseId: '6',
			pool,
			poolCoordinator: address(21),
			poolFactory: address(4),
			poolForker: address(5),
			poolQuestionData: address(3),
			poolQuestionId: '7',
			poolRepToken: address(24),
			poolShareToken: address(22),
			poolTruthAuction: address(23),
			poolUniverseId: '6',
			poolZoltar: address(2),
			universeRepToken: address(24),
		}
		expect(() => assertCanonicalPoolGraph({ ...poolIdentity, coordinatorPool: address(99) })).toThrow('pool edge')
		const pairIdentity = {
			configuredFactory: address(8),
			pair: address(25),
			pairFactory: address(8),
			pairPool: pool,
			pairQuestionId: '7',
			pairShareToken: address(22),
			pairUniverseId: '6',
			pool,
			poolQuestionId: '7',
			poolShareToken: address(22),
			poolUniverseId: '6',
		}
		expect(() => assertCanonicalPairGraph({ ...pairIdentity, pairShareToken: address(99) })).toThrow('share-token edge')
	})
})
