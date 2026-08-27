import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeAbiParameters, type Address } from '../support/bot-shared.ts'
import {
	advanceVaultRegistryCursor,
	assertCanonicalPairGraph,
	assertCanonicalPoolGraph,
	authenticatePoolProtocolBindings,
	canonicalDiscoveryWarnings,
	collectCountedPages,
	DISCOVERY_RPC_CONCURRENCY,
	DISCOVERY_RPC_QUEUE_LIMIT,
	discoverEcosystemSnapshot,
	discoverShareInventory,
	discoverStagedOperations,
	drainConcurrent,
	forkMigrationWindowIsOpen,
	forkRepMigrationTarget,
	limitDiscoveryConcurrency,
	mapWithConcurrency,
	minimumSafeVaultDeposit,
	relevantTokenSpenders,
	trustedIndexedReportsForDiscovery,
	type ChaosReadClient,
} from '../../src/monitoring/discovery.ts'
import type { OracleGameSnapshot } from '../../src/operations/types.ts'
import { IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES, loadImmutableTopologyCache, saveImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity } from '../../src/monitoring/topology-cache.ts'
import { address, hash, snapshotFixture } from '../operations/fixture.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function temporaryStatePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-discovery-'))
	temporaryDirectories.push(directory)
	return join(directory, 'operator.json')
}

function topologyIdentity(): ImmutableTopologyIdentity {
	return {
		chainId: 31_337,
		openOracle: address(6),
		questionData: address(3),
		securityPoolFactory: address(4),
		securityPoolForker: address(5),
		tradingFactory: address(8),
		tradingRouter: address(9),
		weth: address(7),
		zoltar: address(2),
	}
}

