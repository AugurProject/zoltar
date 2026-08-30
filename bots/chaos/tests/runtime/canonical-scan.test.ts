import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, zeroHash } from '../support/bot-shared.ts'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { CANONICAL_MUTATING_CONTRACT_MANIFEST } from '../../src/contracts/surface.ts'
import { canonicalLifecyclePresence } from '../../src/operations/catalog.ts'
import {
	applyExecutionPolicy,
	blockExecutableEvaluations,
	chaosReadClients,
	completeOperationCoverage,
	createChaosReadPool,
	discoveryCoverageIsComplete,
	loadTopologyCacheForScan,
	planningOptions,
	sharedCanonicalBlockNumber,
	snapshotWithProtocolIndex,
	unavailableOperationCatalog,
	walletInventory,
} from '../../src/runtime/canonical-scan.ts'
import type { ChaosEcosystem, EcosystemSnapshot, EvaluatedOperation } from '../../src/operations/types.ts'
import type { ChaosProtocolIndex } from '../../src/monitoring/protocol-index.ts'
import { deriveChildUniverseId } from '../../src/monitoring/protocol-index.ts'
import { IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, immutableTopologySidecarDirectory, saveImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity } from '../../src/monitoring/topology-cache.ts'
import { hash, snapshotFixture } from '../operations/fixture.ts'
import { applyLiveNoveltyInventoryReadiness, liveInventoryReadinessBlockers } from '../../src/runtime/live-readiness.ts'

const wallet = getAddress('0x0000000000000000000000000000000000000001')
const weth = getAddress('0x0000000000000000000000000000000000000002')
const rep = getAddress('0x0000000000000000000000000000000000000003')
const oracle = getAddress('0x0000000000000000000000000000000000000004')
const auction = getAddress('0x0000000000000000000000000000000000000005')

