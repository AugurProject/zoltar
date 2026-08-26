import { describe, expect, test } from 'bun:test'
import { getAddress, zeroHash } from '@zoltar/bot-shared/ethereum'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { CANONICAL_MUTATING_CONTRACT_MANIFEST } from '../../src/contracts/surface.ts'
import { applyExecutionPolicy, blockExecutableEvaluations, chaosReadClients, completeOperationCoverage, createChaosReadPool, discoveryCoverageIsComplete, planningOptions, sharedCanonicalBlockNumber, snapshotWithProtocolIndex, unavailableOperationCatalog, walletInventory } from '../../src/runtime/canonical-scan.ts'
import type { ChaosEcosystem, EcosystemSnapshot, EvaluatedOperation } from '../../src/operations/types.ts'
import type { ChaosProtocolIndex } from '../../src/monitoring/protocol-index.ts'
import { deriveChildUniverseId } from '../../src/monitoring/protocol-index.ts'
import { snapshotFixture } from '../operations/fixture.ts'

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
		anchor: { blockHash: zeroHash, blockNumber: '10', timestamp: '20' },
		auctions: [{ address: auction, bids: [], clearingTick: '0', endTime: '30', finalized: false, hasClearingPrice: false, minimumBidAttoEth: 1n.toString(), pendingEthRefund: '0', pool: wallet, startTime: '1' }],
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
	test('anchors at the newest block supported by the configured quorum', () => {
		expect(sharedCanonicalBlockNumber([112n, 112n, 80n], 2)).toBe(112n)
		expect(sharedCanonicalBlockNumber([112n, 111n, 80n], 2)).toBe(111n)
		expect(() => sharedCanonicalBlockNumber([112n], 2)).toThrow('enough independent RPC heads')
	})

	test('projects indexed identities and wallet funding inventory', () => {
		const base = snapshot()
		const index: ChaosProtocolIndex = {
			auctionBids: { [auction.toLowerCase()]: [{ amountAttoEth: 4n.toString(), index: '2', refunded: false, tick: '-1' }] },
			chainId: 11155111,
			childRepSplits: [],
			cursor: { blockHash: zeroHash, blockNumber: '10' },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: oracle,
			reports: [],
			schemaVersion: 2,
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

	test('projects deterministic wallet and pool-held REP migration progress into the anchored snapshot', () => {
		const base = snapshotFixture()
		const pool = base.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		const index: ChaosProtocolIndex = {
			auctionBids: {},
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
			schemaVersion: 2,
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
		const result = applyExecutionPolicy([executable], settings(), false, '5', '10')
		expect(result[0]?.eligibility.eligible).toBeFalse()
		expect(result[0]?.plan).toBeUndefined()
		expect(result[0]?.eligibility.blockers).toContain('The trading ecosystem is disabled by policy')
		expect(result[0]?.eligibility.blockers.join(' ')).toContain('backfilling through block 5 of 10')
	})

	test('maps every configured risk and reserve limit into planning', () => {
		expect(planningOptions(settings(), 42)).toEqual({
			allowHighRisk: true,
			allowIrreversibleOperations: false,
			maxEthSpendAttoEth: (5n * 10n ** 16n).toString(),
			maxRepSpendAttoRep: (10n ** 19n).toString(),
			minimumEthReserveAttoEth: (5n * 10n ** 16n).toString(),
			minimumRepReserveAttoRep: (10n ** 19n).toString(),
			seed: 42,
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
		expect(observations.map(observation => observation.endpoint)).toEqual(['https://read.example'])
		expect(JSON.stringify(observations.map(observation => observation.endpoint))).not.toContain('hunter2')
	})

	test('keeps the full catalog visible while execution prerequisites are unavailable', () => {
		const catalog = unavailableOperationCatalog('Configure an operator signer')
		expect(catalog.length).toBeGreaterThan(20)
		expect(catalog.every(operation => !operation.eligibility.eligible)).toBeTrue()
		const blocked = blockExecutableEvaluations(catalog, 'Canonical discovery is unavailable')
		expect(blocked.filter(operation => operation.definition.classification === 'selectable').every(operation => operation.eligibility.blockers.includes('Canonical discovery is unavailable'))).toBeTrue()
	})

	test('fails closed when any bounded discovery collection is truncated', () => {
		expect(discoveryCoverageIsComplete([])).toBeTrue()
		expect(discoveryCoverageIsComplete(['Pool discovery truncated at 100 entries'])).toBeFalse()
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
