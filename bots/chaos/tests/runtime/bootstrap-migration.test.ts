import { migrateEmptyBootstrapState } from '../../src/state/bootstrap-migration.ts'
import { runChaosDoctor } from '../../src/cli/doctor.ts'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { zeroAddress, zeroHash } from '@zoltar/bot-shared/ethereum'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import { createChaosShutdownController } from '../../src/core/process-locks.ts'
import { executionProfileId } from '../../src/config/execution-profile.ts'
import { runChaosOperator } from '../../src/runtime/operator.ts'
import { loadDurableState, saveDurableState } from '../../src/state/operator-state.ts'
import { initialDurableState } from '../../src/state/initial-state.ts'

function obsoleteSettings() {
	const settings = parseSettings(example)
	for (const key of Object.keys(settings.deployment)) Reflect.set(settings.deployment, key, zeroAddress)
	return settings
}

test('restarts an empty bootstrap that recorded the previous zero-address deployment error', async () => {
	const directory = await mkdtemp('/tmp/chaos-bootstrap-migration-')
	try {
		const stateFile = join(directory, 'state.json')
		const old = initialDurableState(11155111, true, executionProfileId(obsoleteSettings()))
		expect(old.profileId).toBe('profile:v1:5cdcef7d8af58831a1093e7b976163b2af8a3fc02e201ede57a9f93514075115')
		old.signerAddress = '0x1111111111111111111111111111111111111111'
		old.safetyPaused = true
		old.activities.push({ at: new Date().toISOString(), message: `Operator cycle stopped safely: No contract code on RPC chain 11155111 at block 100: zoltar (${zeroAddress}). Verify the selected network, RPC synchronization, and deployment addresses before retrying.`, status: 'failed', type: 'error' })
		await saveDurableState(stateFile, old)
		const settings = parseSettings({ ...example, runtime: { ...example.runtime, once: true, ui: false, stateFile } })
		using shutdown = createChaosShutdownController()
		await runChaosOperator({ path: join(directory, 'settings.json'), revision: 'fixture', settings }, { acquireSigner: async () => undefined, commitSigner: async () => undefined, discardSigner: async () => undefined, release: async () => undefined }, shutdown)
		const migrated = await loadDurableState(stateFile, 11155111)
		expect(migrated.profileId).toBe(executionProfileId(settings))
		expect(migrated.activities).toEqual(old.activities)
		expect(migrated.signerAddress).toBe(old.signerAddress)
		expect(migrated.safetyPaused).toBeFalse()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('preserves unrelated safety failures and refuses state with transaction or execution history', () => {
	const settings = parseSettings(example)
	const old = () => initialDurableState(11155111, true, executionProfileId(obsoleteSettings()))
	const failed = old()
	failed.safetyPaused = true
	failed.activities.push({ at: new Date().toISOString(), message: 'RPC chain mismatch', type: 'error', status: 'failed' })
	const migrated = migrateEmptyBootstrapState(failed, settings)
	expect(migrated.profileId).toBe(executionProfileId(settings))
	expect(migrated.safetyPaused).toBeTrue()
	expect(migrated.activities).toBe(failed.activities)
	const pending = old()
	pending.pendingTransactions.push({
		data: '0x',
		hash: zeroHash,
		id: 'pending',
		label: 'Pending',
		maxBlockNumber: 1n,
		mode: 'public',
		nonce: 0n,
		operationId: 'test',
		semanticExpectation: { balanceBaselines: [], evidence: [], postconditions: [], storageBaselines: [] },
		sender: zeroAddress,
		serializedTransaction: '0x',
		signedAt: new Date().toISOString(),
		status: 'signed',
		stepId: 'step',
		to: zeroAddress,
		value: 0n,
		workflowId: 'workflow',
	})
	const attempted = old()
	attempted.scheduler.lastRunAt = new Date().toISOString()
	const audited = old()
	audited.activities.push({ at: new Date().toISOString(), message: 'Operation planned', type: 'operation', status: 'dry-run' })
	const finalized = old()
	finalized.obligationTombstones.push({ id: 'old', resolution: 'completed', resolvedAt: new Date().toISOString(), resolvedAtBlock: '1' })
	for (const state of [pending, attempted, audited, finalized, initialDurableState(11155111, true, 'another-profile')]) expect(migrateEmptyBootstrapState(state, settings)).toBe(state)
})

test('doctor accepts the same bootstrap migration without writing or mutating saved state', async () => {
	const settings = parseSettings({ ...example, networkConfigured: true, connectivity: { readRpcUrl: 'http://localhost:8545', publicRpcUrls: ['http://localhost:8545'], quorumRpcUrls: [], rpcQuorum: 1 } })
	const old = initialDurableState(11155111, true, executionProfileId(obsoleteSettings()))
	old.activities.push({ at: new Date().toISOString(), message: 'Configured the network', type: 'configuration', status: 'info' })
	const profile = old.profileId
	const result = await runChaosDoctor({
		load: async () => ({ path: '/tmp/unused.json', revision: 'fixture', settings }),
		loadState: async () => old,
		acquireLocks: async () => ({ release: async () => undefined }),
		assertProfileIsolation: async () => undefined,
		verifyStateParent: async () => undefined,
		validateCompanionState: async () => ({ immutableTopology: 'absent' }),
		preflightSubmission: async () => [],
		deploymentAvailability: async () => 'Waiting for deployments',
		probe: async () => {
			throw new Error('Must not discover absent roots')
		},
	})
	expect(result).toMatchObject({ operationsAvailable: false })
	expect(old.profileId).toBe(profile)
})
