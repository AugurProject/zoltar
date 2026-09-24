import { createDurableWorkflow, durableWorkflowPlan, retainWorkflow, markWorkflowForRediscovery } from '../../src/runtime/workflows.ts'
import { acquireBotProcessLocks, createBotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import { CHAOS_PROCESS_LOCK_OPTIONS } from '../../src/core/process-lock-options.ts'
import { saveDurableState } from '../../src/state/operator-state.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeScheduledOperation } from '../../src/runtime/scheduled-operation.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { reevaluateOperationContinuation, evaluateSelectableOperationDefinition } from '../../src/operations/catalog.ts'
import { expect, spyOn, test } from 'bun:test'
import { TransactionAwaitingRecovery } from '../../src/execution/receipt-validation.ts'
import { createManualOperationController } from '../../src/runtime/manual-operations.ts'
import { advanceManualSnapshot, manualTradingFixture, manualOperationFixture as fixture } from './manual-operation-fixture.ts'

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected response object')
	return Object.fromEntries(Object.entries(value))
}

const wrap = { definitionId: 'open-oracle.weth.wrap', inputs: { seed: { source: 'custom', value: '7' }, maxEthSpendAttoEth: { source: 'custom', value: '100' }, maxRepSpendAttoRep: { source: 'chaosbot' } } }

test('available history permits state-based manual execution without claiming historical completeness', async () => {
	const { controller, executed, scan } = fixture()
	scan.executionReady = true
	scan.indexComplete = false
	scan.carryProofsComplete = false
	scan.canonicalLifecyclePresenceComplete = false
	const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(preview['blockers']).toEqual([])
	expect(preview['previewId']).toBeString()
	await controller.handle({ action: 'execute', previewId: preview['previewId'] })
	expect((await finished(controller, preview['previewId']))['status']).toBe('completed')
	expect(executed).toHaveLength(1)
})

async function finished(controller: ReturnType<typeof createManualOperationController>, previewId: unknown) {
	for (let count = 0; count < 100; count += 1) {
		const response = object(await controller.handle({ action: 'status', previewId }))
		const execution = object(response['execution'])
		if (execution['status'] !== 'pending') return execution
		await Promise.resolve()
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
	scan.executionReady = false
	const incomplete = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(incomplete['previewId']).toBeUndefined()
	scan.executionReady = true
	configuration.settings.runtime.execute = true
	const paused = object(await controller.handle({ ...wrap, action: 'preview' }))
	expect(paused['blockers']).toContain('Resume the bot before live execution')
	expect(paused['previewId']).toBeUndefined()
})

