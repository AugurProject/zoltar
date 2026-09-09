import { acquireChaosProcessLocks, createChaosShutdownController } from '../../src/core/process-locks.ts'
import { saveDurableState } from '../../src/state/operator-state.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeScheduledOperation } from '../../src/runtime/scheduled-operation.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { evaluateSelectableOperationDefinition } from '../../src/operations/catalog.ts'
import { expect, test } from 'bun:test'
import { createManualOperationController } from '../../src/runtime/manual-operations.ts'
import { manualOperationFixture as fixture } from './manual-operation-fixture.ts'

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected response object')
	return Object.fromEntries(Object.entries(value))
}

const wrap = { definitionId: 'open-oracle.weth.wrap', inputs: { seed: { source: 'custom', value: '7' }, maxEthSpendAttoEth: { source: 'custom', value: '100' }, maxRepSpendAttoRep: { source: 'chaosbot' } } }

async function finished(controller: ReturnType<typeof createManualOperationController>, previewId: unknown) {
	for (let count = 0; count < 100; count += 1) {
		const response = object(await controller.handle({ action: 'status', previewId }))
		const execution = object(response['execution'])
		if (execution['status'] !== 'pending') return execution
		await Bun.sleep(1)
	}
	throw new Error('Execution did not finish')
}

test('mixed bot and custom inputs rebuild the plan and execute the reviewed bounded amount once', async () => {
	const { controller, executed, gate } = fixture()
	const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(preview['blockers']).toEqual([])
	expect(preview['previewId']).toBeString()
	const previewId = preview['previewId']
	await controller.handle({ action: 'execute', previewId })
	await controller.handle({ action: 'execute', previewId })
	expect((await finished(controller, previewId))['status']).toBe('completed')
	expect(executed).toHaveLength(1)
	const amount = BigInt(executed[0]?.steps[0]?.value ?? '0')
	expect(amount).toBeGreaterThan(0n)
	expect(amount).toBeLessThanOrEqual(100n)
	expect(gate.acquire('scan')).toBe(true)
	gate.release('scan')
})

test('preview is invalidated when policy changes or another preview is made', async () => {
	const { controller, configuration } = fixture()
	const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
	configuration.revision = 'revision-2'
	await expect(controller.handle({ action: 'execute', previewId: preview['previewId'] })).rejects.toThrow('configuration changed')
	const second = object(await controller.handle({ ...wrap, action: 'preview' }))
	await controller.handle({ ...wrap, action: 'inspect' })
	await expect(controller.handle({ action: 'execute', previewId: second['previewId'] })).rejects.toThrow('Preview the operation again')
})

test('fresh execution rejects changed funding without submitting transactions', async () => {
	const { controller, executed, scan } = fixture()
	const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
	scan.snapshot.wallet.ethBalanceAttoEth = '0'
	await controller.handle({ action: 'execute', previewId: preview['previewId'] })
	expect((await finished(controller, preview['previewId']))['status']).toBe('failed')
	expect(executed).toHaveLength(0)
})

test('rejects invalid inputs, policy bypasses, and concurrent signer work', async () => {
	const { controller, gate } = fixture()
	for (const inputs of [
		{ seed: { source: 'custom', value: '1.5' } },
		{ seed: { source: 'custom', value: '4294967296' } },
		{ maxEthSpendAttoEth: { source: 'custom', value: '999999999999999999999' } },
		{ minimumEthReserveAttoEth: { source: 'custom', value: '0' } },
		{ calldata: { source: 'custom', value: '123' } },
		{ workflowValidForBlocks: { source: 'custom', value: '1' } },
	]) {
		await expect(controller.handle({ ...wrap, action: 'preview', inputs })).rejects.toThrow()
	}
	gate.acquire('configuration')
	await expect(controller.handle({ ...wrap, action: 'preview' })).rejects.toThrow('another operation')
	gate.release('configuration')
})

test('coverage entries remain inspectable and never receive an execution preview', async () => {
	const { controller } = fixture()
	const response = object(await controller.handle({ action: 'inspect', definitionId: 'surface.weth9.receive' }))
	expect(response['fields']).toEqual([])
	expect(response['blockers']).toEqual(['This catalog entry is not independently executable'])
	expect(response['previewId']).toBeUndefined()
})

test('incomplete scans and paused live mode block manual execution', async () => {
	const { controller, scan, configuration } = fixture()
	scan.canonicalLifecyclePresenceComplete = false
	const incomplete = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(incomplete['previewId']).toBeUndefined()
	scan.canonicalLifecyclePresenceComplete = true
	configuration.settings.runtime.execute = true
	const paused = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(paused['blockers']).toContain('Resume the bot before live execution')
	expect(paused['previewId']).toBeUndefined()
})

