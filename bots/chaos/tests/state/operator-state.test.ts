import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import {
	MAXIMUM_TERMINAL_WORKFLOW_COUNT,
	compactDurableState,
	initialDurableState,
	initialRuntimeState,
	loadDurableState,
	loadRuntimeState,
	parseProtocolIndex,
	recordActivity,
	saveDurableState,
	type DurableState,
	type DurableWorkflow,
	type PendingTransactionIntent,
	type StateFilesystem,
} from '../../src/state/operator-state.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function statePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-state-'))
	directories.push(directory)
	return join(directory, 'state.json')
}

const emitter = getAddress('0x0000000000000000000000000000000000000020')
const topic0 = `0x${'44'.repeat(32)}` as const
const createdAt = '2026-08-24T00:00:00.000Z'

function protocolIndex(): NonNullable<DurableState['protocolIndex']> {
	const childUniverseId = (BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, 1n]))) & ((1n << 248n) - 1n)).toString()
	return {
		auctionBids: {
			[emitter.toLowerCase()]: [{ amountAttoEth: 25n.toString(), index: '2', refunded: false, tick: '-7' }],
		},
		chainId: 1,
		childRepSplits: [{ childPoolRepSplitAttoRep: 45n.toString(), outcomeIndex: '1', pool: emitter }],
		cursor: { blockHash: topic0, blockNumber: '50' },
		escalationDeposits: [
			{
				amountAttoRep: 90n.toString(),
				claimed: false,
				depositIndex: '3',
				escalationGame: emitter,
				outcome: 1,
				parentDepositIndex: '8',
				pool: getAddress('0x0000000000000000000000000000000000000021'),
				vault: getAddress('0x0000000000000000000000000000000000000022'),
			},
		],
		migrationRepSplits: [{ childMigrationRepAmountAttoRep: 25n.toString(), childUniverseId, outcomeIndex: '1', universeId: '0' }],
		openOracle: emitter,
		reports: [
			{
				currentAmount1: '10',
				currentAmount2: '20',
				currentReporter: getAddress('0x0000000000000000000000000000000000000023'),
				disputeAfterTimestamp: '160',
				disputeBeforeTimestamp: '1000',
				disputeDelay: '60',
				escalationHalt: '1000',
				flags: 1,
				game: {
					callbackContract: getAddress('0x0000000000000000000000000000000000000000'),
					callbackGasLimit: 0,
					feePercentage: 1,
					lastReportOppoTime: '0',
					numReports: 1,
					protocolFee: 2,
					protocolFeeRecipient: getAddress('0x0000000000000000000000000000000000000024'),
					settlerReward: '3',
				},
				helper: {
					blockNumber: '40',
					blockTimestamp: '100',
					creator: getAddress('0x0000000000000000000000000000000000000025'),
				},
				multiplier: 140,
				openOracle: emitter,
				reportId: '4',
				reportTimestamp: '100',
				settleAfterTimestamp: '1000',
				settlementTime: '900',
				settlementTimestamp: '0',
				stateHash: `0x${'55'.repeat(32)}`,
				token1: getAddress('0x0000000000000000000000000000000000000026'),
				token2: getAddress('0x0000000000000000000000000000000000000027'),
			},
		],
		schemaVersion: 2,
		securityPoolForker: getAddress('0x0000000000000000000000000000000000000030'),
		startBlock: '10',
		wallet: getAddress('0x0000000000000000000000000000000000000022'),
		zoltar: getAddress('0x0000000000000000000000000000000000000031'),
	}
}

