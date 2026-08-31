import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { EndpointCheckFailure, privateKeyToAccount, zeroAddress, zeroHash, type Address, type EndpointCheck } from '../support/bot-shared.ts'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { createChaosShutdownController, type ChaosProcessLocks } from '../../src/core/process-locks.ts'
import { OperationRediscoveryRequired } from '../../src/execution/transaction-executor.ts'
import { IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, type CanonicalImmutableTopologyCache } from '../../src/monitoring/topology-cache.ts'
import { eligibleOperationPlans, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import {
	abandonRetryableSelectableFailure,
	backfillWaitMilliseconds,
	blockNovelEvaluations,
	evaluatePolicySafeContinuation,
	executionProfileId,
	actionableUrgentLifecyclePlan,
	lifecycleObstructions,
	operatorWaitMilliseconds,
	recordEndpointPreflightChecks,
	rediscoverableExecutionFailure,
	repairDurableSelectableFailures,
	runChaosOperator,
	runtimeTopologySummary,
	scheduleAfterRecoveredTransaction,
} from '../../src/runtime/operator.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { initialDurableState, initialRuntimeState, loadDurableState, recordActivity, saveDurableState } from '../../src/state/operator-state.ts'
import { randomOperationPlans, urgentOperationPlans } from '../../src/runtime/selection.ts'
import { createDurableWorkflow, markWorkflowFailed, markWorkflowStepConfirmed } from '../../src/runtime/workflows.ts'
import { beginLifecycleObligation, failLifecycleObligation, synchronizeLifecycleObligations } from '../../src/runtime/obligations.ts'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'
import { address, snapshotFixture } from '../operations/fixture.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map(async path => {
			await rm(path, { force: true, recursive: true })
		}),
	)
})

function processLocks(): ChaosProcessLocks {
	return {
		acquireSigner: async () => undefined,
		commitSigner: async () => undefined,
		discardSigner: async () => undefined,
		release: async () => undefined,
	}
}

function topologyCacheWithVaults(pool: Address, vaults: Address[]): CanonicalImmutableTopologyCache {
	return {
		anchor: { blockHash: zeroHash, blockNumber: '77' },
		discoveryCursors: {
			poolDeployments: { canonicalCount: '0', commitment: zeroHash, nextIndex: '0', residentLimit: '100', retentionMode: 'resident' },
			questions: { canonicalCount: '0', commitment: zeroHash, nextIndex: '0', residentLimit: '100', retentionMode: 'resident' },
			vaultsByPool: { [pool.toLowerCase()]: { canonicalCount: vaults.length.toString(), commitment: zeroHash, nextIndex: vaults.length.toString(), residentLimit: '100', retentionMode: 'resident' } },
		},
		pairsByPool: {},
		poolDeployments: [],
		questions: [],
		schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		universeChildren: {},
		vaultsByPool: { [pool.toLowerCase()]: vaults },
	}
}

const FIRST_PRIVATE_KEY = `0x${'11'.repeat(32)}` as const
const SECOND_PRIVATE_KEY = `0x${'22'.repeat(32)}` as const

function restartSettings(stateFile: string, deploymentIdentity: number, privateKey: `0x${string}` | null) {
	return parseSettings({
		...example,
		deployment: {
			...example.deployment,
			zoltar: `0x${deploymentIdentity.toString(16).padStart(40, '0')}`,
		},
		privateKey,
		runtime: {
			...example.runtime,
			once: true,
			stateFile,
			ui: false,
		},
	})
}

function lifecyclePlan(): OperationPlan {
	return {
		classification: 'lifecycle-obligation',
		createdAtBlock: '100',
		definitionId: 'open-oracle.settle',
		ecosystem: 'open-oracle',
		id: 'open-oracle.settle:100:report-7',
		label: 'Settle report 7',
		metadata: { reportId: '7', stateHash: `0x${'33'.repeat(32)}` },
		obligation: true,
		planningSeed: 7,
		postconditions: ['The indexed report is settled'],
		priority: 'urgent',
		risk: 'low',
		steps: [
			{
				data: '0x1234',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '100000',
				id: 'approve',
				label: 'Approve prerequisite',
				preflightCalls: [],
				to: '0x0000000000000000000000000000000000000001',
				walletAssetDebits: [],
			},
			{
				data: '0x5678',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '500000',
				id: 'settle',
				label: 'Settle report',
				preflightCalls: [],
				to: '0x0000000000000000000000000000000000000002',
				walletAssetDebits: [],
			},
		],
	}
}

function evaluatedOperation(plan: OperationPlan): EvaluatedOperation {
	return {
		definition: {
			classification: plan.classification,
			contract: 'OpenOracle',
			description: 'test operation',
			discoveryInputs: [],
			ecosystem: plan.ecosystem,
			id: plan.definitionId,
			label: plan.label,
			method: 'test',
			risk: plan.risk,
		},
		eligibility: { blockers: [], eligible: true },
		plan,
	}
}

