import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { EndpointCheckFailure, type EndpointCheck } from '../support/bot-shared.ts'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { createChaosShutdownController, type ChaosProcessLocks } from '../../src/core/process-locks.ts'
import { abandonRetryableSelectableFailure, executionProfileId, recordEndpointPreflightChecks, runChaosOperator } from '../../src/runtime/operator.ts'
import { initialDurableState, initialRuntimeState, loadDurableState } from '../../src/state/operator-state.ts'
import { createDurableWorkflow, markWorkflowFailed } from '../../src/runtime/workflows.ts'
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