function workflow(): DurableWorkflow {
	return {
		classification: 'selectable',
		createdAtBlock: '1',
		createdAt,
		ecosystem: 'open-oracle',
		id: 'workflow:one',
		label: 'Initialize OpenOracle dust',
		metadata: { reportId: '7' },
		obligation: false,
		operationId: 'open-oracle.dust',
		planId: 'plan:one',
		planningSeed: 1,
		postconditions: ['Dust is initialized'],
		priority: 'random',
		risk: 'low',
		semanticDeadlineBlockNumber: '144',
		status: 'waiting-transaction',
		steps: [
			{
				data: '0x1234',
				evidence: [
					{
						abi: '[{"type":"event","name":"DustInitialized"}]',
						emitter,
						equals: true,
						field: 'initialized',
						indexed: { account: emitter },
						kind: 'decoded-event-field',
						signature: 'DustInitialized(address,bool)',
						topic0,
					},
				],
				gasLimit: '12000000',
				id: 'dust',
				label: 'Initialize dust',
				preflightCalls: [
					{
						caller: getAddress('0x0000000000000000000000000000000000000021'),
						data: '0xabcd',
						expectedResult: '0x1234',
						label: 'Downstream mutation',
						to: emitter,
						value: '0',
					},
				],
				status: 'signed',
				to: emitter,
				transactionIntentId: 'intent:one',
				value: '7',
				walletAssetDebits: [
					{ amount: '7', asset: 'ETH', kind: 'native' },
					{ amount: '3', asset: emitter, category: 'rep', kind: 'open-oracle-credit', openOracle: emitter },
				],
			},
		],
		updatedAt: createdAt,
	}
}

async function pendingIntent(): Promise<PendingTransactionIntent> {
	const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
	const serializedTransaction = await account.signTransaction({
		chainId: 1,
		data: '0x1234',
		gas: 100_000n,
		maxFeePerGas: 2n,
		maxPriorityFeePerGas: 1n,
		nonce: 3n,
		to: emitter,
		value: 7n,
	})
	return {
		data: '0x1234',
		hash: keccak256(serializedTransaction),
		id: 'intent:one',
		label: 'Initialize dust',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 3n,
		operationId: 'open-oracle.dust',
		semanticExpectation: {
			balanceBaselines: [{ account: account.address, asset: 'ETH', balance: '1000000000000000000' }],
			evidence: [
				...(workflow().steps[0]?.evidence ?? [{ kind: 'receipt-success' as const }]),
				{ account: account.address, asset: 'ETH', direction: 'decrease', kind: 'balance-change' },
				{
					abi: 'function tokenHolder(address owner, address token) view returns (uint256)',
					args: [account.address, emitter],
					contract: emitter,
					functionName: 'tokenHolder',
					kind: 'storage-postcondition',
					relation: 'changed',
				},
			],
			postconditions: ['The dust sentinel is initialized'],
			storageBaselines: [{ args: [account.address, emitter], contract: emitter, functionName: 'tokenHolder', value: '9' }],
		},
		sender: account.address,
		serializedTransaction,
		signedAt: createdAt,
		status: 'signed',
		stepId: 'dust',
		to: emitter,
		value: 7n,
		workflowId: 'workflow:one',
	}
}

async function populatedState(): Promise<DurableState> {
	const intent = await pendingIntent()
	const durableWorkflow = workflow()
	const step = durableWorkflow.steps[0]
	if (step === undefined) throw new Error('Expected a workflow step')
	step.transactionHash = intent.hash
	return {
		...initialDurableState(1, false, 'profile:test', intent.sender),
		pendingTransactions: [intent],
		workflows: [durableWorkflow],
	}
}