function completedSelectableWorkflow(operationId: string, startedAt: string, completedAt: string) {
	const workflow = createDurableWorkflow({
		...lifecyclePlan(),
		classification: 'selectable',
		definitionId: operationId,
		ecosystem: 'trading',
		id: `${operationId}:100:restart-fixture`,
		obligation: false,
		priority: 'random',
	})
	workflow.createdAt = startedAt
	workflow.startedAt = startedAt
	workflow.completedAt = completedAt
	workflow.updatedAt = completedAt
	workflow.status = 'completed'
	for (const step of workflow.steps) {
		step.confirmedAt = completedAt
		step.startedAt = startedAt
		step.status = 'confirmed'
	}
	return workflow
}

function runtimeWithPartialLifecycleHistory(profileId: string, signerAddress: ReturnType<typeof privateKeyToAccount>['address']) {
	const state = initialRuntimeState(true, signerAddress, 11155111, initialDurableState(11155111, true, profileId, signerAddress))
	const plan = lifecyclePlan()
	synchronizeLifecycleObligations(
		state,
		[
			{
				definition: {
					classification: plan.classification,
					contract: 'OpenOracle',
					description: 'Settles one indexed OpenOracle report after its dispute window closes.',
					discoveryInputs: ['indexed report preimage'],
					ecosystem: plan.ecosystem,
					id: plan.definitionId,
					label: plan.label,
					method: 'settle',
					risk: plan.risk,
				},
				eligibility: { blockers: [], eligible: true },
				plan,
			},
		],
		[{ blocksNovelty: true, definitionId: plan.definitionId, ecosystem: plan.ecosystem, metadata: plan.metadata }],
		true,
		100n,
		2_000_000_000n,
	)
	const workflow = state.workflows[0]
	const obligation = state.obligations[0]
	if (workflow === undefined || obligation === undefined) throw new Error('Lifecycle restart fixture was not created')
	const firstStep = workflow.steps[0]
	if (firstStep === undefined) throw new Error('Lifecycle restart fixture has no prerequisite step')
	firstStep.status = 'confirmed'
	firstStep.confirmedAt = '2026-08-25T00:00:00.000Z'
	workflow.status = 'waiting-continuation'
	workflow.updatedAt = '2026-08-25T00:00:00.000Z'
	beginLifecycleObligation(obligation)
	recordActivity(state, {
		at: '2026-08-25T00:00:00.000Z',
		message: 'Lifecycle prerequisite confirmed before restart',
		status: 'confirmed',
		type: 'recovery',
	})
	return state
}