interface GraphOverrides {
	childOutcomesByUniverse?: Readonly<Record<string, readonly bigint[]>>
	forkerZoltar?: Address
	historicalBlockErrors?: readonly string[]
	historicalBlockHashes?: Readonly<Record<string, `0x${string}`>>
	outcomeLabelPage?: (questionId: bigint, start: bigint, count: bigint) => readonly string[]
	outcomeLabelsByQuestion?: Readonly<Record<string, readonly string[]>>
	poolDeployments?: readonly {
		parent: Address
		priceOracleManagerAndOperatorQueuer: Address
		questionId: bigint
		securityPool: Address
		shareToken: Address
		truthAuction: Address
		universeId: bigint
	}[]
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
				case 'getOutcomeLabels': {
					const questionId = parameters.args?.[0]
					const start = parameters.args?.[1]
					const count = parameters.args?.[2]
					if (typeof questionId !== 'bigint' || typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Outcome-label page arguments required')
					if (graph.outcomeLabelPage !== undefined) return graph.outcomeLabelPage(questionId, start, count)
					return [...(graph.outcomeLabelsByQuestion?.[questionId.toString()] ?? ['Yes', 'No'])].slice(Number(start), Number(start + count))
				}
				case 'securityPoolDeploymentCount':
					return BigInt(graph.poolDeployments?.length ?? 0)
				case 'securityPoolDeploymentsRange': {
					const start = parameters.args?.[0]
					const count = parameters.args?.[1]
					if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Pool-deployment page arguments required')
					return [...(graph.poolDeployments ?? [])].slice(Number(start), Number(start + count))
				}
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
		const invoked = new Set<PropertyKey>()
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				if (!new Set<PropertyKey>(['getBlockNumber', 'getChainId', 'getLogs', 'request']).has(property)) throw new Error(`Unexpected client method ${String(property)}`)
				return async () => {
					invoked.add(property)
					active += 1
					peak = Math.max(peak, active)
					await new Promise(resolve => setTimeout(resolve, 1))
					active -= 1
					return 31337
				}
			},
		})
		const limited = limitDiscoveryConcurrency(client)
		const settled = await Promise.allSettled(
			Array.from({ length: DISCOVERY_RPC_CONCURRENCY + DISCOVERY_RPC_QUEUE_LIMIT + 1 }, (_, index) => {
				if (index % 4 === 0) return limited.getBlockNumber()
				if (index % 4 === 1) return limited.getChainId()
				if (index % 4 === 2) return limited.getLogs({})
				const request = Reflect.get(limited, 'request')
				if (typeof request !== 'function') throw new Error('Limited test client lost its request method')
				return Promise.resolve(request.call(limited, { method: 'eth_chainId' }))
			}),
		)
		expect(peak).toBe(DISCOVERY_RPC_CONCURRENCY)
		expect(invoked).toEqual(new Set(['getBlockNumber', 'getChainId', 'getLogs', 'request']))
		expect(settled.filter(result => result.status === 'rejected')).toHaveLength(1)
		expect(settled.find(result => result.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: `Discovery RPC queue exceeded its ${DISCOVERY_RPC_QUEUE_LIMIT.toString()}-request safety limit` }) })
	})

	test('drains in-flight bounded workers and stops assigning work before rejecting', async () => {
		let release: (() => void) | undefined
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		const started: number[] = []
		let observedFailure: Error | undefined
		const completion = mapWithConcurrency(
			Array.from({ length: 30 }, (_, index) => index),
			DISCOVERY_RPC_CONCURRENCY,
			async (_value, index) => {
				started.push(index)
				if (index === 0) throw new Error('first worker failed')
				await gate
				return index
			},
		).then(
			() => undefined,
			error => {
				if (error instanceof Error) observedFailure = error
			},
		)
		await new Promise(resolve => setTimeout(resolve, 0))
		try {
			expect(observedFailure).toBeUndefined()
			expect(started).toEqual(Array.from({ length: DISCOVERY_RPC_CONCURRENCY }, (_, index) => index))
		} finally {
			release?.()
			await completion
		}
		expect(observedFailure?.message).toBe('first worker failed')
		expect(started).toEqual(Array.from({ length: DISCOVERY_RPC_CONCURRENCY }, (_, index) => index))
		expect(await mapWithConcurrency([1, 2, 3], DISCOVERY_RPC_CONCURRENCY, async value => value * 2)).toEqual([2, 4, 6])
		let undefinedRejectionObserved = false
		let undefinedRejectionStarts = 0
		try {
			await mapWithConcurrency([1, 2, 3], 1, async () => {
				undefinedRejectionStarts += 1
				throw undefined
			})
		} catch (error) {
			undefinedRejectionObserved = true
			expect(error).toBeUndefined()
		}
		expect(undefinedRejectionObserved).toBeTrue()
		expect(undefinedRejectionStarts).toBe(1)
	})

	test('drains all already-started RPC work before surfacing a concurrent failure', async () => {
		let release: (() => void) | undefined
		const gate = new Promise<void>(resolve => {
			release = resolve
		})
		let rejected = false
		const completion = drainConcurrent([Promise.reject(new Error('anchored read failed')), gate]).catch(error => {
			rejected = true
			throw error
		})
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(rejected).toBeFalse()
		release?.()
		await expect(completion).rejects.toThrow('anchored read failed')
	})

	test('rejects an aggregate pool-by-universe fan-out before issuing RPC requests', async () => {
		const fake = fakeClient(10n)
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 10n,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				limits: { maxPools: 101, maxQuestions: 1, maxStagedOperationsPerPool: 1, maxUniverses: 100, maxVaultsPerPool: 1 },
				wallet: address(1),
			}),
		).rejects.toThrow('maxPools × maxUniverses exceeds the 10000-item discovery safety envelope')
		expect(fake.requested()).toBeUndefined()
		expect(fake.contractReads).toEqual([])
	})

	test('preflights categorical share-migration fan-out at the aggregate boundary', async () => {
		const fixture = snapshotFixture()
		const pool = fixture.pools[0]
		const universe = fixture.universes[0]
		const question = fixture.questions[0]
		if (pool === undefined || universe === undefined || question === undefined) throw new Error('Share-inventory fixture is incomplete')
		const reads: string[] = []
		const client = new Proxy({} as ChaosReadClient, {
			get(_target, property) {
				if (property !== 'readContract') throw new Error(`Unexpected client method ${String(property)}`)
				return async (parameters: { functionName: string }) => {
					reads.push(parameters.functionName)
					if (parameters.functionName === 'balanceOf') return 0n
					if (parameters.functionName === 'isApprovedForAll') return false
					if (parameters.functionName === 'getChildUniverseId') return 1n
					throw new Error(`Unexpected share-inventory read ${parameters.functionName}`)
				}
			},
		})
		const context = { anchorBlockNumber: 10n, client, deployments: fixture.deployments, wallet: fixture.wallet.address }
		const forkedUniverse = { ...universe, forkQuestionId: question.id, forkTime: '1' }
		const withinQuestion = { ...question, kind: 'categorical' as const, outcomeLabels: Array.from({ length: 2_498 }, (_, index) => `Outcome ${index.toString()}`) }
		const warnings: string[] = []
		expect(await discoverShareInventory(context, [pool], fixture.pairs, [forkedUniverse], [withinQuestion], 10n, warnings)).toHaveLength(1)
		expect(warnings).toEqual([])
		expect(reads.filter(name => name === 'getChildUniverseId')).toHaveLength(2_499)

		reads.length = 0
		const overflowQuestion = { ...withinQuestion, outcomeLabels: [...withinQuestion.outcomeLabels, 'Overflow'] }
		expect(await discoverShareInventory(context, [pool], fixture.pairs, [forkedUniverse], [overflowQuestion], 10n, warnings)).toEqual([])
		expect(warnings).toEqual(['Share-inventory discovery truncated because planned approval and migration fan-out is at least 10002 entries, exceeding the configured 10000-entry aggregate limit'])
		expect(reads).toEqual([])
	})

	test('preflights reused pair operators without allocating quadratic approval state', async () => {
		const fixture = snapshotFixture()
		const templatePool = fixture.pools[0]
		const templatePair = fixture.pairs[0]
		const templateUniverse = fixture.universes[0]
		if (templatePool === undefined || templatePair === undefined || templateUniverse === undefined) throw new Error('Share-inventory fixture is incomplete')
		const pools = Array.from({ length: 100 }, (_, index) => ({ ...templatePool, address: address(1_000 + index), coordinator: address(2_000 + index), universeId: index.toString() }))
		const pairs = pools.map((pool, index) => ({ ...templatePair, address: address(3_000 + index), pool: pool.address, universeId: pool.universeId }))
		const universes = pools.map((pool, index) => ({ ...templateUniverse, id: pool.universeId, repToken: address(4_000 + index) }))
		let reads = 0
		const client = new Proxy({} as ChaosReadClient, {
			get() {
				return async () => {
					reads += 1
					throw new Error('Share-inventory RPC must not start after an oversized preflight')
				}
			},
		})
		const warnings: string[] = []
		expect(await discoverShareInventory({ anchorBlockNumber: 10n, client, deployments: fixture.deployments, wallet: fixture.wallet.address }, pools, pairs, universes, fixture.questions, 10n, warnings)).toEqual([])
		expect(warnings).toEqual(['Share-inventory discovery truncated because planned approval and migration fan-out is at least 10100 entries, exceeding the configured 10000-entry aggregate limit'])
		expect(reads).toBe(0)
	})

	test('treats topology limits as strict resident totals and fails closed when registries exceed them', async () => {
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
		expect(snapshot.questions).toEqual([])
		expect(snapshot.universes.map(universe => universe.id)).toEqual(['0', '1'])
		expect(snapshot.warnings).toContain('Question discovery truncated while bounded catch-up authenticated 2 of 3 canonical entries')
		expect(snapshot.warnings.some(warning => warning.startsWith('Universe discovery truncated'))).toBeTrue()
	})

	test('bounds a wide universe fan-out to the resident envelope without building an unbounded queue', async () => {
		const childOutcomes = Array.from({ length: 1_000 }, (_, index) => BigInt(index + 1))
		const fake = fakeClient(10n, hash(1), { childOutcomesByUniverse: { '0': childOutcomes } })
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: fake.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			limits: { maxPools: 3, maxQuestions: 3, maxStagedOperationsPerPool: 3, maxUniverses: 3, maxVaultsPerPool: 3 },
			wallet: address(1),
		})
		expect(snapshot.universes.map(universe => universe.id)).toEqual(['0', '1', '2'])
		expect(snapshot.warnings.some(warning => warning.startsWith('Universe discovery truncated at 3 retained universes'))).toBeTrue()
		expect(fake.contractReads.filter(read => read.functionName === 'getDeployedChildUniverses').map(read => read.args)).toEqual([[0n, 0n, 3n]])
	})

	test('advances oversized counted-registry cursors across restarts while retaining no historical topology', async () => {
		const statePath = await temporaryStatePath()
		const questionIds = Array.from({ length: 11 }, (_, index) => BigInt(100 + index))
		const poolDeployments = Array.from({ length: 11 }, (_, index) => ({
			parent: address(0),
			priceOracleManagerAndOperatorQueuer: address(1_000 + index),
			questionId: questionIds[index] ?? 0n,
			securityPool: address(2_000 + index),
			shareToken: address(3_000 + index),
			truthAuction: address(4_000 + index),
			universeId: 0n,
		}))
		const limits = { maxPools: 3, maxQuestions: 3, maxStagedOperationsPerPool: 3, maxUniverses: 3, maxVaultsPerPool: 3 }
		let previousAnchor: bigint | undefined
		for (let cycle = 0; cycle < 4; cycle += 1) {
			const anchor = 10n + BigInt(cycle)
			const historicalBlockHashes = previousAnchor === undefined ? {} : { [previousAnchor.toString()]: hash(Number(previousAnchor)) }
			const fake = fakeClient(anchor, hash(Number(anchor)), { historicalBlockHashes, poolDeployments, questionIds })
			const restored = await loadImmutableTopologyCache(statePath, topologyIdentity(), limits)
			let checkpoint: CanonicalImmutableTopologyCache | undefined
			const snapshot = await discoverEcosystemSnapshot({
				anchorBlockNumber: anchor,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				limits,
				recordTopologyCache: value => {
					checkpoint = value
				},
				...(restored === undefined ? {} : { topologyCache: restored }),
				wallet: address(1),
			})
			if (checkpoint === undefined) throw new Error('Oversized discovery did not record its durable cursor')
			const expectedCursor = Math.min((cycle + 1) * limits.maxQuestions, questionIds.length)
			expect(checkpoint.discoveryCursors.questions).toMatchObject({ canonicalCount: questionIds.length.toString(), nextIndex: expectedCursor.toString(), retentionMode: 'overflow' })
			expect(checkpoint.discoveryCursors.poolDeployments).toMatchObject({ canonicalCount: poolDeployments.length.toString(), nextIndex: expectedCursor.toString(), retentionMode: 'overflow' })
			expect(checkpoint.questions).toEqual([])
			expect(checkpoint.poolDeployments).toEqual([])
			expect(snapshot.questions).toEqual([])
			expect(snapshot.pools).toEqual([])
			expect(fake.contractReads.filter(read => read.functionName === 'getQuestions')).toHaveLength(1)
			expect(fake.contractReads.filter(read => read.functionName === 'securityPoolDeploymentsRange')).toHaveLength(1)
			expect(fake.contractReads.filter(read => read.functionName === 'questions')).toHaveLength(0)
			expect(fake.contractReads.filter(read => read.functionName === 'questionCreatedTimestamp')).toHaveLength(0)
			expect(fake.contractReads.filter(read => read.functionName === 'getOutcomeLabels')).toHaveLength(0)
			await saveImmutableTopologyCache(statePath, topologyIdentity(), checkpoint, limits)
			previousAnchor = anchor
		}
		const exact = await loadImmutableTopologyCache(statePath, topologyIdentity(), limits)
		expect(exact?.discoveryCursors.questions).toMatchObject({ canonicalCount: '11', nextIndex: '11', retentionMode: 'overflow' })
		expect(exact?.discoveryCursors.poolDeployments).toMatchObject({ canonicalCount: '11', nextIndex: '11', retentionMode: 'overflow' })
		expect(exact?.questions).toEqual([])
		expect(exact?.poolDeployments).toEqual([])
	})

	test('advances an oversized newest-first vault registry across restarts and safely rebuilds after a limit increase', async () => {
		const statePath = await temporaryStatePath()
		const pool = address(20).toLowerCase()
		const oldestFirst = Array.from({ length: 11 }, (_, index) => address(500 + index))
		const limits = { maxPools: 3, maxQuestions: 3, maxUniverses: 3, maxVaultsPerPool: 3 }
		const canonicalCounts = [5, 7, 9, 11]
		const expectedCalls: Array<[bigint, bigint]> = [
			[2n, 3n],
			[1n, 3n],
			[0n, 3n],
			[0n, 2n],
		]
		for (let cycle = 0; cycle < expectedCalls.length; cycle += 1) {
			const canonicalCount = canonicalCounts[cycle]
			if (canonicalCount === undefined) throw new Error(`Missing canonical vault count for cycle ${cycle.toString()}`)
			const newestFirst = [...oldestFirst.slice(0, canonicalCount)].reverse()
			const restored = await loadImmutableTopologyCache(statePath, topologyIdentity(), limits)
			const calls: Array<[bigint, bigint]> = []
			const advanced = await advanceVaultRegistryCursor({
				cachedVaults: restored?.vaultsByPool[pool] ?? [],
				canonicalCount: BigInt(canonicalCount),
				cursor: restored?.discoveryCursors.vaultsByPool[pool],
				label: `Vault registry ${pool}`,
				limit: limits.maxVaultsPerPool,
				readNewestFirstPage: async (start, count) => {
					calls.push([start, count])
					return newestFirst.slice(Number(start), Number(start + count))
				},
			})
			const expectedNextIndex = Math.min((cycle + 1) * limits.maxVaultsPerPool, oldestFirst.length)
			const expectedCall = expectedCalls[cycle]
			if (expectedCall === undefined) throw new Error(`Missing expected vault page call for cycle ${cycle.toString()}`)
			expect(calls).toEqual([expectedCall])
			expect(advanced.cursor).toMatchObject({ canonicalCount: canonicalCount.toString(), nextIndex: expectedNextIndex.toString(), retentionMode: 'overflow' })
			expect(advanced.vaults).toEqual([])
			await saveImmutableTopologyCache(
				statePath,
				topologyIdentity(),
				{
					anchor: { blockHash: hash(600 + cycle), blockNumber: (600 + cycle).toString() },
					discoveryCursors: {
						poolDeployments: restored?.discoveryCursors.poolDeployments ?? { canonicalCount: '0', commitment: hash(0), nextIndex: '0', residentLimit: '3', retentionMode: 'resident' },
						questions: restored?.discoveryCursors.questions ?? { canonicalCount: '0', commitment: hash(0), nextIndex: '0', residentLimit: '3', retentionMode: 'resident' },
						vaultsByPool: { [pool]: advanced.cursor },
					},
					pairsByPool: {},
					poolDeployments: [],
					questions: [],
					schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
					universeChildren: { '0': { childUniverseIds: [], outcomeIndexes: [] } },
					vaultsByPool: {},
				},
				limits,
			)
		}
		const exact = await loadImmutableTopologyCache(statePath, topologyIdentity(), limits)
		const exactCursor = exact?.discoveryCursors.vaultsByPool[pool]
		if (exactCursor === undefined) throw new Error('Exact oversized vault cursor was not persisted')
		expect(exactCursor).toMatchObject({ canonicalCount: '11', nextIndex: '11', retentionMode: 'overflow' })

		const newestFirst = [...oldestFirst].reverse()
		const rebuildCalls: Array<[bigint, bigint]> = []
		const rebuilt = await advanceVaultRegistryCursor({
			cachedVaults: [],
			canonicalCount: 11n,
			cursor: exactCursor,
			label: `Vault registry ${pool}`,
			limit: 11,
			readNewestFirstPage: async (start, count) => {
				rebuildCalls.push([start, count])
				return newestFirst.slice(Number(start), Number(start + count))
			},
		})
		expect(rebuildCalls).toEqual([[0n, 11n]])
		expect(rebuilt.cursor).toMatchObject({ canonicalCount: '11', nextIndex: '11', retentionMode: 'resident' })
		expect(rebuilt.cursor.commitment).toBe(exactCursor.commitment)
		expect(rebuilt.vaults).toEqual(newestFirst)
		await expect(
			advanceVaultRegistryCursor({
				cachedVaults: [],
				canonicalCount: 10n,
				cursor: exactCursor,
				label: `Vault registry ${pool}`,
				limit: 11,
				readNewestFirstPage: async () => [],
			}),
		).rejects.toThrow('no longer extends its authenticated cursor')
	})

	test('exhausts categorical outcome labels beyond the first 256-entry page', async () => {
		const labels = Array.from({ length: 512 }, (_, index) => `Outcome ${index.toString()}`)
		const fake = fakeClient(10n, hash(1), {
			outcomeLabelsByQuestion: { '101': labels },
			questionIds: [101n],
		})
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: fake.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			wallet: address(1),
		})
		expect(snapshot.questions[0]?.outcomeLabels).toEqual(labels)
		expect(fake.contractReads.filter(read => read.functionName === 'getOutcomeLabels').map(read => read.args)).toEqual([
			[101n, 0n, 256n],
			[101n, 256n, 256n],
			[101n, 512n, 256n],
		])
	})

	test('rejects a provider that returns a full outcome-label page forever', async () => {
		const fake = fakeClient(10n, hash(1), {
			outcomeLabelPage: (_questionId, start, count) => Array.from({ length: Number(count) }, (_, index) => `Outcome ${(start + BigInt(index)).toString()}`),
			questionIds: [101n],
		})
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 10n,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				limits: { maxOutcomeLabelsPerQuestion: 512 },
				wallet: address(1),
			}),
		).rejects.toThrow('Question 101 exceeds the configured 512-label discovery limit')
		expect(fake.contractReads.filter(read => read.functionName === 'getOutcomeLabels').map(read => read.args)).toEqual([
			[101n, 0n, 256n],
			[101n, 256n, 256n],
			[101n, 512n, 1n],
		])
	})

	test('rejects outcome labels that exceed the configured UTF-8 byte budget', async () => {
		const fake = fakeClient(10n, hash(1), {
			outcomeLabelsByQuestion: { '101': ['é'] },
			questionIds: [101n],
		})
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 10n,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				limits: { maxOutcomeLabelUtf8BytesPerQuestion: 1 },
				wallet: address(1),
			}),
		).rejects.toThrow('Question 101 outcome labels exceed the configured 1-byte UTF-8 discovery limit')
	})

	test('discovers and persists an escaped outcome label at the shared UTF-8 byte boundary', async () => {
		const statePath = await temporaryStatePath()
		const boundaryLabel = '\u0000'.repeat(IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES)
		const fake = fakeClient(10n, hash(10), {
			outcomeLabelsByQuestion: { '101': [boundaryLabel] },
			questionIds: [101n],
		})
		let checkpoint: CanonicalImmutableTopologyCache | undefined
		const snapshot = await discoverEcosystemSnapshot({
			anchorBlockNumber: 10n,
			client: fake.client,
			deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
			recordTopologyCache: value => {
				checkpoint = value
			},
			wallet: address(1),
		})
		if (checkpoint === undefined) throw new Error('Boundary-label discovery did not produce a topology checkpoint')
		expect(snapshot.questions[0]?.outcomeLabels[0]?.length).toBe(IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES)
		await saveImmutableTopologyCache(statePath, topologyIdentity(), checkpoint)
		const restored = await loadImmutableTopologyCache(statePath, topologyIdentity())
		expect(restored?.questions[0]?.outcomeLabels[0]).toBe(boundaryLabel)
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 10n,
				client: fake.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				limits: { maxOutcomeLabelUtf8BytesPerQuestion: IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES + 1 },
				wallet: address(1),
			}),
		).rejects.toThrow('immutable-topology safety envelope')
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
			limits: { maxPools: 10, maxQuestions: 10, maxStagedOperationsPerPool: 10, maxUniverses: 10, maxVaultsPerPool: 10 },
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
			limits: { maxPools: 10, maxQuestions: 10, maxStagedOperationsPerPool: 10, maxUniverses: 10, maxVaultsPerPool: 10 },
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
		expect(next.contractReads.filter(read => read.functionName === 'getDeployedChildUniverses' && read.args?.[0] === 0n).map(read => read.args)).toEqual([[0n, 3n, 7n]])
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
			limits: { maxPools: 10, maxQuestions: 10, maxStagedOperationsPerPool: 10, maxUniverses: 10, maxVaultsPerPool: 10 },
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
			limits: { maxPools: 10, maxQuestions: 10, maxStagedOperationsPerPool: 10, maxUniverses: 10, maxVaultsPerPool: 10 },
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

	test('rebuilds a noncanonical topology checkpoint and treats an unavailable history probe as an endpoint failure', async () => {
		const base: CanonicalImmutableTopologyCache = {
			anchor: { blockHash: hash(10), blockNumber: '10' },
			discoveryCursors: {
				poolDeployments: { canonicalCount: '0', commitment: hash(0), nextIndex: '0', residentLimit: '100', retentionMode: 'resident' },
				questions: { canonicalCount: '1', commitment: hash(20), nextIndex: '1', residentLimit: '100', retentionMode: 'resident' },
				vaultsByPool: {},
			},
			pairsByPool: {},
			poolDeployments: [],
			questions: [{ createdAt: '1', endTime: '3', id: '101', kind: 'binary', numTicks: '2', outcomeLabels: ['Yes', 'No'], startTime: '2' }],
			schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
			universeChildren: {},
			vaultsByPool: {},
		}
		const cases = [
			{ anchorBlockNumber: 9n, cache: base, graph: { questionIds: [101n] } },
			{ anchorBlockNumber: 10n, cache: base, graph: { questionIds: [101n] }, hash: hash(11) },
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
		const unavailable = fakeClient(11n, hash(11), { historicalBlockErrors: ['10'], questionIds: [101n] })
		await expect(
			discoverEcosystemSnapshot({
				anchorBlockNumber: 11n,
				client: unavailable.client,
				deployments: { openOracle: address(6), questionData: address(3), securityPoolFactory: address(4), securityPoolForker: address(5), tradingFactory: address(8), tradingRouter: address(9), weth: address(7), zoltar: address(2) },
				topologyCache: base,
				wallet: address(1),
			}),
		).rejects.toThrow('Historical block 10 unavailable')
		expect(unavailable.contractReads).toEqual([])
	})

	test('exhausts a counted pool-style collection in bounded pages', async () => {
		const calls: Array<[bigint, bigint]> = []
		const values = [10n, 11n, 12n, 13n, 14n]
		const discovered = await collectCountedPages({
			count: BigInt(values.length),
			label: 'Pool discovery',
			maximumItems: values.length,
			pageSize: 2,
			readPage: async (start, count) => {
				calls.push([start, count])
				return values.slice(Number(start), Number(start + count))
			},
			start: 0n,
		})
		expect(discovered).toEqual({ complete: true, nextStart: 5n, values })
		expect(calls).toEqual([
			[0n, 2n],
			[2n, 2n],
			[4n, 1n],
		])
	})

	test('bounds a counted collection to one cycle and resumes from its durable cursor', async () => {
		const calls: Array<[bigint, bigint]> = []
		const values = Array.from({ length: 11 }, (_, index) => BigInt(index + 10))
		const readPage = async (start: bigint, count: bigint) => {
			calls.push([start, count])
			return values.slice(Number(start), Number(start + count))
		}
		const first = await collectCountedPages({ count: BigInt(values.length), label: 'Question discovery', maximumItems: 3, pageSize: 2, readPage, start: 0n })
		expect(first).toEqual({ complete: false, nextStart: 3n, values: [10n, 11n, 12n] })
		const second = await collectCountedPages({ count: BigInt(values.length), label: 'Question discovery', maximumItems: 3, pageSize: 2, readPage, start: first.nextStart })
		expect(second).toEqual({ complete: false, nextStart: 6n, values: [13n, 14n, 15n] })
		expect(calls).toEqual([
			[0n, 2n],
			[2n, 1n],
			[3n, 2n],
			[5n, 1n],
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
							if (start === 0n)
								return [
									[42n, 43n],
									[operation(), operation()],
								]
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
		const overflowWarnings: string[] = []
		expect(await discoverStagedOperations(client, pool, 555n, 1, overflowWarnings)).toEqual([])
		expect(overflowWarnings).toEqual([`Staged-operation discovery truncated for ${pool.coordinator}: exact canonical total 2 exceeds the configured 1-entry resident limit`])
		expect(pageRequests).toEqual([])

		const executable = await discoverStagedOperations(client, pool, 555n, 2, [])
		expect(executable[0]).toMatchObject({ executionExpectedResult: '0x', executionExpectedSuccess: true, operation: 1 })
		expect(executable).toHaveLength(2)
		expect(pageRequests).toEqual([[0n, 2n]])
		expect(simulations[0]).toMatchObject({ account: pool.coordinator, args: [fixture.wallet.address, 100n], functionName: 'withdrawRepFromVault' })
		simulationFailure = new Error('execution reverted: stale withdrawal')
		expect((await discoverStagedOperations(client, pool, 555n, 2, []))[0]?.executionExpectedSuccess).toBe(false)
		simulationFailure = new Error('RPC connection closed')
		await expect(discoverStagedOperations(client, pool, 555n, 2, [])).rejects.toThrow('RPC connection closed')
		simulationFailure = undefined
		receiver = address(99)
		expect((await discoverStagedOperations(client, pool, 555n, 2, []))[0]?.executionExpectedSuccess).toBe(false)
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