test.each(['idle', 'scheduled'] as const)('production operator starts a manual operation while the timer is %s', async initialStatus => {
	const { configuration, state, scan } = fixture()
	const directory = await mkdtemp(join(tmpdir(), 'chaos-manual-schedule-'))
	try {
		configuration.settings.runtime.stateFile = join(directory, 'state.json')
		configuration.settings.paused = false
		state.paused = false
		state.scheduler.status = initialStatus
		state.scheduler.nextRunAt = initialStatus === 'idle' ? undefined : new Date(Date.now() + 3_600_000).toISOString()
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
		state.scheduler.status = initialStatus
		state.scheduler.nextRunAt = initialStatus === 'idle' ? undefined : new Date(Date.now() + 3_600_000).toISOString()
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
	const locks = await acquireBotProcessLocks(lockSettings, CHAOS_PROCESS_LOCK_OPTIONS)
	using shutdown = createBotShutdownController()
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
		await expect(acquireBotProcessLocks(lockSettings, CHAOS_PROCESS_LOCK_OPTIONS)).rejects.toThrow('already locked')
		await expect(acquireBotProcessLocks({ ...lockSettings, stateFile: join(directory, 'competitor.json') }, CHAOS_PROCESS_LOCK_OPTIONS)).rejects.toThrow('already locked')
		rpc.resolve()
		await persisting.promise
		expect(returned).toBe(false)
		await expect(acquireBotProcessLocks(lockSettings, CHAOS_PROCESS_LOCK_OPTIONS)).rejects.toThrow('already locked')
		persistence.resolve()
		await stopping
		expect(returned).toBe(true)
		const successor = await acquireBotProcessLocks(lockSettings, CHAOS_PROCESS_LOCK_OPTIONS)
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

test('manual live results expose the skip reason and transaction progress for the exact execution', async () => {
	const { configuration, state, scan, gate } = fixture()
	configuration.settings.runtime.execute = true
	configuration.settings.paused = false
	state.paused = false
	scan.inventory.rep = scan.snapshot.universes.map(universe => ({ universeId: universe.id, token: universe.repToken, symbol: 'REP', balance: '1000000000000000000000000' }))
	let skip = true
	const submitted = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const hash = `0x${'ab'.repeat(32)}`
	const controller = createManualOperationController({
		configuration,
		state,
		gate,
		scan: async () => scan,
		execute: async plan => {
			const workflow = retainWorkflow(state, plan)
			if (skip) {
				markWorkflowForRediscovery(workflow, new Error('Canonical signing anchor changed during pre-signing checks'))
				return
			}
			const step = workflow.steps[0]
			if (step === undefined) throw new Error('Missing step')
			step.transactionHash = `0x${'ab'.repeat(32)}`
			step.status = 'submitted'
			workflow.status = 'waiting-transaction'
			submitted.resolve()
			await release.promise
			step.status = 'confirmed'
			workflow.status = 'completed'
		},
	})
	try {
		const first = object(await controller.handle({ ...wrap, action: 'preview' }))
		expect(first['blockers']).toEqual([])
		await controller.handle({ action: 'execute', previewId: first['previewId'] })
		const skipped = await finished(controller, first['previewId'])
		expect(skipped['outcome']).toBe('skipped')
		expect(skipped['message']).toContain('No transaction signed')
		expect(JSON.stringify(skipped)).toContain('Canonical signing anchor changed')
		skip = false
		const second = object(await controller.handle({ ...wrap, action: 'preview' }))
		await controller.handle({ action: 'execute', previewId: second['previewId'] })
		await submitted.promise
		const pending = object(object(await controller.handle({ action: 'status', previewId: second['previewId'] }))['execution'])
		expect(pending['outcome']).toBe('submitted')
		expect(pending['transactions']).toEqual([expect.objectContaining({ hash, status: 'submitted', explorerUrl: `https://sepolia.etherscan.io/tx/${hash}` })])
		release.resolve()
		const confirmed = await finished(controller, second['previewId'])
		expect(confirmed['outcome']).toBe('confirmed')
		expect(confirmed['message']).toBe('Operation confirmed.')
		expect(object(object(await controller.handle({ action: 'status', previewId: first['previewId'] }))['execution'])['outcome']).toBe('skipped')
	} finally {
		release.resolve()
		await controller[Symbol.asyncDispose]()
	}
})

for (const severity of ['pending', 'alarming'] as const) {
	test(`manual transaction recovery logs ${severity} at the appropriate level and retains its hash`, async () => {
		const { configuration, state, scan, gate } = fixture()
		configuration.settings.runtime.execute = true
		configuration.settings.paused = false
		state.paused = false
		scan.inventory.rep = scan.snapshot.universes.map(universe => ({ universeId: universe.id, token: universe.repToken, symbol: 'REP', balance: '1000000000000000000000000' }))
		const hash = `0x${'ab'.repeat(32)}` as const
		const error = new TransactionAwaitingRecovery('Wrap WETH', hash, 'not yet visible to the RPC quorum', severity)
		const info = spyOn(console, 'log').mockImplementation(() => {})
		const errors = spyOn(console, 'error').mockImplementation(() => {})
		const controller = createManualOperationController({
			configuration,
			state,
			gate,
			scan: async () => scan,
			execute: async plan => {
				const workflow = retainWorkflow(state, plan)
				const step = workflow.steps[0]
				if (step === undefined) throw new Error('Missing step')
				step.transactionHash = hash
				step.status = 'submitted'
				workflow.status = 'waiting-transaction'
				throw error
			},
		})
		try {
			const preview = object(await controller.handle({ ...wrap, action: 'preview' }))
			await controller.handle({ action: 'execute', previewId: preview['previewId'] })
			const result = await finished(controller, preview['previewId'])
			expect(result['outcome']).toBe('submitted')
			expect(result['transactions']).toEqual([expect.objectContaining({ hash, status: 'submitted', explorerUrl: `https://sepolia.etherscan.io/tx/${hash}` })])
			if (severity === 'pending') {
				expect(errors).not.toHaveBeenCalled()
				expect(info).toHaveBeenCalledWith(`chaosManualOperation pending: ${error.message}`)
			} else {
				expect(errors).toHaveBeenCalledWith('chaosManualOperation failed', error)
				expect(info).not.toHaveBeenCalled()
			}
			expect(gate.acquire('scan')).toBe(true)
			gate.release('scan')
			const workflow = state.workflows[0]
			const step = workflow?.steps[0]
			if (workflow === undefined || step === undefined) throw new Error('Missing retained workflow')
			step.status = 'confirmed'
			workflow.status = 'completed'
			const recovered = object(object(await controller.handle({ action: 'status', previewId: preview['previewId'] }))['execution'])
			expect(recovered['outcome']).toBe('confirmed')
			expect(recovered['status']).toBe('completed')
		} finally {
			await controller[Symbol.asyncDispose]()
			info.mockRestore()
			errors.mockRestore()
		}
	})
}

const deadlineOperations = ['trading.liquidity.remove', 'trading.complete-set.redeem', 'trading.position.exit'] as const

for (const definitionId of deadlineOperations) {
	test(`manual reviewed deadline survives a new block: ${definitionId}`, async () => {
		using clock = spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
		const { controller, executed, scan, configuration } = manualTradingFixture(definitionId)
		const reviewed = evaluateSelectableOperationDefinition(definitionId, scan.snapshot, planningOptions(configuration.settings, 7)).plan
		if (reviewed === undefined) throw new Error('Missing reviewed plan')
		const preview = object(await controller.handle({ action: 'preview', definitionId, inputs: { seed: { source: 'custom', value: '7' } } }))
		expect(preview['blockers']).toEqual([])
		advanceManualSnapshot(scan, BigInt(scan.snapshot.anchor.timestamp) + 12n)
		clock.mockReturnValue(2_000_000_012_000)
		await controller.handle({ action: 'execute', previewId: preview['previewId'] })
		const result = await finished(controller, preview['previewId'])
		expect(result['message']).not.toContain('Operation inputs or prerequisites changed')
		expect(result['status']).toBe('completed')
		expect(executed).toHaveLength(1)
		expect(executed[0]?.steps).toEqual(reviewed.steps)
		expect(executed[0]?.deadlineTimestamp).toBe(reviewed.deadlineTimestamp)
		const dispatched = executed[0]
		if (dispatched === undefined) throw new Error('Missing dispatched plan')
		const durable = durableWorkflowPlan(createDurableWorkflow(dispatched))
		advanceManualSnapshot(scan, BigInt(scan.snapshot.anchor.timestamp) + 12n)
		const continued = reevaluateOperationContinuation(scan.snapshot, durable, planningOptions(configuration.settings, 7)).plan
		expect(continued?.steps).toEqual(reviewed.steps)
		expect(continued?.deadlineTimestamp).toBe(reviewed.deadlineTimestamp)
		expect(continued?.operationInputs).toEqual(dispatched.operationInputs)
	})
}

for (const definitionId of deadlineOperations) {
	for (const boundary of ['expired deadline', 'safety margin', 'funding', 'quote'] as const) {
		test(`manual retained deadline rejects ${boundary}: ${definitionId}`, async () => {
			using _clock = spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
			const { controller, executed, scan, configuration } = manualTradingFixture(definitionId)
			const reviewed = evaluateSelectableOperationDefinition(definitionId, scan.snapshot, planningOptions(configuration.settings, 7)).plan
			if (reviewed?.deadlineTimestamp === undefined) throw new Error('Missing deadline')
			const preview = object(await controller.handle({ action: 'preview', definitionId, inputs: { seed: { source: 'custom', value: '7' } } }))
			expect(preview['blockers']).toEqual([])
			const pair = scan.snapshot.pairs[0]
			const pool = scan.snapshot.pools[0]
			const shares = scan.snapshot.wallet.shares[0]
			const lp = scan.snapshot.wallet.lpTokens[0]
			if (pair === undefined || pool === undefined || shares === undefined || lp === undefined) throw new Error('Missing trading inventory')
			advanceManualSnapshot(scan, BigInt(scan.snapshot.anchor.timestamp) + 12n)
			if (boundary === 'expired deadline') advanceManualSnapshot(scan, BigInt(reviewed.deadlineTimestamp) + 1n)
			if (boundary === 'safety margin') advanceManualSnapshot(scan, BigInt(reviewed.deadlineTimestamp) - 60n)
			if (boundary === 'funding') {
				lp.balance = '0'
				shares.invalid = '0'
			}
			if (boundary === 'quote') {
				pair.yesReserve = '1'
				pair.effectiveYesReserve = '1'
				pool.projectedSettlementCollateralAttoEth = '1'
				pool.settlementCollateralAttoEth = '1'
			}
			await controller.handle({ action: 'execute', previewId: preview['previewId'] })
			const result = await finished(controller, preview['previewId'])
			expect(result['status']).toBe('failed')
			expect(result['message']).not.toContain('Operation inputs or prerequisites changed')
			expect(executed).toHaveLength(0)
		})
	}
}

for (const changedBound of [false, true]) {
	test(`manual exit respects the question-end deadline, changed bound: ${changedBound}`, async () => {
		using _clock = spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
		const definitionId = 'trading.position.exit'
		const { controller, executed, scan, configuration } = manualTradingFixture(definitionId, 1_000n)
		const reviewed = evaluateSelectableOperationDefinition(definitionId, scan.snapshot, planningOptions(configuration.settings, 7)).plan
		const question = scan.snapshot.questions[0]
		if (reviewed === undefined || question === undefined) throw new Error('Missing exit plan')
		expect(reviewed.deadlineTimestamp).toBe((BigInt(question.endTime) - 1n).toString())
		const preview = object(await controller.handle({ action: 'preview', definitionId, inputs: { seed: { source: 'custom', value: '7' } } }))
		expect(preview['blockers']).toEqual([])
		advanceManualSnapshot(scan, BigInt(scan.snapshot.anchor.timestamp) + 12n)
		if (changedBound) question.endTime = '2000000900'
		await controller.handle({ action: 'execute', previewId: preview['previewId'] })
		const result = await finished(controller, preview['previewId'])
		expect(result['status']).toBe(changedBound ? 'failed' : 'completed')
		expect(result['message']).not.toContain('Operation inputs or prerequisites changed')
		if (changedBound) expect(executed).toHaveLength(0)
		else expect(executed[0]?.steps).toEqual(reviewed.steps)
	})
}

test('manual trading preview expires independently of its still-valid transaction deadline', async () => {
	using clock = spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
	const { controller, executed } = manualTradingFixture('trading.liquidity.remove')
	const preview = object(await controller.handle({ action: 'preview', definitionId: 'trading.liquidity.remove' }))
	expect(preview['blockers']).toEqual([])
	clock.mockReturnValue(2_000_000_060_001)
	await expect(controller.handle({ action: 'execute', previewId: preview['previewId'] })).rejects.toThrow('preview expired')
	expect(executed).toHaveLength(0)
})