describe('chaos operator runtime', () => {
	test('blocks every novel selectable plan while preserving urgent lifecycle execution', () => {
		const urgentPlan = lifecyclePlan()
		const selectablePlan: OperationPlan = {
			...urgentPlan,
			classification: 'selectable',
			definitionId: 'open-oracle.deposit',
			id: 'open-oracle.deposit:100:test',
			obligation: false,
			priority: 'random',
		}
		const blocked = blockNovelEvaluations([evaluatedOperation(selectablePlan), evaluatedOperation(urgentPlan)], {
			count: 1,
			digest: `0x${'45'.repeat(32)}`,
			firstDefinitionId: 'statoblast.escalation.resume',
			firstEcosystem: 'statoblast',
			observedAtBlock: '100',
			presenceComplete: true,
			reason: 'unplanned-due-identity',
		})

		expect(randomOperationPlans(blocked)).toEqual([])
		expect(urgentOperationPlans(blocked)).toEqual([urgentPlan])
		expect(blocked[0]?.eligibility.blockers[0]).toContain('random novelty remains blocked')
	})

	test('runs independent urgent lifecycle work while a finalized failure awaits bounded retry', () => {
		const retryPlan = lifecyclePlan()
		const urgentPlan: OperationPlan = {
			...lifecyclePlan(),
			id: 'open-oracle.settle:101:report-8',
			label: 'Settle report 8',
			metadata: { reportId: '8', stateHash: `0x${'44'.repeat(32)}` },
		}
		const evaluations = [evaluatedOperation(retryPlan), evaluatedOperation(urgentPlan)]
		const presence = evaluations.map(evaluation => {
			const plan = evaluation.plan
			if (plan === undefined) throw new Error('Lifecycle fixture requires an operation plan')
			return { blocksNovelty: true, definitionId: plan.definitionId, ecosystem: plan.ecosystem, metadata: plan.metadata }
		})
		const state = initialRuntimeState(false, address(1), 31_337)
		state.evaluations = evaluations
		synchronizeLifecycleObligations(state, evaluations, presence, true, 100n, 1_000n)
		const retryObligation = state.obligations.find(obligation => obligation.metadata['reportId'] === '7')
		const retryWorkflow = state.workflows.find(workflow => workflow.id === retryObligation?.workflowId)
		if (retryObligation === undefined || retryWorkflow === undefined) throw new Error('Missing retry lifecycle fixture')

		beginLifecycleObligation(retryObligation)
		beginLifecycleObligation(retryObligation)
		beginLifecycleObligation(retryObligation)
		markWorkflowFailed(retryWorkflow, 'approve', 'transaction reverted', 'receipt-reverted')
		failLifecycleObligation(retryObligation, 'transaction reverted', false)
		synchronizeLifecycleObligations(state, evaluations, presence, true, 101n, 1_000n)

		expect(lifecycleObstructions(state)).toMatchObject({
			automaticRetry: { attemptCount: 3, automaticRetryCount: 1, id: retryObligation.id, status: 'deferred' },
			hard: undefined,
		})
		expect(actionableUrgentLifecyclePlan(state)).toMatchObject({ metadata: { reportId: '8' } })
	})

	test('bounds sustained backfill cadence by the configured lifecycle poll interval', () => {
		expect(backfillWaitMilliseconds(1_000, 0)).toBe(1_000)
		expect(backfillWaitMilliseconds(12_000, 0)).toBe(5_000)
		expect(backfillWaitMilliseconds(12_000, 15)).toBe(5_000)
		expect(backfillWaitMilliseconds(12_000, 16)).toBe(10_000)
		expect(backfillWaitMilliseconds(12_000, 32)).toBe(12_000)
		expect(backfillWaitMilliseconds(60_000, 64)).toBe(60_000)
		expect(() => backfillWaitMilliseconds(999, 0)).toThrow('1000 through 60000')
		expect(() => backfillWaitMilliseconds(12_000, -1)).toThrow('non-negative')
	})

	test('wakes at the persisted scheduler deadline without shortening paused polling', () => {
		const now = Date.parse('2026-08-30T00:00:00.000Z')
		const state = initialRuntimeState(false, address(1), 31_337)
		state.scheduler = {
			lastDelaySeconds: 3_600,
			lastRunAt: new Date(now - 3_570_000).toISOString(),
			nextRunAt: new Date(now + 30_000).toISOString(),
			selectedOperationId: undefined,
			status: 'scheduled',
		}

		expect(operatorWaitMilliseconds(60_000, state, now)).toBe(30_000)
		expect(operatorWaitMilliseconds(10_000, state, now)).toBe(10_000)
		state.scheduler.nextRunAt = new Date(now).toISOString()
		expect(operatorWaitMilliseconds(60_000, state, now)).toBe(1)
		state.paused = true
		expect(operatorWaitMilliseconds(60_000, state, now)).toBe(60_000)
		expect(() => operatorWaitMilliseconds(0, state, now)).toThrow('positive integer')
	})

	test('publishes only a sanitized completeness-aware canonical topology summary', () => {
		const snapshot = snapshotFixture()
		const firstPool = snapshot.pools[0]
		if (firstPool === undefined) throw new Error('Topology fixture requires one pool')
		const firstVault = firstPool.vaults[0]
		if (firstVault === undefined) throw new Error('Topology fixture requires one vault')
		const summary = runtimeTopologySummary({
			anchor: { baseFeePerGas: 1n, blockHash: zeroHash, blockNumber: 77n, timestamp: 1n },
			canonicalLifecyclePresenceComplete: true,
			carryProofJournalComplete: true,
			indexComplete: false,
			snapshot,
			topologyCache: topologyCacheWithVaults(firstPool.address, [firstVault.address]),
		})
		expect(summary.anchor).toEqual({ blockNumber: 77n, timestamp: 1n })
		expect(summary.complete).toBeFalse()
		expect(summary.universes).toHaveLength(snapshot.universes.length)
		expect(summary.pools[0]).toEqual({
			address: firstPool.address,
			awaitingForkContinuation: firstPool.awaitingForkContinuation,
			coordinator: firstPool.coordinator,
			questionId: firstPool.questionId,
			systemState: firstPool.systemState,
			universeId: firstPool.universeId,
			vaultCount: firstPool.vaults.length,
		})
		expect(summary.reports).toHaveLength(snapshot.reports.length)
		expect(summary.auctions).toHaveLength(snapshot.auctions.length)
		expect(summary.pairs).toHaveLength(snapshot.pairs.length)
	})

	test('publishes the canonical registry total when only the wallet vault was inspected', () => {
		const snapshot = snapshotFixture()
		const firstPool = snapshot.pools[0]
		if (firstPool === undefined) throw new Error('Topology fixture requires one pool')
		const walletVault = firstPool.vaults[0]
		if (walletVault === undefined) throw new Error('Topology fixture requires one wallet vault')
		firstPool.vaultDiscoveryComplete = false
		firstPool.vaults = [walletVault]
		const registeredVaults = [walletVault.address, address(91), address(92)]

		const summary = runtimeTopologySummary({
			anchor: { baseFeePerGas: 1n, blockHash: zeroHash, blockNumber: 77n, timestamp: 1n },
			canonicalLifecyclePresenceComplete: true,
			carryProofJournalComplete: true,
			indexComplete: true,
			snapshot,
			topologyCache: topologyCacheWithVaults(firstPool.address, registeredVaults),
		})

		expect(firstPool.vaultDiscoveryComplete).toBeFalse()
		expect(firstPool.vaults).toHaveLength(1)
		expect(summary.complete).toBeTrue()
		expect(summary.pools[0]?.vaultCount).toBe(registeredVaults.length)
		expect(Object.keys(summary.pools[0] ?? {}).sort()).toEqual(['address', 'awaitingForkContinuation', 'coordinator', 'questionId', 'systemState', 'universeId', 'vaultCount'])
	})

	test('replaces stale healthy preflight checks on failure and recovery', async () => {
		const healthyChecks: readonly EndpointCheck[] = [{ chainId: 1, checkedAt: '2026-08-24T00:00:00.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://read-one.example' }]
		const failedChecks: readonly EndpointCheck[] = [{ chainId: undefined, checkedAt: '2026-08-24T00:01:00.000Z', error: 'unavailable', kind: 'read-rpc', status: 'failed', target: 'https://read-one.example' }]
		const recoveredChecks: readonly EndpointCheck[] = [{ chainId: 1, checkedAt: '2026-08-24T00:02:00.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://read-one.example' }]
		let storedChecks: readonly EndpointCheck[] = healthyChecks

		await expect(
			recordEndpointPreflightChecks(
				async () => {
					throw new EndpointCheckFailure('read quorum unavailable', failedChecks)
				},
				checks => {
					storedChecks = checks
				},
			),
		).rejects.toBeInstanceOf(EndpointCheckFailure)
		expect(storedChecks).toEqual(failedChecks)

		await recordEndpointPreflightChecks(
			async () => recoveredChecks,
			checks => {
				storedChecks = checks
			},
		)
		expect(storedChecks).toEqual(recoveredChecks)
	})

	test('isolates durable state by deployment without coupling it to key persistence or index tuning', () => {
		const base = parseSettings(example)
		const serialized = serializedSettings(base)
		const withSigner = parseSettings({
			...serialized,
			privateKey: `0x${'11'.repeat(32)}`,
		})
		const withDeployment = parseSettings({
			...serialized,
			deployment: {
				...serialized.deployment,
				zoltar: '0x0000000000000000000000000000000000000001',
			},
		})
		const withProtocolOrigin = parseSettings({
			...serialized,
			runtime: { ...serialized.runtime, protocolStartBlock: '1' },
		})

		expect(executionProfileId(base)).toBe(executionProfileId(withSigner))
		expect(executionProfileId(base)).not.toBe(executionProfileId(withDeployment))
		expect(executionProfileId(base)).toBe(executionProfileId(withProtocolOrigin))
	})

	test('starts safely in an unconfigured one-shot profile and persists owner state', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = parseSettings({
			...example,
			runtime: {
				...example.runtime,
				once: true,
				stateFile,
				ui: false,
			},
		})
		using shutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings }, processLocks(), shutdown)
		const durable = await loadDurableState(stateFile, settings.network.chainId)
		expect(durable.scheduler.status).toBe('paused')
		expect(durable.pendingTransactions).toHaveLength(0)
		expect(durable.protocolIndex).toBeUndefined()
		expect(durable.profileId).toBe(executionProfileId(settings))
	})

	test('invalidates a keyless protocol index when startup first binds the configured signer', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-keyless-index-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const durable = initialDurableState(settings.network.chainId, true, executionProfileId(settings))
		durable.protocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: settings.network.chainId,
			childRepSplits: [],
			cursor: { blockHash: zeroHash, blockNumber: settings.runtime.protocolStartBlock.toString() },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: settings.deployment.openOracle,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: settings.deployment.securityPoolForker,
			startBlock: settings.runtime.protocolStartBlock.toString(),
			wallet: zeroAddress,
			zoltar: settings.deployment.zoltar,
		}
		await saveDurableState(stateFile, durable)

		using shutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings }, processLocks(), shutdown)

		const rebound = await loadDurableState(stateFile, settings.network.chainId)
		expect(rebound.signerAddress).toBe(privateKeyToAccount(FIRST_PRIVATE_KEY).address)
		expect(rebound.protocolIndex).toBeUndefined()
		expect(rebound.activities[0]?.message).toContain('keyless wallet index invalidated')
	})

	test('closes a recovered paused schedule with a fresh random wait before resume', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-recovered-schedule-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const signer = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		const state = initialRuntimeState(true, signer, settings.network.chainId, initialDurableState(settings.network.chainId, true, executionProfileId(settings), signer))
		state.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: '2026-08-25T00:00:00.000Z',
			nextRunAt: '2026-08-25T00:01:00.000Z',
			selectedOperationId: 'trading.swap',
			status: 'paused',
		}
		const before = Date.now()
		const completed = await scheduleAfterRecoveredTransaction(
			{
				path: join(directory, 'operator.json'),
				rememberSigner: true,
				revision: 'revision',
				settings,
			},
			state,
			'trading.swap',
		)

		expect(completed).toBeTrue()
		expect(state.scheduler.status).toBe('paused')
		expect(Date.parse(state.scheduler.nextRunAt ?? '')).toBeGreaterThanOrEqual(before + settings.scheduler.minimumDelaySeconds * 1_000)
		expect(state.scheduler.lastRunAt).not.toBe('2026-08-25T00:00:00.000Z')
		const durable = await loadDurableState(stateFile, settings.network.chainId)
		expect(durable.scheduler).toEqual(state.scheduler)
	})

	test('closes a recovered schedule after resume marked the original run due', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-resumed-recovery-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const signer = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		const state = initialRuntimeState(false, signer, settings.network.chainId, initialDurableState(settings.network.chainId, false, executionProfileId(settings), signer))
		state.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: '2026-08-25T00:00:00.000Z',
			nextRunAt: '2026-08-25T00:01:00.000Z',
			selectedOperationId: 'trading.swap',
			status: 'due',
		}
		const before = Date.now()

		const completed = await scheduleAfterRecoveredTransaction(
			{
				path: join(directory, 'operator.json'),
				rememberSigner: true,
				revision: 'revision',
				settings,
			},
			state,
			'trading.swap',
		)

		expect(completed).toBeTrue()
		expect(Date.parse(state.scheduler.nextRunAt ?? '')).toBeGreaterThanOrEqual(before + settings.scheduler.minimumDelaySeconds * 1_000)
		expect(state.scheduler.lastDelaySeconds).not.toBe(60)
		expect((await loadDurableState(stateFile, settings.network.chainId)).scheduler).toEqual(state.scheduler)
	})

	test('closes an interrupted paused transaction run during production startup', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-paused-recovery-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const pausedSettings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const settings = parseSettings(
			{
				...serializedSettings(pausedSettings),
				connectivity: {
					publicRpcUrls: ['https://submit.example'],
					quorumRpcUrls: ['https://read-two.example', 'https://read-three.example'],
					readRpcUrl: 'https://read-one.example',
					rpcQuorum: 2,
				},
				networkConfigured: true,
				paused: false,
			},
			pausedSettings.privateKey,
		)
		const signer = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		const durable = initialDurableState(settings.network.chainId, true, executionProfileId(settings), signer)
		durable.safetyPaused = true
		durable.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: '2026-08-25T00:00:00.000Z',
			nextRunAt: '2026-08-25T00:01:00.000Z',
			selectedOperationId: 'trading.swap',
			status: 'paused',
		}
		durable.workflows = [completedSelectableWorkflow('trading.swap', '2026-08-25T00:01:00.000Z', '2026-08-25T00:02:00.000Z')]
		await saveDurableState(stateFile, durable)

		const before = Date.now()
		using shutdown = createChaosShutdownController()
		shutdown.requestShutdown()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings }, processLocks(), shutdown)

		const recovered = await loadDurableState(stateFile, settings.network.chainId)
		expect(recovered.scheduler.status).toBe('paused')
		expect(Date.parse(recovered.scheduler.lastRunAt ?? '')).toBeGreaterThanOrEqual(before)
		expect(Date.parse(recovered.scheduler.nextRunAt ?? '')).toBeGreaterThanOrEqual(before + settings.scheduler.minimumDelaySeconds * 1_000)
		expect(recovered.activities[0]?.message).toBe('Interrupted scheduler run was closed with a fresh randomized wait before any new operation')
	})

	test('preserves an ordinary paused countdown during production startup', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-paused-countdown-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const signer = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		const durable = initialDurableState(settings.network.chainId, true, executionProfileId(settings), signer)
		durable.scheduler = {
			lastDelaySeconds: 3_600,
			lastRunAt: '2026-08-25T00:02:01.000Z',
			nextRunAt: '2099-08-25T01:02:01.000Z',
			selectedOperationId: 'trading.swap',
			status: 'paused',
		}
		durable.workflows = [completedSelectableWorkflow('trading.swap', '2026-08-25T00:01:00.000Z', '2026-08-25T00:02:00.000Z')]
		const expectedScheduler = { ...durable.scheduler }
		await saveDurableState(stateFile, durable)

		using shutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings }, processLocks(), shutdown)

		const restarted = await loadDurableState(stateFile, settings.network.chainId)
		expect(restarted.scheduler).toEqual(expectedScheduler)
		expect(restarted.activities).toEqual([])
	})

	test('moves a stopped safe bootstrap to a fresh state path when deployment identity changes', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-bootstrap-')
		temporaryDirectories.push(directory)
		const bootstrapStateFile = join(directory, 'bootstrap-state.json')
		const configuredStateFile = join(directory, 'configured-state.json')
		const bootstrapSettings = restartSettings(bootstrapStateFile, 0, null)

		using bootstrapShutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'bootstrap-revision', settings: bootstrapSettings }, processLocks(), bootstrapShutdown)
		const bootstrapBefore = await readFile(bootstrapStateFile)
		const changedAtOldPath = restartSettings(bootstrapStateFile, 1, null)
		using rejectedShutdown = createChaosShutdownController()
		await expect(runChaosOperator({ path: join(directory, 'operator.json'), revision: 'changed-revision', settings: changedAtOldPath }, processLocks(), rejectedShutdown)).rejects.toThrow('configure a distinct state file for the new deployment profile')
		expect((await readFile(bootstrapStateFile)).equals(bootstrapBefore)).toBeTrue()

		const changedAtFreshPath = restartSettings(configuredStateFile, 1, null)
		using configuredShutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'configured-revision', settings: changedAtFreshPath }, processLocks(), configuredShutdown)
		const configured = await loadDurableState(configuredStateFile, changedAtFreshPath.network.chainId)
		expect(configured.profileId).toBe(executionProfileId(changedAtFreshPath))
		expect(configured.signerAddress).toBeUndefined()
		expect(configured.activities[0]?.message).toBe('Durable runtime initialized for the configured deployment profile')
	})

	test('rejects a changed signer before a deployment reset and leaves partial lifecycle state byte-for-byte unchanged', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-restart-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const previousSettings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const previousSigner = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		const state = runtimeWithPartialLifecycleHistory(executionProfileId(previousSettings), previousSigner)
		await saveDurableState(stateFile, state)
		const before = await readFile(stateFile)
		const changedSettings = restartSettings(stateFile, 2, SECOND_PRIVATE_KEY)

		using shutdown = createChaosShutdownController()
		await expect(runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings: changedSettings }, processLocks(), shutdown)).rejects.toThrow(`Durable state ${stateFile} is scoped to signer ${previousSigner}`)

		const after = await readFile(stateFile)
		expect(after.equals(before)).toBeTrue()
		const durable = await loadDurableState(stateFile, changedSettings.network.chainId)
		expect(durable.profileId).toBe(executionProfileId(previousSettings))
		expect(durable.signerAddress).toBe(previousSigner)
		expect(durable.workflows[0]?.status).toBe('waiting-continuation')
		expect(durable.obligations[0]?.status).toBe('executing')
		expect(durable.activities[0]?.type).toBe('recovery')
	})

	test('rejects deployment-profile reuse with durable history even when the signer is unchanged', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-profile-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const previousSettings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const signer = privateKeyToAccount(FIRST_PRIVATE_KEY).address
		await saveDurableState(stateFile, runtimeWithPartialLifecycleHistory(executionProfileId(previousSettings), signer))
		const before = await readFile(stateFile)
		const changedSettings = restartSettings(stateFile, 2, FIRST_PRIVATE_KEY)

		using shutdown = createChaosShutdownController()
		await expect(runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings: changedSettings }, processLocks(), shutdown)).rejects.toThrow('configure a distinct state file for the new deployment profile')

		expect((await readFile(stateFile)).equals(before)).toBeTrue()
	})

	test('allows an automatic deployment-profile reset for a pristine unsigned bootstrap state', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-operator-pristine-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const previousSettings = restartSettings(stateFile, 1, null)
		await saveDurableState(stateFile, initialDurableState(previousSettings.network.chainId, true, executionProfileId(previousSettings)))
		const changedSettings = restartSettings(stateFile, 2, null)

		using shutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'operator.json'), revision: 'test-revision', settings: changedSettings }, processLocks(), shutdown)

		const durable = await loadDurableState(stateFile, changedSettings.network.chainId)
		expect(durable.profileId).toBe(executionProfileId(changedSettings))
		expect(durable.signerAddress).toBeUndefined()
		expect(durable.workflows).toEqual([])
		expect(durable.obligations).toEqual([])
		expect(durable.activities[0]?.message).toBe('Durable runtime initialized for the configured deployment profile')
	})

	test('closes a finalized selectable revert as an audited attempt without a global stop', () => {
		const plan: OperationPlan = {
			classification: 'selectable',
			createdAtBlock: '10',
			definitionId: 'zoltar.deploy-child',
			ecosystem: 'zoltar',
			id: 'zoltar.deploy-child:10:deploy',
			label: 'Deploy child universe',
			metadata: { outcome: '1', universeId: '7' },
			obligation: false,
			planningSeed: 1,
			postconditions: [],
			priority: 'random',
			risk: 'irreversible',
			steps: [
				{
					data: '0x1234',
					evidence: [{ kind: 'receipt-success' }],
					gasLimit: '100000',
					id: 'deploy',
					label: 'Deploy child',
					preflightCalls: [],
					to: '0x0000000000000000000000000000000000000001',
					walletAssetDebits: [],
				},
			],
		}
		const workflow = createDurableWorkflow(plan)
		markWorkflowFailed(workflow, 'deploy', 'transaction reverted', 'receipt-reverted')
		const configured = parseSettings(example)
		const state = initialRuntimeState(false, undefined, configured.network.chainId, initialDurableState(configured.network.chainId, false))
		state.workflows = [workflow]

		expect(abandonRetryableSelectableFailure(state, plan)).toBeTrue()
		expect(workflow.status).toBe('abandoned')
		expect(workflow.steps[0]).toMatchObject({
			failureKind: 'receipt-reverted',
			status: 'failed',
		})
		expect(state.safetyPaused).toBeFalse()
		expect(state.activities[0]?.message).toContain('fresh canonical discovery')
	})

	test('retains confirmed preparation steps for canonical cleanup after a terminal revert', () => {
		const preparedPlan: OperationPlan = {
			classification: 'selectable',
			createdAtBlock: '10',
			definitionId: 'statoblast.oracle.request-price',
			ecosystem: 'statoblast',
			id: 'statoblast.oracle.request-price:10:prepared',
			label: 'Request oracle price',
			metadata: { coordinator: address(2), pool: address(3) },
			obligation: false,
			planningSeed: 1,
			postconditions: [],
			priority: 'random',
			risk: 'medium',
			steps: [
				{
					data: '0x1234',
					evidence: [{ kind: 'receipt-success' }],
					gasLimit: '100000',
					id: 'approve-weth',
					label: 'Approve WETH',
					preflightCalls: [],
					to: address(4),
					walletAssetDebits: [],
				},
				{
					data: '0x5678',
					evidence: [{ kind: 'receipt-success' }],
					gasLimit: '100000',
					id: 'request-price',
					label: 'Request price',
					preflightCalls: [],
					to: address(2),
					walletAssetDebits: [],
				},
			],
		}
		const workflow = createDurableWorkflow(preparedPlan)
		markWorkflowStepConfirmed(workflow, 'approve-weth', zeroHash)
		markWorkflowFailed(workflow, 'request-price', 'transaction reverted', 'receipt-reverted')
		const configured = parseSettings(example)
		const state = initialRuntimeState(false, undefined, configured.network.chainId, initialDurableState(configured.network.chainId, false))
		state.workflows = [workflow]

		expect(abandonRetryableSelectableFailure(state, preparedPlan)).toBeTrue()
		expect(workflow.status).toBe('waiting-continuation')
		expect(workflow.continuationDisposition).toBe('cleanup-only')
		expect(workflow.steps[0]?.status).toBe('confirmed')
		expect(workflow.steps[1]).toMatchObject({ failureKind: 'receipt-reverted', status: 'blocked' })
		expect(state.activities[0]?.message).toContain('cleanup')
	})

	test('persists a policy-safe cleanup fallback when the action continuation cannot fund its aggregate envelope', async () => {
		const directory = await mkdtemp('/tmp/zoltar-chaos-cleanup-fallback-')
		temporaryDirectories.push(directory)
		const stateFile = join(directory, 'state.json')
		const settings = restartSettings(stateFile, 1, FIRST_PRIVATE_KEY)
		const snapshot = snapshotFixture()
		const original = eligibleOperationPlans(snapshot, planningOptions(settings, 17)).find(plan => plan.definitionId === 'open-oracle.deposit')
		if (original === undefined) throw new Error('Cleanup fallback fixture requires an OpenOracle deposit')
		const approval = original.steps.find(step => step.id.startsWith('approve-'))
		if (approval === undefined) throw new Error('Cleanup fallback fixture requires an approval step')
		const amount = original.metadata['amount']
		const tokenAddress = original.metadata['token']
		if (typeof amount !== 'string' || typeof tokenAddress !== 'string') throw new Error('Cleanup fallback fixture has invalid deposit metadata')
		const token = snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === tokenAddress.toLowerCase())
		if (token === undefined) throw new Error('Cleanup fallback fixture is missing token inventory')
		token.allowances[snapshot.deployments.openOracle] = amount
		snapshot.wallet.ethBalanceAttoEth = (settings.strategy.minimumEthReserveAttoEth + settings.strategy.maximumGasCostAttoEth + settings.strategy.maximumGasCostAttoEth / 2n).toString()
		const markedPlan = { ...original, continuationDisposition: 'cleanup-only' as const }
		expect(() => createDurableWorkflow(markedPlan)).toThrow('without confirmed preparation')
		const directRestartEvaluation = reevaluateOperationContinuation(snapshot, markedPlan, planningOptions(settings, original.planningSeed), { confirmedStepIds: [approval.id] })
		expect(directRestartEvaluation.plan?.continuationDisposition).toBe('cleanup-only')
		expect(directRestartEvaluation.plan?.steps[0]?.id).toStartWith('revoke-')

		const workflow = createDurableWorkflow(original)
		markWorkflowStepConfirmed(workflow, approval.id, zeroHash)
		const state = initialRuntimeState(true, snapshot.wallet.address, settings.network.chainId, initialDurableState(settings.network.chainId, true, executionProfileId(settings), snapshot.wallet.address))
		state.workflows = [workflow]

		const selection = evaluatePolicySafeContinuation(snapshot, workflow, settings, snapshot.anchor.blockNumber)

		expect(selection.continuationDisposition).toBe('cleanup-only')
		expect(selection.evaluation.eligibility).toEqual({ blockers: [], eligible: true })
		expect(selection.evaluation.plan?.continuationDisposition).toBe('cleanup-only')
		expect(selection.evaluation.plan?.steps).toHaveLength(1)
		expect(selection.evaluation.plan?.steps[0]?.id).toStartWith('revoke-')
		workflow.continuationDisposition = selection.continuationDisposition
		await saveDurableState(stateFile, state)
		expect((await loadDurableState(stateFile, settings.network.chainId)).workflows[0]?.continuationDisposition).toBe('cleanup-only')
	})

	test('latches cleanup-only after unsigned rediscovery of a partially confirmed selectable workflow', () => {
		const settings = parseSettings(example)
		const snapshot = snapshotFixture()
		const original = eligibleOperationPlans(snapshot, planningOptions(settings, 29)).find(plan => plan.definitionId === 'open-oracle.deposit')
		if (original === undefined) throw new Error('Rediscovery fixture requires an OpenOracle deposit')
		const approval = original.steps.find(step => step.id.startsWith('approve-'))
		if (approval === undefined) throw new Error('Rediscovery fixture requires an approval step')
		const workflow = createDurableWorkflow(original)
		markWorkflowStepConfirmed(workflow, approval.id, zeroHash)
		const state = initialRuntimeState(false, snapshot.wallet.address, settings.network.chainId, initialDurableState(settings.network.chainId, false))
		state.workflows = [workflow]

		expect(rediscoverableExecutionFailure(state, original, new OperationRediscoveryRequired('fresh balance no longer funds the action'))).toBeTrue()
		expect(workflow.status).toBe('waiting-continuation')
		expect(workflow.continuationDisposition).toBe('cleanup-only')
	})

	test('repairs a durable finalized failure independently of scheduled scheduler state', () => {
		const preparedPlan: OperationPlan = {
			...lifecyclePlan(),
			classification: 'selectable',
			definitionId: 'statoblast.oracle.request-price',
			ecosystem: 'statoblast',
			id: 'statoblast.oracle.request-price:100:restart-repair',
			obligation: false,
			priority: 'random',
		}
		const workflow = createDurableWorkflow(preparedPlan)
		markWorkflowStepConfirmed(workflow, 'approve', zeroHash)
		markWorkflowFailed(workflow, 'settle', 'verified nonce cancellation', 'nonce-cancelled')
		const configured = parseSettings(example)
		const state = initialRuntimeState(false, undefined, configured.network.chainId, initialDurableState(configured.network.chainId, false))
		state.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: new Date(0).toISOString(),
			nextRunAt: new Date(Date.now() + 60_000).toISOString(),
			selectedOperationId: preparedPlan.definitionId,
			status: 'scheduled',
		}
		const priorAttempt = createDurableWorkflow(preparedPlan)
		markWorkflowFailed(priorAttempt, 'approve', 'earlier finalized revert', 'receipt-reverted')
		priorAttempt.status = 'abandoned'
		state.workflows = [priorAttempt, workflow]

		const repair = repairDurableSelectableFailures(state)

		expect(repair.repairedWorkflowIds).toEqual([workflow.id])
		expect(repair.requiresSafetyStop).toBeFalse()
		expect(workflow.status).toBe('waiting-continuation')
		expect(workflow.continuationDisposition).toBe('cleanup-only')
		expect(workflow.steps[1]).toMatchObject({ failureKind: 'nonce-cancelled', status: 'blocked' })
		expect(state.scheduler.status).toBe('scheduled')
		expect(repairDurableSelectableFailures(state).repairedWorkflowIds).toEqual([])
	})

	test('latches a restart-safe safety stop for a durable semantic failure', () => {
		const preparedPlan: OperationPlan = {
			...lifecyclePlan(),
			classification: 'selectable',
			definitionId: 'statoblast.oracle.request-price',
			ecosystem: 'statoblast',
			id: 'statoblast.oracle.request-price:100:semantic-repair',
			obligation: false,
			priority: 'random',
		}
		const workflow = createDurableWorkflow(preparedPlan)
		markWorkflowStepConfirmed(workflow, 'approve', zeroHash)
		markWorkflowFailed(workflow, 'settle', 'allowance evidence mismatch', 'semantic-failure')
		const configured = parseSettings(example)
		const state = initialRuntimeState(false, undefined, configured.network.chainId, initialDurableState(configured.network.chainId, false))
		state.scheduler.status = 'running'
		state.scheduler.selectedOperationId = preparedPlan.definitionId
		state.scheduler.nextRunAt = new Date(0).toISOString()
		state.workflows = [workflow]

		const repair = repairDurableSelectableFailures(state)

		expect(repair.requiresSafetyStop).toBeTrue()
		expect(repair.repairedWorkflowIds).toEqual([])
		expect(state.safetyPaused).toBeTrue()
		expect(state.paused).toBeTrue()
		expect(state.scheduler).toMatchObject({ status: 'paused' })
		expect(workflow.status).toBe('failed')
		const activityCount = state.activities.length
		expect(repairDurableSelectableFailures(state).requiresSafetyStop).toBeTrue()
		expect(state.activities).toHaveLength(activityCount)
	})
})