test('production operator starts a manual operation before the random timer is due', async () => {
	const { configuration, state, scan } = fixture()
	const directory = await mkdtemp(join(tmpdir(), 'chaos-manual-schedule-'))
	try {
		configuration.settings.runtime.stateFile = join(directory, 'state.json')
		configuration.settings.paused = false
		state.paused = false
		state.scheduler.status = 'scheduled'
		state.scheduler.nextRunAt = new Date(Date.now() + 3_600_000).toISOString()
		const plan = evaluateSelectableOperationDefinition('open-oracle.weth.wrap', scan.snapshot, planningOptions(configuration.settings, 7)).plan
		if (plan === undefined) throw new Error('Expected a WETH plan')
		const execute = async () => {
			throw new Error('Dry runs must not submit transactions')
		}
		const recover = () => false
		await expect(executeScheduledOperation(configuration, state, plan, execute, recover)).rejects.toThrow('not due')
		await executeScheduledOperation(configuration, state, plan, execute, recover, 'manual')
		expect(state.activities.some(activity => activity.status === 'dry-run')).toBe(true)
		expect(state.scheduler.status).toBe('scheduled')
		expect(state.scheduler.selectedOperationId).toBe(plan.definitionId)
		configuration.settings.runtime.execute = true
		let submissions = 0
		await executeScheduledOperation(
			configuration,
			state,
			plan,
			async () => {
				submissions += 1
			},
			recover,
			'manual',
		)
		expect(submissions).toBe(1)
		state.scheduler.status = 'running'
		await expect(executeScheduledOperation(configuration, state, plan, execute, recover, 'manual')).rejects.toThrow('already running')
		state.paused = true
		await expect(executeScheduledOperation(configuration, state, plan, execute, recover, 'manual')).rejects.toThrow('paused')
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('shutdown retains process locks until manual execution and recovery persistence settle', async () => {
	const { configuration, state, scan, gate } = fixture()
	const directory = await mkdtemp(join(tmpdir(), 'chaos-manual-shutdown-'))
	const lockSettings = { chainId: configuration.settings.network.chainId, execute: true, privateKey: configuration.settings.privateKey, signerLockRoot: join(directory, 'locks'), stateFile: join(directory, 'state.json') }
	const locks = await acquireChaosProcessLocks(lockSettings)
	using shutdown = createChaosShutdownController()
	const entered = Promise.withResolvers<void>()
	const rpc = Promise.withResolvers<void>()
	const persisting = Promise.withResolvers<void>()
	const persistence = Promise.withResolvers<void>()
	const controller = createManualOperationController({
		configuration,
		state,
		gate,
		scan: async () => scan,
		execute: async () => {
			entered.resolve()
			await rpc.promise
			persisting.resolve()
			await persistence.promise
			await saveDurableState(lockSettings.stateFile, state)
			throw new Error('Simulated execution failure after durable recovery persistence')
		},
	})
	let returned = false
	let stopping: Promise<void> | undefined
	try {
		const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
		await controller.handle({ action: 'execute', previewId: preview['previewId'] })
		await entered.promise
		stopping = (async () => {
			try {
				await using _ownedController = controller
				await shutdown.wait(60_000)
			} finally {
				await locks.release()
				returned = true
			}
		})()
		void stopping.catch(() => undefined)
		shutdown.requestShutdown()
		await Bun.sleep(10)
		expect(returned).toBe(false)
		await expect(controller.handle({ ...wrap, action: 'inspect' })).rejects.toThrow('shutting down')
		await expect(acquireChaosProcessLocks(lockSettings)).rejects.toThrow('already locked')
		await expect(acquireChaosProcessLocks({ ...lockSettings, stateFile: join(directory, 'competitor.json') })).rejects.toThrow('already locked')
		rpc.resolve()
		await persisting.promise
		expect(returned).toBe(false)
		await expect(acquireChaosProcessLocks(lockSettings)).rejects.toThrow('already locked')
		persistence.resolve()
		await stopping
		expect(returned).toBe(true)
		const successor = await acquireChaosProcessLocks(lockSettings)
		await successor.release()
	} finally {
		rpc.resolve()
		persistence.resolve()
		await stopping?.catch(() => undefined)
		await locks.release()
		await rm(directory, { recursive: true, force: true })
	}
})

test('controller disposal drains an in-flight inspection scan', async () => {
	const { configuration, state, scan, gate } = fixture()
	const entered = Promise.withResolvers<void>()
	const scanned = Promise.withResolvers<void>()
	const controller = createManualOperationController({
		configuration,
		state,
		gate,
		execute: async () => undefined,
		scan: async () => {
			entered.resolve()
			await scanned.promise
			return scan
		},
	})
	const inspection = controller.handle({ ...wrap, action: 'inspect' })
	await entered.promise
	let disposed = false
	const disposal = controller[Symbol.asyncDispose]().then(() => {
		disposed = true
	})
	try {
		await Bun.sleep(10)
		expect(disposed).toBe(false)
		await expect(controller.handle({ ...wrap, action: 'inspect' })).rejects.toThrow('shutting down')
	} finally {
		scanned.resolve()
		await inspection
		await disposal
	}
	expect(disposed).toBe(true)
})

test('exact input and its source are preserved when executing after incoming funds', async () => {
	const { controller, executed, scan } = fixture()
	const preview = object(await controller.handle({ action: 'preview', definitionId: 'open-oracle.weth.wrap', inputs: { amount: { source: 'custom', value: '73' } } }))
	expect(preview['blockers']).toEqual([])
	scan.snapshot.wallet.ethBalanceAttoEth = (BigInt(scan.snapshot.wallet.ethBalanceAttoEth) + 1000000n).toString()
	await controller.handle({ action: 'execute', previewId: preview['previewId'] })
	expect((await finished(controller, preview['previewId']))['status']).toBe('completed')
	expect(executed[0]?.steps[0]?.value).toBe('73')
	expect(executed[0]?.operationInputs?.['amount']).toBe('73')
	expect(executed[0]?.inputSources?.['amount']).toBe('custom')
	expect(executed[0]?.inputSources?.['seed']).toBe('chaosbot')
})

test('exact input above the policy cap is blocked rather than silently clamped', async () => {
	const { controller } = fixture()
	const response = object(await controller.handle({ action: 'preview', definitionId: 'open-oracle.weth.wrap', inputs: { amount: { source: 'custom', value: '101' }, maxEthSpendAttoEth: { source: 'custom', value: '100' } } }))
	expect(response['previewId']).toBeUndefined()
	expect(response['blockers']).not.toEqual([])
})
