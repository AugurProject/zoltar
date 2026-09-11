import { chmod, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import {
	DURABLE_STATE_VERSION,
	MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT,
	MAXIMUM_TERMINAL_WORKFLOW_COUNT,
	bindRuntimeStateToSigner,
	compactDurableState,
	initialDurableState,
	initialRuntimeState,
	setRuntimeExecutionAddress,
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
import { acceptResidualProfileReplacement } from '../../src/state/retirement.ts'

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
		auctionRefunds: {},
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
		schemaVersion: 3,
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
					{ amount: '2', category: 'rep', kind: 'security-pool-vault-rep', pool: emitter, vault: privateKeyToAccount(`0x${'11'.repeat(32)}`).address },
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

	test('rejects an active keyless retirement targeting the configured signer before recovery or binding', async () => {
		const path = await statePath()
		const configuredSigner = privateKeyToAccount(`0x${'22'.repeat(32)}`).address
		const durable = initialDurableState(1, false, 'profile:test')
		durable.retirement.status = 'draining'
		durable.retirement.recipient = configuredSigner
		durable.retirement.requestedAt = createdAt
		const pendingRetirementWorkflow = workflow()
		pendingRetirementWorkflow.id = 'workflow:retirement-sweep'
		pendingRetirementWorkflow.operationId = 'retirement.sweep.native-last'
		pendingRetirementWorkflow.planId = 'retirement.sweep.native-last:1'
		pendingRetirementWorkflow.status = 'planned'
		const pendingStep = pendingRetirementWorkflow.steps[0]
		if (pendingStep === undefined) throw new Error('Expected retirement workflow step')
		pendingStep.status = 'planned'
		pendingStep.transactionIntentId = undefined
		durable.workflows = [pendingRetirementWorkflow]
		await saveDurableState(path, durable)

		let recoveryStateReturned = false
		await expect(
			loadRuntimeState(path, false, configuredSigner, 1).then(() => {
				recoveryStateReturned = true
			}),
		).rejects.toThrow('durable signer')
		expect(recoveryStateReturned).toBeFalse()
		const keylessRuntime = initialRuntimeState(false, undefined, 1, durable)
		expect(() => bindRuntimeStateToSigner(keylessRuntime, configuredSigner)).toThrow('durable signer')
		expect(keylessRuntime.signerAddress).toBeUndefined()
		expect(keylessRuntime.workflows[0]?.status).toBe('planned')
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

	test('strictly round-trips the bounded lifecycle presence blocker across restart', async () => {
		const path = await statePath()
		const state = initialDurableState(1)
		state.lifecyclePresenceBlocker = {
			count: 7,
			digest: `0x${'45'.repeat(32)}`,
			firstDefinitionId: 'statoblast.escalation.resume',
			firstEcosystem: 'statoblast',
			observedAtBlock: '88',
			presenceComplete: true,
			reason: 'unplanned-due-identity',
		}
		state.obligationTombstones = [
			{
				id: 'obligation:completed-reorg-sentinel',
				observedAbsentAtBlock: '89',
				resolution: 'completed',
				resolvedAt: createdAt,
				resolvedAtBlock: '88',
			},
		]

		await saveDurableState(path, state)
		const restored = await loadDurableState(path, 1)
		expect(restored.lifecyclePresenceBlocker).toEqual(state.lifecyclePresenceBlocker)
		expect(restored.obligationTombstones).toEqual(state.obligationTombstones)

		state.lifecyclePresenceBlocker = { ...state.lifecyclePresenceBlocker, historyStartBlock: '42', requiresCarryHistory: true, presenceComplete: false }
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).lifecyclePresenceBlocker).toEqual(state.lifecyclePresenceBlocker)
		const validBlocker = state.lifecyclePresenceBlocker
		state.lifecyclePresenceBlocker = { ...validBlocker, historyStartBlock: '89' }
		await expect(saveDurableState(path, state)).rejects.toThrow('after its observation')
		state.lifecyclePresenceBlocker = { ...validBlocker, count: MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT + 1 }
		await expect(saveDurableState(path, state)).rejects.toThrow('identity safety limit')
		expect((await loadDurableState(path, 1)).lifecyclePresenceBlocker).toEqual(validBlocker)

		const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		stored['version'] = DURABLE_STATE_VERSION - 2
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('version is unsupported')
	})

	test('migrates version 3 state to an inactive retirement journal', async () => {
		const path = await statePath()
		await saveDurableState(path, initialDurableState(1))
		const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		stored['version'] = 3
		delete stored['retirement']
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		const restored = await loadDurableState(path, 1)
		expect(restored.version).toBe(4)
		expect(restored.retirement).toMatchObject({ blockers: [], lastObservedBalances: {}, positions: [], status: 'inactive' })
	})

	test('migrates balance evidence and restarts durably from every retirement phase', async () => {
		const path = await statePath()
		const state = initialDurableState(1)
		for (const status of ['requested', 'draining', 'waiting', 'blocked', 'drained', 'drained-with-residuals'] as const) {
			state.retirement.status = status
			state.retirement.completionEvidence =
				status === 'drained' || status === 'drained-with-residuals'
					? {
							blockHash: topic0,
							blockNumber: '50',
							completedAt: createdAt,
							proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
							residuals: status === 'drained' ? [] : [{ amount: '1', asset: 'dust', category: 'accepted-dust', reason: 'Accepted test dust' }],
						}
					: undefined
			state.retirement.lastObservedBalances = { ETH: '9' }
			state.retirement.recoveredBalances = { ETH: '4' }
			await saveDurableState(path, state)
			const restored = await loadDurableState(path, 1)
			expect(restored.retirement).toMatchObject({ lastObservedBalances: { ETH: '9' }, recoveredBalances: { ETH: '4' }, status })
		}
		const stored = JSON.parse(await readFile(path, 'utf8')) as { retirement: Record<string, unknown> }
		delete stored.retirement['lastObservedBalances']
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		expect((await loadDurableState(path, 1)).retirement.lastObservedBalances).toEqual({})
	})

	test('fails closed when persisted retirement state targets zero or the durable signer', async () => {
		const path = await statePath()
		const signer = getAddress('0x0000000000000000000000000000000000000099')
		const state = initialDurableState(1, true, 'profile:test', signer)
		await saveDurableState(path, state)
		const stored = JSON.parse(await readFile(path, 'utf8')) as { retirement: Record<string, unknown> }
		stored.retirement['status'] = 'requested'
		stored.retirement['requestedAt'] = createdAt
		for (const recipient of [getAddress('0x0000000000000000000000000000000000000000'), signer]) {
			stored.retirement['recipient'] = recipient
			await writeFile(path, `${JSON.stringify(stored)}\n`)
			await expect(loadDurableState(path, 1)).rejects.toThrow(recipient === signer ? 'durable signer' : 'zero address')
		}
	})

	test('persists proof-bound residual replacement acceptance and discards the legacy unbound shape', async () => {
		const path = await statePath()
		const signer = getAddress('0x0000000000000000000000000000000000000021')
		const state = initialDurableState(1, true, 'profile:test', signer)
		state.profileId = 'profile:test'
		state.retirement.status = 'drained-with-residuals'
		state.retirement.recipient = emitter
		state.retirement.completionEvidence = {
			blockHash: topic0,
			blockNumber: '50',
			completedAt: createdAt,
			profileId: state.profileId,
			proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
			residuals: [{ amount: '1', asset: 'dust', category: 'accepted-dust', reason: 'Accepted test dust' }],
			signerAddress: signer,
		}
		acceptResidualProfileReplacement(state.retirement, state.profileId, 'profile:next', 'Reviewed current residual assets.', 'ACCEPT RESIDUALS FOR profile:next', createdAt)
		await saveDurableState(path, state)
		const restored = await loadDurableState(path, 1)
		expect(restored.retirement.profileReplacementOverride).toEqual(state.retirement.profileReplacementOverride)

		const stored = JSON.parse(await readFile(path, 'utf8')) as { retirement: Record<string, unknown> }
		const boundOverride = stored.retirement['profileReplacementOverride'] as Record<string, unknown>
		boundOverride['completionBlockNumber'] = '51'
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('does not match current completion evidence')

		stored.retirement['profileReplacementOverride'] = { acceptedAt: createdAt, reason: 'Legacy unbound acceptance.', targetProfileId: 'profile:next' }
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		expect((await loadDurableState(path, 1)).retirement.profileReplacementOverride).toBeUndefined()
	})

	test('rejects retirement completion states whose canonical evidence is missing or inconsistent', async () => {
		const path = await statePath()
		const state = initialDurableState(1)
		await saveDurableState(path, state)
		const original = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		const completionEvidence = {
			blockHash: topic0,
			blockNumber: '50',
			completedAt: createdAt,
			proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
			residuals: [],
		}
		const writeRetirement = async (status: string, evidence?: unknown) => {
			const candidate = structuredClone(original)
			const retirement = candidate['retirement'] as Record<string, unknown>
			retirement['status'] = status
			if (evidence === undefined) delete retirement['completionEvidence']
			else retirement['completionEvidence'] = evidence
			await writeFile(path, `${JSON.stringify(candidate)}\n`)
		}
		await writeRetirement('drained')
		await expect(loadDurableState(path, 1)).rejects.toThrow('requires completion evidence')
		await writeRetirement('draining', completionEvidence)
		await expect(loadDurableState(path, 1)).rejects.toThrow('cannot retain completion evidence')
		await writeRetirement('drained', { ...completionEvidence, residuals: [{ amount: '1', asset: 'dust', category: 'accepted-dust', reason: 'Accepted test dust' }] })
		await expect(loadDurableState(path, 1)).rejects.toThrow('requires zero residuals')
		await writeRetirement('drained-with-residuals', completionEvidence)
		await expect(loadDurableState(path, 1)).rejects.toThrow('requires at least one residual')
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
			{ amount: '2', category: 'rep', kind: 'security-pool-vault-rep', pool: emitter, vault: privateKeyToAccount(`0x${'11'.repeat(32)}`).address },
		])
		expect((await stat(path)).mode & 0o777).toBe(0o600)
	})

	test('strictly round-trips a canonical terminal submission fee ceiling', async () => {
		const path = await statePath()
		const state = await populatedState()
		const durableWorkflow = state.workflows[0]
		const pendingTransaction = state.pendingTransactions[0]
		if (durableWorkflow === undefined || pendingTransaction === undefined) throw new Error('Expected a populated workflow')
		durableWorkflow.terminalSubmission = {
			kind: 'private-next-block',
			maximumFeePerGas: '2000000002',
		}
		pendingTransaction.mode = 'private'
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).workflows[0]?.terminalSubmission).toEqual(durableWorkflow.terminalSubmission)

		const stored = JSON.parse(await readFile(path, 'utf8')) as { pendingTransactions: Array<Record<string, unknown>>; workflows: Array<Record<string, unknown>> }
		const storedWorkflow = stored.workflows[0]
		const storedTransaction = stored.pendingTransactions[0]
		if (storedWorkflow === undefined || storedTransaction === undefined) throw new Error('Expected a persisted workflow')
		storedTransaction['mode'] = 'public'
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('terminal private-submission workflow')

		storedTransaction['mode'] = 'private'
		storedWorkflow['terminalSubmission'] = { kind: 'private-next-block', maximumFeePerGas: '01' }
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('maximumFeePerGas')

		storedWorkflow['terminalSubmission'] = { kind: 'private-next-block', maximumFeePerGas: (1n << 256n).toString() }
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('exceeds uint256')
	})

	test('round-trips a finalized lifecycle receipt waiting for canonical confirmation', async () => {
		const path = await statePath()
		const durableWorkflow = workflow()
		const targetAttoRep = 100n.toString()
		const step = durableWorkflow.steps[0]
		const evidence = step?.evidence[0]
		if (step === undefined || evidence?.kind !== 'decoded-event-field') throw new Error('Expected decoded lifecycle event evidence')
		durableWorkflow.classification = 'lifecycle-obligation'
		durableWorkflow.ecosystem = 'statoblast'
		durableWorkflow.label = 'Fork workflow: migrate-rep'
		durableWorkflow.metadata = { outcome: '0', pool: emitter, targetAttoRep }
		durableWorkflow.obligation = true
		durableWorkflow.operationId = 'statoblast.fork.migrate-rep'
		durableWorkflow.planId = 'plan:migrate-rep'
		durableWorkflow.priority = 'urgent'
		durableWorkflow.risk = 'irreversible'
		durableWorkflow.status = 'waiting-obligation'
		delete durableWorkflow.semanticDeadlineBlockNumber
		step.confirmedAt = createdAt
		step.evidence = [{ ...evidence, canonicalLifecycleConfirmation: true }]
		step.status = 'confirmed'
		step.transactionHash = topic0
		delete step.transactionIntentId

		const state = initialDurableState(1, false, 'profile:test')
		state.workflows = [durableWorkflow]
		state.obligations = [
			{
				automaticRetryCount: 0,
				attemptCount: 1,
				blockers: ['A finalized transaction is waiting for complete canonical lifecycle confirmation'],
				createdAt,
				ecosystem: 'statoblast',
				id: 'obligation:rep-migration',
				label: durableWorkflow.label,
				metadata: durableWorkflow.metadata,
				operationId: durableWorkflow.operationId,
				status: 'pending',
				updatedAt: createdAt,
				workflowId: durableWorkflow.id,
			},
		]

		await saveDurableState(path, state)
		const restored = await loadDurableState(path, 1)
		expect(restored.workflows[0]?.status).toBe('waiting-obligation')
		expect(restored.workflows[0]?.steps[0]).toMatchObject({ status: 'confirmed', transactionHash: topic0 })
		expect(restored.workflows[0]?.steps[0]?.evidence[0]).toMatchObject({ canonicalLifecycleConfirmation: true, kind: 'decoded-event-field' })
		expect(restored.obligations[0]).toMatchObject({ status: 'pending', workflowId: durableWorkflow.id })

		const malformed = JSON.parse(await readFile(path, 'utf8')) as { workflows: Array<Record<string, unknown>> }
		const malformedWorkflow = malformed.workflows[0]
		if (malformedWorkflow === undefined) throw new Error('Expected a persisted waiting workflow')
		malformedWorkflow['classification'] = 'selectable'
		await writeFile(path, `${JSON.stringify(malformed)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('outside a lifecycle obligation')

		malformedWorkflow['status'] = 'running'
		await writeFile(path, `${JSON.stringify(malformed)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('uses canonical lifecycle confirmation outside a lifecycle obligation')
	})

	test('strictly round-trips a deferred lifecycle obligation', async () => {
		const path = await statePath()
		const state = await populatedState()
		const durableWorkflow = state.workflows[0]
		if (durableWorkflow === undefined) throw new Error('Expected a populated workflow')
		durableWorkflow.classification = 'lifecycle-obligation'
		durableWorkflow.obligation = true
		state.obligations = [
			{
				automaticRetryCount: 0,
				attemptCount: 0,
				blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
				createdAt,
				ecosystem: durableWorkflow.ecosystem,
				id: 'obligation:deferred',
				label: durableWorkflow.label,
				metadata: durableWorkflow.metadata,
				operationId: durableWorkflow.operationId,
				status: 'deferred',
				updatedAt: createdAt,
				workflowId: durableWorkflow.id,
			},
		]

		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).obligations[0]).toMatchObject({
			automaticRetryCount: 0,
			blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
			status: 'deferred',
			workflowId: durableWorkflow.id,
		})

		const stored = JSON.parse(await readFile(path, 'utf8')) as { obligations: Array<Record<string, unknown>> }
		const storedObligation = stored.obligations[0]
		if (storedObligation === undefined) throw new Error('Expected a persisted obligation')
		delete storedObligation['automaticRetryCount']
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		expect((await loadDurableState(path, 1)).obligations[0]?.automaticRetryCount).toBe(0)

		storedObligation['status'] = 'waiting'
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('obligations[0].status is invalid')
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

	test('strictly round-trips a cleanup-only continuation disposition', async () => {
		const path = await statePath()
		const state = await populatedState()
		state.pendingTransactions = []
		const durableWorkflow = state.workflows[0]
		if (durableWorkflow === undefined) throw new Error('Expected a populated workflow')
		const durableStep = durableWorkflow.steps[0]
		if (durableStep === undefined) throw new Error('Expected a populated workflow step')
		const confirmedPreparation = {
			...durableStep,
			confirmedAt: createdAt,
			id: 'confirmed-preparation',
			status: 'confirmed' as const,
		}
		delete confirmedPreparation.transactionIntentId
		durableWorkflow.continuationDisposition = 'cleanup-only'
		durableWorkflow.status = 'waiting-continuation'
		durableStep.failure = 'Finalized receipt reverted before cleanup'
		durableStep.failureKind = 'receipt-reverted'
		durableStep.status = 'blocked'
		durableWorkflow.steps = [confirmedPreparation, durableStep]
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).workflows[0]?.continuationDisposition).toBe('cleanup-only')

		const stored = JSON.parse(await readFile(path, 'utf8')) as { workflows: Array<Record<string, unknown>> }
		const storedWorkflow = stored.workflows[0]
		if (storedWorkflow === undefined) throw new Error('Expected a persisted workflow')
		storedWorkflow['continuationDisposition'] = 'retry-action'
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('continuationDisposition')
	})

	test('strictly round-trips the maximum cleanup transaction reservation', async () => {
		const path = await statePath()
		const state = await populatedState()
		const durableWorkflow = state.workflows[0]
		if (durableWorkflow === undefined) throw new Error('Expected a populated workflow')
		durableWorkflow.maximumCleanupTransactionCount = 2
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).workflows[0]?.maximumCleanupTransactionCount).toBe(2)

		const stored = JSON.parse(await readFile(path, 'utf8')) as { workflows: Array<Record<string, unknown>> }
		const storedWorkflow = stored.workflows[0]
		if (storedWorkflow === undefined) throw new Error('Expected a persisted workflow')
		storedWorkflow['maximumCleanupTransactionCount'] = -1
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('maximumCleanupTransactionCount')

		storedWorkflow['maximumCleanupTransactionCount'] = 1.5
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('maximumCleanupTransactionCount')
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

	test('round-trips the latest pending transaction observation and rejects inconsistent ones', async () => {
		const path = await statePath()
		const state = await populatedState()
		const intent = state.pendingTransactions[0]
		if (intent === undefined) throw new Error('Expected a pending workflow fixture')
		intent.observation = { checkedAt: createdAt, head: 130n, includedBlock: 125n, kind: 'awaiting-finality' }
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).pendingTransactions[0]?.observation).toEqual({ checkedAt: createdAt, head: 130n, includedBlock: 125n, kind: 'awaiting-finality' })
		intent.observation = { checkedAt: createdAt, head: 130n, kind: 'in-mempool' }
		await saveDurableState(path, state)
		expect((await loadDurableState(path, 1)).pendingTransactions[0]?.observation).toEqual({ checkedAt: createdAt, head: 130n, kind: 'in-mempool' })
		const stored = JSON.parse(await readFile(path, 'utf8')) as { pendingTransactions: Array<Record<string, unknown>> }
		const storedTransaction = stored.pendingTransactions[0]
		if (storedTransaction === undefined) throw new Error('Expected a stored pending transaction')
		storedTransaction['observation'] = { checkedAt: createdAt, head: '130', includedBlock: '125', kind: 'in-mempool' }
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('includedBlock must accompany exactly the included kinds')
		storedTransaction['observation'] = { checkedAt: createdAt, head: '130', kind: 'included' }
		await writeFile(path, `${JSON.stringify(stored)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow('observation.kind is invalid')
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
				automaticRetryCount: 0,
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
			link,
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

test('invalidates inventory on execution address changes and removal, and never restores inventory', async () => {
	const first = getAddress('0x0000000000000000000000000000000000000001')
	const second = getAddress('0x0000000000000000000000000000000000000002')
	const state = initialRuntimeState(false, undefined, 1)
	expect(state.inventoryAddress).toBeUndefined()
	expect(state.wallet).toBeUndefined()
	setRuntimeExecutionAddress(state, first)
	state.inventory = { eth: '123', rep: [], weth: '456' }
	state.inventoryAddress = first
	state.lastScanAt = '2026-09-10T00:00:00.000Z'
	setRuntimeExecutionAddress(state, first)
	expect(state.inventory.eth).toBe('123')
	expect(state.inventoryAddress).toBe(first)
	setRuntimeExecutionAddress(state, second)
	expect(state.inventoryAddress).toBeUndefined()
	expect(state.inventory.eth).toBe('0')
	expect(state.lastScanAt).toBe('2026-09-10T00:00:00.000Z')
	state.inventoryAddress = second
	state.inventory.eth = '789'
	setRuntimeExecutionAddress(state, undefined)
	expect(state.inventoryAddress).toBeUndefined()
	expect(state.inventory.eth).toBe('0')
	bindRuntimeStateToSigner(state, first)
	state.inventoryAddress = first
	state.inventory.eth = '123'
	const path = await statePath()
	await saveDurableState(path, state)
	const restored = await loadRuntimeState(path, false, undefined, 1)
	expect(restored.wallet).toBe(first)
	expect(restored.inventoryAddress).toBeUndefined()
	expect(restored.inventory.eth).toBe('0')
	expect(await readFile(path, 'utf8')).not.toContain('inventory')
})
