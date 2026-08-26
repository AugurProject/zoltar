import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { EndpointCheckFailure, type EndpointCheck } from '../support/bot-shared.ts'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { createChaosShutdownController, type ChaosProcessLocks } from '../../src/core/process-locks.ts'
import { abandonRetryableSelectableFailure, executionProfileId, recordEndpointPreflightChecks, runChaosOperator } from '../../src/runtime/operator.ts'
import { initialDurableState, initialRuntimeState, loadDurableState, recordActivity, saveDurableState } from '../../src/state/operator-state.ts'
import { createDurableWorkflow, markWorkflowFailed } from '../../src/runtime/workflows.ts'
import { beginLifecycleObligation, synchronizeLifecycleObligations } from '../../src/runtime/obligations.ts'
import type { OperationPlan } from '../../src/operations/types.ts'

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
		[{ definitionId: plan.definitionId, ecosystem: plan.ecosystem, metadata: plan.metadata }],
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
})