describe('chaos-bot durable state', () => {
	test('creates chain-bound empty runtime state when the journal is missing', async () => {
		const path = await statePath()
		const runtime = await loadRuntimeState(path, true, undefined, 1)
		expect(runtime.chainId).toBe(1)
		expect(runtime.paused).toBe(true)
		expect(runtime.status).toBe('paused')
		expect(runtime.pendingTransactions).toEqual([])
	})

	test('retains the public signer scope when a memory-only key is absent after restart', () => {
		const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`).address
		const durable = initialDurableState(1, false, 'profile:test', signer)
		const runtime = initialRuntimeState(false, undefined, 1, durable)
		expect(runtime.signerAddress).toBe(signer)
		expect(runtime.wallet).toBe(signer)
	})

	test('honors a durable safety pause across process restart', () => {
		const durable = initialDurableState(1, false)
		durable.safetyPaused = true
		recordActivity(durable, {
			message: 'Operator cycle stopped safely: invariant failed',
			status: 'failed',
			type: 'error',
		})
		const runtime = initialRuntimeState(false, undefined, 1, durable)
		expect(runtime.safetyPaused).toBeTrue()
		expect(runtime.paused).toBeTrue()
		expect(runtime.status).toBe('paused')
		expect(runtime.error).toBe('Operator cycle stopped safely: invariant failed')
	})

	test('preserves an interrupted scheduler marker until startup schedules a fresh wait', () => {
		const durable = initialDurableState(1, false)
		durable.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: createdAt,
			nextRunAt: '2026-08-24T00:01:00.000Z',
			selectedOperationId: 'open-oracle.dust',
			status: 'running',
		}
		const state = initialRuntimeState(false, undefined, 1, durable)
		expect(state.scheduler.status).toBe('running')
	})

	test('keeps an interrupted scheduler run active when an exact signed intent is recoverable', async () => {
		const durable = await populatedState()
		durable.scheduler = {
			lastDelaySeconds: 60,
			lastRunAt: createdAt,
			nextRunAt: '2026-08-24T00:01:00.000Z',
			selectedOperationId: 'open-oracle.dust',
			status: 'running',
		}
		const state = initialRuntimeState(false, undefined, 1, durable)
		expect(state.scheduler.status).toBe('running')
	})

	test('round-trips signed intent, workflow, and decoded-event semantic evidence', async () => {
		const path = await statePath()
		const state = await populatedState()
		await saveDurableState(path, state)
		const restored = await loadDurableState(path, 1)
		expect(restored.pendingTransactions[0]).toMatchObject({
			data: '0x1234',
			maxBlockNumber: 120n,
			nonce: 3n,
			operationId: 'open-oracle.dust',
			to: emitter,
			value: 7n,
			workflowId: 'workflow:one',
		})
		expect(restored.pendingTransactions[0]?.semanticExpectation.balanceBaselines).toEqual([{ account: privateKeyToAccount(`0x${'11'.repeat(32)}`).address, asset: 'ETH', balance: '1000000000000000000' }])
		expect(restored.pendingTransactions[0]?.semanticExpectation.storageBaselines).toEqual([{ args: [privateKeyToAccount(`0x${'11'.repeat(32)}`).address, emitter], contract: emitter, functionName: 'tokenHolder', value: '9' }])
		expect(restored.workflows[0]?.semanticDeadlineBlockNumber).toBe('144')
		expect(restored.workflows[0]?.steps[0]?.evidence[0]).toEqual({
			abi: '[{"type":"event","name":"DustInitialized"}]',
			emitter,
			equals: true,
			field: 'initialized',
			indexed: { account: emitter },
			kind: 'decoded-event-field',
			signature: 'DustInitialized(address,bool)',
			topic0,
		})
		expect(restored.workflows[0]?.steps[0]?.preflightCalls).toEqual([
			{
				caller: getAddress('0x0000000000000000000000000000000000000021'),
				data: '0xabcd',
				expectedResult: '0x1234',
				label: 'Downstream mutation',
				to: emitter,
				value: '0',
			},
		])
		expect(restored.workflows[0]?.steps[0]?.walletAssetDebits).toEqual([
			{ amount: '7', asset: 'ETH', kind: 'native' },
			{ amount: '3', asset: emitter, category: 'rep', kind: 'open-oracle-credit', openOracle: emitter },
		])
		expect((await stat(path)).mode & 0o777).toBe(0o600)
	})

	test('round-trips a classified finalized workflow failure', async () => {
		const path = await statePath()
		const state = await populatedState()
		state.pendingTransactions = []
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (workflow === undefined || step === undefined) throw new Error('Expected a populated workflow')
		workflow.status = 'failed'
		step.failure = 'Finalized receipt reverted'
		step.failureKind = 'receipt-reverted'
		step.status = 'failed'
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).workflows[0]?.steps[0]?.failureKind).toBe('receipt-reverted')
	})

	test('loads workflows written before durable downstream preflights were added', async () => {
		const path = await statePath()
		await saveDurableState(path, await populatedState())
		const stored = JSON.parse(await readFile(path, 'utf8')) as { workflows: Array<{ steps: Array<Record<string, unknown>> }> }
		const step = stored.workflows[0]?.steps[0]
		if (step === undefined) throw new Error('Expected a persisted workflow step')
		delete step['preflightCalls']
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		const restored = await loadDurableState(path, 1)
		expect(restored.workflows[0]?.steps[0]?.preflightCalls).toEqual([])
	})

	test('retains public intent metadata beyond its automatic resubmission horizon', async () => {
		const path = await statePath()
		const state = await populatedState()
		const intent = state.pendingTransactions[0]
		const step = state.workflows[0]?.steps[0]
		if (intent === undefined || step === undefined) throw new Error('Expected a pending workflow fixture')
		intent.status = 'confirmation-unknown'
		intent.submissionBlock = intent.maxBlockNumber + 1n
		intent.submittedAt = createdAt
		step.status = 'submitted'
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).pendingTransactions[0]?.submissionBlock).toBe(121n)
	})

	test('round-trips a recovery blocker without falsely recording a broadcast', async () => {
		const path = await statePath()
		const state = await populatedState()
		const intent = state.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a pending workflow fixture')
		intent.recoveryBlocker = 'Automatic resubmission window closed; verify a receipt or cancellation'
		await saveDurableState(path, state)
		const restored = (await loadDurableState(path, 1)).pendingTransactions[0]
		expect(restored?.status).toBe('signed')
		expect(restored?.submissionBlock).toBeUndefined()
		expect(restored?.recoveryBlocker).toContain('window closed')
	})

	test('round-trips the canonical report, auction bid, and escalation deposit index', async () => {
		const path = await statePath()
		const state = initialDurableState(1)
		state.protocolIndex = protocolIndex()
		await saveDurableState(path, state)
		const restored = await loadDurableState(path, 1)
		expect(restored.protocolIndex).toEqual(state.protocolIndex)
		expect(restored.protocolIndex?.reports[0]?.stateHash).toBe(`0x${'55'.repeat(32)}`)
		expect(restored.protocolIndex?.auctionBids[emitter.toLowerCase()]?.[0]).toEqual({ amountAttoEth: 25n.toString(), index: '2', refunded: false, tick: '-7' })
		expect(restored.protocolIndex?.escalationDeposits[0]).toMatchObject({ depositIndex: '3', parentDepositIndex: '8', claimed: false })
		expect(restored.protocolIndex?.migrationRepSplits[0]?.childMigrationRepAmountAttoRep).toBe('25')
		expect(restored.protocolIndex?.childRepSplits[0]).toMatchObject({ childPoolRepSplitAttoRep: 45n.toString(), outcomeIndex: '1', pool: emitter })
	})

	test('rejects forged and unordered durable migration progress', () => {
		const forged = protocolIndex()
		const forgedRoute = forged.migrationRepSplits[0]
		if (forgedRoute === undefined) throw new Error('Expected migration progress fixture')
		forgedRoute.childUniverseId = '0'
		expect(() => parseProtocolIndex(forged, 1)).toThrow('does not match its parent/outcome derivation')

		const unordered = protocolIndex()
		unordered.migrationRepSplits.push({
			childMigrationRepAmountAttoRep: 1n.toString(),
			childUniverseId: (BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [0n, 0n]))) & ((1n << 248n) - 1n)).toString(),
			outcomeIndex: '0',
			universeId: '0',
		})
		expect(() => parseProtocolIndex(unordered, 1)).toThrow('canonical unique route order')
	})

	test('rejects a protocol index whose canonical cursor precedes its immutable start', async () => {
		const path = await statePath()
		const state = initialDurableState(1)
		state.protocolIndex = { ...protocolIndex(), cursor: { blockHash: topic0, blockNumber: '9' } }
		await expect(saveDurableState(path, state)).rejects.toThrow('precedes protocolIndex.startBlock')
	})

	test('rejects a journal whose exact transaction fields do not match its signature', async () => {
		const path = await statePath()
		await saveDurableState(path, await populatedState())
		const stored = JSON.parse(await readFile(path, 'utf8')) as { pendingTransactions: Array<Record<string, unknown>> }
		const intent = stored.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a persisted intent')
		intent['value'] = '8'
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('value does not match its serialized transaction')
	})

	test('rejects an unconstrained durable workflow step without a gas limit', async () => {
		const path = await statePath()
		await saveDurableState(path, await populatedState())
		const stored = JSON.parse(await readFile(path, 'utf8')) as { workflows: Array<{ steps: Array<Record<string, unknown>> }> }
		const step = stored.workflows[0]?.steps[0]
		if (step === undefined) throw new Error('Expected a persisted workflow step')
		delete step['gasLimit']
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('is missing gasLimit')
	})

	test('refuses to replace a good journal with an invalid in-memory signed intent', async () => {
		const path = await statePath()
		const original = await populatedState()
		await saveDurableState(path, original)
		const before = await readFile(path, 'utf8')
		const invalid = await populatedState()
		const intent = invalid.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a populated intent')
		intent.value = 8n
		await expect(saveDurableState(path, invalid)).rejects.toThrow('value does not match its serialized transaction')
		expect(await readFile(path, 'utf8')).toBe(before)
	})

	test('requires a durable pre-signing baseline for every balance-change expectation', async () => {
		const path = await statePath()
		const invalid = await populatedState()
		const intent = invalid.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a populated intent')
		intent.semanticExpectation = { ...intent.semanticExpectation, balanceBaselines: [] }
		await expect(saveDurableState(path, invalid)).rejects.toThrow('missing a baseline for balance-change evidence')
	})

	test('requires a durable pre-signing baseline for every changed storage expectation', async () => {
		const path = await statePath()
		const invalid = await populatedState()
		const intent = invalid.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a populated intent')
		intent.semanticExpectation = { ...intent.semanticExpectation, storageBaselines: [] }
		await expect(saveDurableState(path, invalid)).rejects.toThrow('missing a baseline for changed storage evidence')
	})

	test('rejects state reuse across chains', async () => {
		const path = await statePath()
		await saveDurableState(path, initialDurableState(1))
		await expect(loadDurableState(path, 11_155_111)).rejects.toThrow('belongs to chain 1')
	})

	test('refuses permissive or symbolic-link durable journals before parsing them', async () => {
		const path = await statePath()
		const alias = `${path}.alias`
		await saveDurableState(path, initialDurableState(1))
		await chmod(path, 0o644)
		await expect(loadDurableState(path, 1)).rejects.toThrow('owner-only mode 0600')
		await chmod(path, 0o600)
		await symlink(path, alias)
		await expect(loadDurableState(alias, 1)).rejects.toThrow('must not be a symbolic link')
	})

	test('bounds activity history while preserving newest entries', () => {
		const runtime = {
			activities: Array.from({ length: 500 }, (_, index) => ({ at: createdAt, message: `old ${index.toString()}`, status: 'info' as const, type: 'operation' as const })),
		}
		recordActivity(runtime, { message: 'newest', status: 'confirmed', type: 'transaction' })
		expect(runtime.activities).toHaveLength(500)
		expect(runtime.activities[0]?.message).toBe('newest')
		expect(runtime.activities.at(-1)?.message).toBe('old 498')
	})

	test('bounds terminal workflow history for indefinite operation', () => {
		const state = initialDurableState(1)
		state.workflows = Array.from({ length: MAXIMUM_TERMINAL_WORKFLOW_COUNT + 2 }, (_, index) => ({
			...workflow(),
			completedAt: new Date(index * 1_000).toISOString(),
			id: `workflow:history-${index.toString()}`,
			status: 'completed',
			updatedAt: new Date(index * 1_000).toISOString(),
		}))
		compactDurableState(state)
		expect(state.workflows).toHaveLength(MAXIMUM_TERMINAL_WORKFLOW_COUNT)
		expect(state.workflows.some(candidate => candidate.id === 'workflow:history-0')).toBe(false)
		expect(state.workflows.some(candidate => candidate.id === `workflow:history-${(MAXIMUM_TERMINAL_WORKFLOW_COUNT + 1).toString()}`)).toBe(true)
	})

	test('bounds abandoned unsigned workflow history for indefinite operation', () => {
		const state = initialDurableState(1)
		state.workflows = Array.from({ length: MAXIMUM_TERMINAL_WORKFLOW_COUNT + 2 }, (_, index) => ({
			...workflow(),
			completedAt: new Date(index * 1_000).toISOString(),
			id: `workflow:abandoned-${index.toString()}`,
			status: 'abandoned' as const,
			updatedAt: new Date(index * 1_000).toISOString(),
		}))
		compactDurableState(state)
		expect(state.workflows).toHaveLength(MAXIMUM_TERMINAL_WORKFLOW_COUNT)
		expect(state.workflows.some(candidate => candidate.id === 'workflow:abandoned-0')).toBe(false)
	})

	test('retains compact lifecycle tombstones when rich terminal history is pruned', () => {
		const state = initialDurableState(1)
		const terminalWorkflow = workflow()
		terminalWorkflow.status = 'completed'
		terminalWorkflow.completedAt = createdAt
		state.workflows = [terminalWorkflow]
		state.obligations = [
			{
				attemptCount: 1,
				blockers: [],
				completedAt: createdAt,
				createdAt,
				ecosystem: 'open-oracle',
				id: 'obligation:test',
				label: 'Settle report',
				metadata: { reportId: '1' },
				operationId: 'open-oracle.settle',
				status: 'completed',
				updatedAt: createdAt,
				workflowId: terminalWorkflow.id,
			},
		]
		compactDurableState(state)
		expect(state.obligationTombstones).toEqual([
			{
				id: 'obligation:test',
				resolution: 'completed',
				resolvedAt: createdAt,
				resolvedAtBlock: '1',
			},
		])
	})

	test('serializes concurrent saves per resolved path and snapshots each invocation', async () => {
		const path = await statePath()
		let releaseFirstRename: () => void = () => {
			throw new Error('First rename release was not initialized')
		}
		const firstRenameReleased = new Promise<void>(resolvePromise => {
			releaseFirstRename = resolvePromise
		})
		let markFirstRenameStarted: () => void = () => {
			throw new Error('First rename start was not initialized')
		}
		const firstRenameStarted = new Promise<void>(resolvePromise => {
			markFirstRenameStarted = resolvePromise
		})
		let renameCount = 0
		const filesystem: StateFilesystem = {
			mkdir,
			open,
			readFile,
			readdir,
			rename: async (oldPath, newPath) => {
				renameCount += 1
				if (renameCount === 1) {
					markFirstRenameStarted()
					await firstRenameReleased
				}
				await rename(oldPath, newPath)
			},
			rm,
		}
		const state = initialDurableState(1)
		state.activities = [{ at: createdAt, message: 'first invocation', status: 'info', type: 'operation' }]
		const firstSave = saveDurableState(path, state, filesystem)
		await firstRenameStarted
		state.activities = [{ at: createdAt, message: 'second invocation', status: 'info', type: 'operation' }]
		const secondSave = saveDurableState(path, state, filesystem)
		state.activities = [{ at: createdAt, message: 'mutation after invocation', status: 'info', type: 'operation' }]
		await Promise.resolve()
		expect(renameCount).toBe(1)
		releaseFirstRename()
		await Promise.all([firstSave, secondSave])
		expect((await loadDurableState(path, 1)).activities[0]?.message).toBe('second invocation')
	})
})