function settings() {
	return parseSettings({
		connectivity: null,
		deployment: {
			openOracle: oracle,
			questionData: wallet,
			securityPoolFactory: wallet,
			securityPoolForker: wallet,
			tradingFactory: wallet,
			tradingRouter: wallet,
			weth,
			zoltar: wallet,
		},
		discovery: {
			maxPools: 100,
			maxQuestions: 100,
			maxStagedOperationsPerPool: 100,
			maxUniverses: 100,
			maxVaultsPerPool: 100,
		},
		network: { chainId: 11155111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
		networkConfigured: false,
		paused: true,
		privateKey: null,
		runtime: {
			execute: false,
			lifecyclePollMilliseconds: 12000,
			once: false,
			protocolLogBlockSpan: 2000,
			protocolStartBlock: '0',
			stateFile: '.state/test.json',
			ui: false,
			uiHost: '127.0.0.1',
			uiPort: 4193,
		},
		scheduler: { maximumDelaySeconds: 3600, minimumDelaySeconds: 60 },
		strategy: {
			allowHighRiskOperations: true,
			allowIrreversibleOperations: false,
			enabledEcosystems: ['zoltar'],
			maximumEthPerOperation: '0.05',
			maximumGasCostEth: '0.02',
			maximumRepPerOperation: '10',
			minimumEthReserve: '0.05',
			minimumRepReserve: '10',
			workflowValidForBlocks: 96,
		},
		submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
		version: 1,
	})
}

function snapshot(): EcosystemSnapshot {
	return {
		anchor: { baseFeePerGas: '1', blockHash: zeroHash, blockNumber: '10', timestamp: '20' },
		auctions: [{ address: auction, bids: [], clearingTick: '0', endTime: '30', finalized: false, hasClearingPrice: false, minimumBidAttoEth: 1n.toString(), pendingEthRefund: '0', pool: wallet, startTime: '1', underfunded: false, underfundedWinningAttoEth: 0n.toString() }],
		chainId: 11155111,
		deployments: { openOracle: oracle, questionData: wallet, securityPoolFactory: wallet, securityPoolForker: wallet, tradingFactory: wallet, tradingRouter: wallet, weth, zoltar: wallet },
		escalationDeposits: [],
		pairs: [],
		pools: [],
		questions: [],
		reports: [],
		schemaVersion: 1,
		stagedOperations: [],
		universes: [
			{ forkQuestionId: '0', forkThresholdAttoRep: 1n.toString(), forkTime: '0', id: '0', initialEscalationDepositAttoRep: (10n ** 18n).toString(), knownChildOutcomes: [], migrationBalance: '0', migrationRepSplitProgressByOutcome: {}, nonDecisionThresholdAttoRep: (2n * 10n ** 18n).toString(), repToken: rep },
		],
		wallet: {
			address: wallet,
			ethBalanceAttoEth: 12n.toString(),
			lpTokens: [],
			openOracleEthCredit: '0',
			shares: [],
			tokens: [
				{ address: weth, allowances: {}, balance: '7', openOracleCredit: '0', symbol: 'WETH' },
				{ address: rep, allowances: {}, balance: '9', openOracleCredit: '0', symbol: 'REP' },
			],
		},
		warnings: [],
	}
}

describe('canonical scan policy', () => {
	test('discards a valid disk or hot cache after discovery limits decrease while preserving corruption failures', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-canonical-topology-'))
		try {
			const statePath = join(directory, 'operator.json')
			const identity: ImmutableTopologyIdentity = {
				chainId: 11_155_111,
				openOracle: oracle,
				questionData: wallet,
				securityPoolFactory: wallet,
				securityPoolForker: wallet,
				tradingFactory: wallet,
				tradingRouter: wallet,
				weth,
				zoltar: wallet,
			}
			const cache: CanonicalImmutableTopologyCache = {
				anchor: { blockHash: zeroHash, blockNumber: '10' },
				discoveryCursors: {
					poolDeployments: { canonicalCount: '0', commitment: zeroHash, nextIndex: '0', residentLimit: '2', retentionMode: 'resident' },
					questions: { canonicalCount: '2', commitment: zeroHash, nextIndex: '2', residentLimit: '2', retentionMode: 'resident' },
					vaultsByPool: {},
				},
				pairsByPool: {},
				poolDeployments: [],
				questions: [0, 1].map(index => ({ createdAt: '1', endTime: '3', id: index.toString(), kind: 'binary' as const, numTicks: '2', outcomeLabels: ['Yes', 'No'], startTime: '2' })),
				schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
				universeChildren: {},
				vaultsByPool: {},
			}
			await saveImmutableTopologyCache(statePath, identity, cache)
			const lowered = { maxPools: 1, maxQuestions: 1, maxUniverses: 1, maxVaultsPerPool: 1 }
			expect(await loadTopologyCacheForScan({ identity, limits: lowered, statePath })).toBeUndefined()
			expect(await loadTopologyCacheForScan({ identity, limits: lowered, previous: cache, statePath })).toBeUndefined()

			const storePath = immutableTopologySidecarDirectory(statePath)
			const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
			if (generation === undefined) throw new Error('Immutable topology generation was not committed')
			const generationPath = join(storePath, generation.name)
			const questionChunk = (await readdir(generationPath)).find(name => name.startsWith('questions-'))
			if (questionChunk === undefined) throw new Error('Immutable topology generation has no question chunk')
			await writeFile(join(generationPath, questionChunk), '{not valid json', { mode: 0o600 })
			await expect(loadTopologyCacheForScan({ identity, limits: { ...lowered, maxQuestions: 2 }, statePath })).rejects.toThrow('digest')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('anchors at the newest block supported by the configured quorum', () => {
		expect(sharedCanonicalBlockNumber([112n, 112n, 80n], 2)).toBe(112n)
		expect(sharedCanonicalBlockNumber([112n, 111n, 80n], 2)).toBe(111n)
		expect(() => sharedCanonicalBlockNumber([112n], 2)).toThrow('enough independent RPC heads')
	})

	test('projects indexed identities and wallet funding inventory', () => {
		const base = snapshot()
		const index: ChaosProtocolIndex = {
			auctionBids: { [auction.toLowerCase()]: [{ amountAttoEth: 4n.toString(), index: '2', refunded: false, tick: '-1' }] },
			auctionRefunds: {},
			chainId: 11155111,
			childRepSplits: [],
			cursor: { blockHash: zeroHash, blockNumber: '10' },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: oracle,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: wallet,
			startBlock: '0',
			wallet,
			zoltar: wallet,
		}
		const projected = snapshotWithProtocolIndex(base, index)
		expect(projected.auctions[0]?.bids[0]?.tick).toBe('-1')
		expect(walletInventory(projected)).toEqual({
			eth: '12',
			rep: [{ balance: '9', symbol: 'REP', token: rep, universeId: '0' }],
			weth: '7',
		})
	})

	test('keeps partial refund backfill non-executable and requires complete index storage continuity', () => {
		const partial = snapshot()
		const partialAuction = partial.auctions[0]
		if (partialAuction === undefined) throw new Error('Auction fixture missing')
		partialAuction.pendingEthRefund = '8'
		const options = planningOptions(settings(), 1)
		expect(canonicalLifecyclePresence(partial, options).some(item => item.definitionId === 'statoblast.auction.withdraw-refund')).toBeFalse()

		const generation = hash(600)
		const completeIndex: ChaosProtocolIndex = {
			auctionBids: {},
			auctionRefunds: { [auction.toLowerCase()]: { generation, pendingAttoEth: 8n.toString() } },
			chainId: partial.chainId,
			childRepSplits: [],
			cursor: { blockHash: partial.anchor.blockHash, blockNumber: partial.anchor.blockNumber },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: partial.deployments.openOracle,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: partial.deployments.securityPoolForker,
			startBlock: '0',
			wallet: partial.wallet.address,
			zoltar: partial.deployments.zoltar,
		}
		const complete = snapshotWithProtocolIndex(partial, completeIndex)
		expect(complete.auctions[0]?.pendingEthRefundGeneration).toBe(generation)
		expect(canonicalLifecyclePresence(complete, options).some(item => item.definitionId === 'statoblast.auction.withdraw-refund')).toBeTrue()

		expect(() => snapshotWithProtocolIndex(partial, { ...completeIndex, auctionRefunds: {} })).toThrow('without an authenticated EthRefundDeferred episode')
		expect(() => snapshotWithProtocolIndex(partial, { ...completeIndex, auctionRefunds: { [auction.toLowerCase()]: { generation, pendingAttoEth: 7n.toString() } } })).toThrow('does not match its authenticated event episode')

		const withdrawn = snapshot()
		expect(() => snapshotWithProtocolIndex(withdrawn, completeIndex)).toThrow('authenticated active refund episode but zero anchored pending storage')
	})

	test('projects deterministic wallet and pool-held REP migration progress into the anchored snapshot', () => {
		const base = snapshotFixture()
		const pool = base.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		const index: ChaosProtocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: base.chainId,
			childRepSplits: [
				{ childPoolRepSplitAttoRep: 30n.toString(), outcomeIndex: '1', pool: pool.address },
				{ childPoolRepSplitAttoRep: 40n.toString(), outcomeIndex: '2', pool: pool.address },
			],
			cursor: { blockHash: base.anchor.blockHash, blockNumber: base.anchor.blockNumber },
			escalationDeposits: [],
			migrationRepSplits: [
				{ childMigrationRepAmountAttoRep: 20n.toString(), childUniverseId: deriveChildUniverseId(0n, 1n).toString(), outcomeIndex: '1', universeId: '0' },
				{ childMigrationRepAmountAttoRep: 25n.toString(), childUniverseId: deriveChildUniverseId(0n, 2n).toString(), outcomeIndex: '2', universeId: '0' },
			],
			openOracle: base.deployments.openOracle,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: base.deployments.securityPoolForker,
			startBlock: '0',
			wallet: base.wallet.address,
			zoltar: base.deployments.zoltar,
		}
		const projected = snapshotWithProtocolIndex(base, index)
		expect(projected.universes[0]?.migrationRepSplitProgressByOutcome).toEqual({ '1': '20', '2': '25' })
		expect(projected.pools[0]?.forkRepMigrationProgressByOutcome).toEqual({ '1': '30', '2': '40' })
	})

	test('blocks disabled ecosystems and every executable operation during index backfill', () => {
		const executable: EvaluatedOperation = {
			definition: { classification: 'selectable', contract: 'Trading', description: 'trade', discoveryInputs: [], ecosystem: 'trading', id: 'trade', label: 'Trade', method: 'swap', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			plan: { classification: 'selectable', createdAtBlock: '1', definitionId: 'trade', ecosystem: 'trading', id: 'plan', label: 'Trade', metadata: {}, obligation: false, planningSeed: 1, postconditions: [], priority: 'random', risk: 'low', steps: [] },
		}
		const result = applyExecutionPolicy([executable], settings(), false, '5', '10', 10n ** 18n)
		expect(result[0]?.eligibility.eligible).toBeFalse()
		expect(result[0]?.plan).toBeUndefined()
		expect(result[0]?.eligibility.blockers).toContain('The trading ecosystem is disabled by policy')
		expect(result[0]?.eligibility.blockers.join(' ')).toContain('backfilling through block 5 of 10')
	})

	test('rechecks live ETH and canonical REP inventory after every scan without blocking lifecycle work', () => {
		const selectable: EvaluatedOperation = {
			definition: { classification: 'selectable', contract: 'Trading', description: 'trade', discoveryInputs: [], ecosystem: 'trading', id: 'trade', label: 'Trade', method: 'swap', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			plan: { classification: 'selectable', createdAtBlock: '1', definitionId: 'trade', ecosystem: 'trading', id: 'trade:1', label: 'Trade', metadata: {}, obligation: false, planningSeed: 1, postconditions: [], priority: 'random', risk: 'low', steps: [] },
		}
		const lifecycle: EvaluatedOperation = {
			definition: { classification: 'lifecycle-obligation', contract: 'OpenOracle', description: 'settle', discoveryInputs: [], ecosystem: 'open-oracle', id: 'settle', label: 'Settle', method: 'settle', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			plan: { classification: 'lifecycle-obligation', createdAtBlock: '1', definitionId: 'settle', ecosystem: 'open-oracle', id: 'settle:1', label: 'Settle', metadata: {}, obligation: true, planningSeed: 1, postconditions: [], priority: 'urgent', risk: 'low', steps: [] },
		}
		const strategy = { maximumGasCostAttoEth: 2n, minimumEthReserveAttoEth: 5n, minimumRepReserveAttoRep: 9n }
		const universes = [{ id: '0', repToken: rep }]
		const fundedRep = { balance: '9', symbol: 'REP', token: rep, universeId: '0' }
		const funded = { eth: '7', rep: [fundedRep] }

		expect(liveInventoryReadinessBlockers(funded, universes, strategy)).toEqual([])
		expect(applyLiveNoveltyInventoryReadiness([selectable, lifecycle], funded, universes, strategy)).toEqual([selectable, lifecycle])

		for (const inventory of [
			{ ...funded, eth: '6' },
			{ ...funded, rep: [{ ...fundedRep, balance: '8' }] },
			{ ...funded, rep: [{ ...fundedRep, token: weth }] },
		]) {
			const result = applyLiveNoveltyInventoryReadiness([selectable, lifecycle], inventory, universes, strategy)
			expect(result[0]?.eligibility.eligible).toBeFalse()
			expect(result[0]?.plan).toBeUndefined()
			expect(result[1]).toEqual(lifecycle)
		}
	})

	test('blocks an entire terminal private next-block plan under public submission policy', () => {
		const executable: EvaluatedOperation = {
			definition: { classification: 'selectable', contract: 'SecurityPoolCoordinator', description: 'request', discoveryInputs: [], ecosystem: 'zoltar', id: 'request', label: 'Request', method: 'requestPrice', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			plan: {
				classification: 'selectable',
				createdAtBlock: '1',
				definitionId: 'request',
				ecosystem: 'zoltar',
				id: 'plan',
				label: 'Request',
				metadata: {},
				obligation: false,
				planningSeed: 1,
				postconditions: [],
				priority: 'random',
				risk: 'low',
				steps: [],
				terminalSubmission: { kind: 'private-next-block', maximumFeePerGas: '2000000002' },
			},
		}

		const result = applyExecutionPolicy([executable], settings(), true, '10', '10', 10n ** 18n)

		expect(result[0]?.eligibility.eligible).toBeFalse()
		expect(result[0]?.plan).toBeUndefined()
		expect(result[0]?.eligibility.blockers.join(' ')).toContain('private submission')
	})

	test('blocks a multi-step plan whose cumulative gas and cleanup reserve exceed anchored ETH inventory', () => {
		const step = {
			data: '0x' as const,
			evidence: [],
			gasLimit: '100000',
			id: 'first',
			label: 'First step',
			preflightCalls: [],
			to: wallet,
			walletAssetDebits: [],
		}
		const executable: EvaluatedOperation = {
			definition: { classification: 'selectable', contract: 'Zoltar', description: 'multi-step', discoveryInputs: [], ecosystem: 'zoltar', id: 'multi-step', label: 'Multi-step', method: 'multiStep', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			plan: {
				classification: 'selectable',
				createdAtBlock: '10',
				definitionId: 'multi-step',
				ecosystem: 'zoltar',
				id: 'multi-step:10',
				label: 'Multi-step',
				maximumCleanupTransactionCount: 1,
				metadata: {},
				obligation: false,
				planningSeed: 1,
				postconditions: [],
				priority: 'random',
				risk: 'low',
				steps: [step, { ...step, id: 'second', label: 'Second step' }],
			},
		}
		const anchoredBalance = 10n ** 17n

		const result = applyExecutionPolicy([executable], settings(), true, '10', '10', anchoredBalance)

		expect(result[0]?.eligibility.eligible).toBeFalse()
		expect(result[0]?.plan).toBeUndefined()
		expect(result[0]?.eligibility.blockers.join(' ')).toContain('cannot fund all remaining workflow steps')
	})

	test('maps every configured risk and reserve limit into planning', () => {
		expect(planningOptions(settings(), 42)).toEqual({
			allowHighRisk: true,
			allowIrreversibleOperations: false,
			immutableTopologyCapacity: {
				maxPools: 100,
				maxQuestions: 100,
				maxStagedOperationsPerPool: 100,
				maxUniverses: 100,
				maxVaultsPerPool: 100,
				maximumAggregateItems: 10_000,
			},
			maximumBlockIntervalSeconds: 60,
			maxEthSpendAttoEth: (5n * 10n ** 16n).toString(),
			maximumGasCostAttoEth: (2n * 10n ** 16n).toString(),
			maxRepSpendAttoRep: (10n ** 19n).toString(),
			minimumEthReserveAttoEth: (5n * 10n ** 16n).toString(),
			minimumRepReserveAttoRep: (10n ** 19n).toString(),
			seed: 42,
			submissionMode: 'public',
			workflowValidForBlocks: 96,
		})
	})

	test('uses credential-free endpoint labels in quorum evidence', () => {
		const configured = parseSettings({
			...serializedSettings(settings()),
			connectivity: {
				publicRpcUrls: ['https://submit.example/private-key'],
				quorumRpcUrls: [],
				readRpcUrl: 'https://read.example/private-secret?api_key=hunter2',
				rpcQuorum: 1,
			},
			networkConfigured: true,
		})
		const pool = createChaosReadPool(configured)
		const observations = chaosReadClients(configured, pool)
		const repeated = chaosReadClients(configured, pool)
		expect(observations.map(observation => observation.endpoint)).toEqual(['https://read.example'])
		expect(repeated[0]?.client).toBe(observations[0]?.client)
		expect(JSON.stringify(observations.map(observation => observation.endpoint))).not.toContain('hunter2')
	})

	test('keeps the full catalog visible while execution prerequisites are unavailable', () => {
		const catalog = unavailableOperationCatalog('Configure an operator signer')
		expect(catalog.length).toBeGreaterThan(20)
		expect(catalog.every(operation => !operation.eligibility.eligible)).toBeTrue()
		const blocked = blockExecutableEvaluations(catalog, 'Canonical discovery is unavailable')
		expect(blocked.filter(operation => operation.definition.classification === 'selectable').every(operation => operation.eligibility.blockers.includes('Canonical discovery is unavailable'))).toBeTrue()
	})

	test('keeps a semantic selector alias visible beside its one executable catalog route', () => {
		const coverage = unavailableOperationCatalog('Configure an operator signer')
		const executable = coverage.filter(operation => operation.definition.id === 'statoblast.auction.settle-bids')
		const aliases = coverage.filter(operation => operation.definition.contract === 'SecurityPoolForker' && operation.definition.method === 'claimAuctionProceeds')
		expect(executable).toHaveLength(1)
		expect(aliases).toHaveLength(1)
		expect(aliases[0]?.definition).toMatchObject({
			classification: 'lifecycle-obligation',
			description: expect.stringContaining('Semantic alias'),
			id: 'surface.security-pool-forker.claim-auction-proceeds',
			independentlyExecutable: false,
			label: 'SecurityPoolForker.claimAuctionProceeds',
			risk: 'low',
		})
		expect(aliases[0]?.eligibility).toEqual({
			blockers: [expect.stringContaining('SecurityPoolForker.settleAuctionBids')],
			eligible: false,
		})
		expect(aliases[0]?.plan).toBeUndefined()
		expect(aliases[0]?.definition.id).not.toBe(executable[0]?.definition.id)
		expect(completeOperationCoverage(coverage).filter(operation => operation.definition.method === 'claimAuctionProceeds')).toHaveLength(1)
	})

	test('fails closed when any bounded discovery collection is truncated', () => {
		expect(discoveryCoverageIsComplete([])).toBeTrue()
		expect(discoveryCoverageIsComplete(['Pool discovery truncated at 100 entries'])).toBeFalse()
		expect(discoveryCoverageIsComplete(['Share-inventory discovery truncated because planned fan-out exceeds its aggregate limit'])).toBeFalse()
		expect(discoveryCoverageIsComplete(['A non-coverage advisory'])).toBeTrue()
	})

	test('shows role-restricted and dangerous ABI methods as explicit non-candidates', () => {
		const coverage = completeOperationCoverage([])
		const rawTransfer = coverage.find(operation => operation.definition.contract === 'ReputationToken' && operation.definition.method === 'transfer')
		const roleCall = coverage.find(operation => operation.definition.contract === 'SecurityPool' && operation.definition.method === 'setSystemState')
		expect(rawTransfer?.definition.classification).toBe('excluded-dangerous')
		expect(rawTransfer?.eligibility.eligible).toBeFalse()
		expect(roleCall?.definition.classification).toBe('role-restricted')
		expect(roleCall?.eligibility.blockers[0]).toContain('SecurityPoolForker')
	})

	test('assigns every canonical mutating contract family to its operator ecosystem', () => {
		const coverage = completeOperationCoverage([])
		const zoltarContracts = new Set(['GenesisReputationToken', 'ReputationToken', 'Zoltar', 'ZoltarQuestionData'])
		const openOracleContracts = new Set(['OpenOracle', 'WETH9'])
		const tradingContracts = new Set(['ShareToken', 'TwoWayConstantProductFactory', 'TwoWayConstantProductPair', 'TwoWayConstantProductRouter'])
		for (const { contract } of CANONICAL_MUTATING_CONTRACT_MANIFEST) {
			const operations = coverage.filter(operation => operation.definition.contract === contract)
			expect(operations.length).toBeGreaterThan(0)
			let expected: ChaosEcosystem = 'statoblast'
			if (zoltarContracts.has(contract)) expected = 'zoltar'
			else if (openOracleContracts.has(contract)) expected = 'open-oracle'
			else if (tradingContracts.has(contract)) expected = 'trading'
			expect(new Set(operations.map(operation => operation.definition.ecosystem))).toEqual(new Set([expected]))
		}
	})
})
