import { describe, expect, test } from 'bun:test'
import { createSignerOperationGate, privateKeyToAccount, zeroAddress, zeroHash, type Hex } from '../support/bot-shared.ts'
import example from '../../config/operator.example.json'
import {
	assertSignerCompatibleWithPending,
	assertSignerCompatibleWithDurableScope,
	assertSettingsUpdatePaused,
	ConfigurationCommitIndeterminate,
	ConfigurationCommittedSafelyPaused,
	createChaosDashboardController,
	pausedCandidate,
	restartSafeSettings,
	settingsPatchCandidate,
	signerCandidateSettings,
} from '../../src/runtime/dashboard-controller.ts'
import { parseSettings, serializedSettings, type OperatorSettings } from '../../src/config/settings.ts'
import { bindRuntimeStateToSigner, initialDurableState, initialRuntimeState, type RuntimeState } from '../../src/state/operator-state.ts'
import { createDurableWorkflow, markWorkflowStepConfirmed } from '../../src/runtime/workflows.ts'
import type { OperationPlan } from '../../src/operations/types.ts'

function settings() {
	return parseSettings(example)
}

const firstPrivateKey = `0x${'11'.repeat(32)}` as Hex
const secondPrivateKey = `0x${'22'.repeat(32)}` as Hex

function configuredSettings(paused: boolean, execute: boolean, privateKey = firstPrivateKey) {
	const deploymentAddress = '0x0000000000000000000000000000000000000001'
	return parseSettings({
		...example,
		connectivity: {
			publicRpcUrls: ['https://public.example'],
			quorumRpcUrls: ['https://quorum-one.example', 'https://quorum-two.example'],
			readRpcUrl: 'https://read.example',
			rpcQuorum: 2,
		},
		deployment: {
			openOracle: deploymentAddress,
			questionData: deploymentAddress,
			securityPoolFactory: deploymentAddress,
			securityPoolForker: deploymentAddress,
			tradingFactory: deploymentAddress,
			tradingRouter: deploymentAddress,
			weth: deploymentAddress,
			zoltar: deploymentAddress,
		},
		networkConfigured: true,
		paused,
		privateKey,
		runtime: { ...example.runtime, execute },
	})
}

function settingsUpdate(current: OperatorSettings, revision: string, execute: boolean, minimumDelaySeconds = current.scheduler.minimumDelaySeconds) {
	const serialized = serializedSettings(current)
	return {
		patch: {
			runtime: { execute },
			scheduler: {
				maximumDelaySeconds: serialized.scheduler.maximumDelaySeconds,
				minimumDelaySeconds,
			},
			strategy: serialized.strategy,
		},
		revision,
	}
}

function runtimeState(current: OperatorSettings) {
	return initialRuntimeState(current.paused, undefined, current.network.chainId, initialDurableState(current.network.chainId, current.paused))
}

const canonicalRepToken = '0x0000000000000000000000000000000000000002'

function completeSignerScan(state: RuntimeState, current: OperatorSettings, balances: { eth?: bigint | undefined; rep?: bigint | undefined } = {}) {
	if (current.privateKey === undefined) throw new Error('A signer-scoped test scan requires a private key')
	const wallet = privateKeyToAccount(current.privateKey).address
	bindRuntimeStateToSigner(state, wallet)
	state.inventory = {
		eth: (balances.eth ?? current.strategy.minimumEthReserveAttoEth + current.strategy.maximumGasCostAttoEth).toString(),
		rep: [
			{
				balance: (balances.rep ?? current.strategy.minimumRepReserveAttoRep).toString(),
				symbol: 'REP',
				token: canonicalRepToken,
				universeId: 'root',
			},
		],
		weth: '0',
	}
	state.lastScanAt = '2026-08-29T00:00:00.000Z'
	state.lastScannedBlock = 42n
	state.topology = {
		anchor: { blockNumber: 42n, timestamp: 1_777_075_200n },
		auctions: [],
		complete: true,
		pairs: [],
		pools: [],
		reports: [],
		universes: [{ forkQuestionId: zeroHash, forkTime: '0', id: 'root', knownChildOutcomeCount: 0, repToken: canonicalRepToken }],
	}
}

function noopController(current: OperatorSettings, state: RuntimeState) {
	const configuration = { path: '/tmp/unused-chaos-config.json', rememberSigner: true, revision: 'revision', settings: current }
	let revision = 0
	return {
		configuration,
		controller: createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async () => {
				revision += 1
				return `revision:${revision.toString()}`
			},
			saveState: async () => undefined,
			state,
		}),
	}
}

async function captureFailure(operation: () => unknown | Promise<unknown>): Promise<unknown> {
	try {
		await operation()
	} catch (error) {
		return error
	}
	throw new Error('Expected dashboard operation to fail')
}

describe('chaos dashboard configuration boundary', () => {
	test('groups concrete lifecycle candidates into one classified catalog row', async () => {
		const current = settings()
		const state = runtimeState(current)
		const definition = {
			classification: 'lifecycle-obligation' as const,
			contract: 'OpenOracle',
			description: 'Settle every due report',
			discoveryInputs: ['report', 'report'],
			ecosystem: 'open-oracle' as const,
			id: 'open-oracle.settle',
			label: 'Settle report',
			method: 'settle',
			risk: 'low' as const,
		}
		const plan = (id: string): OperationPlan => ({
			classification: 'lifecycle-obligation',
			createdAtBlock: '10',
			definitionId: definition.id,
			ecosystem: definition.ecosystem,
			id,
			label: definition.label,
			metadata: { reportId: id },
			obligation: true,
			planningSeed: 1,
			postconditions: [],
			priority: 'urgent',
			risk: 'low',
			steps: [],
		})
		state.evaluations = [
			{ definition, eligibility: { blockers: ['due report', 'due report'], eligible: true }, plan: plan('report:1') },
			{ definition, eligibility: { blockers: ['second report'], eligible: true }, plan: plan('report:2') },
		]
		const controller = createChaosDashboardController({
			configuration: { path: '/tmp/unused-chaos-config.json', rememberSigner: false, revision: 'revision', settings: current },
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			state,
		})

		expect(await controller.getState()).toMatchObject({
			operationEvaluations: [
				{
					blockers: ['due report', 'second report'],
					candidateCount: 2,
					classification: 'lifecycle-obligation',
					eligible: true,
					id: definition.id,
					prerequisites: ['report'],
				},
			],
		})
	})

	test('distinguishes unavailable pre-scan inventory and a durable safety pause', async () => {
		const current = settings()
		const state = runtimeState(current)
		state.safetyPaused = true
		state.paused = true
		state.error = undefined
		const controller = createChaosDashboardController({
			configuration: { path: '/tmp/unused-chaos-config.json', rememberSigner: false, revision: 'revision', settings: current },
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			state,
		})

		expect(await controller.getState()).toMatchObject({
			alerts: [{ message: expect.stringContaining('Safety pause'), severity: 'error' }],
			inventoryAvailable: false,
			safetyPaused: true,
		})

		state.lastScanAt = '2026-08-29T00:00:00.000Z'
		expect(await controller.getState()).toMatchObject({ inventoryAvailable: true })
	})

	test('keeps a deferred lifecycle obligation in the dashboard state', async () => {
		const current = settings()
		const state = runtimeState(current)
		state.obligations = [
			{
				attemptCount: 1,
				automaticRetryCount: 1,
				blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
				createdAt: '2026-08-29T00:00:00.000Z',
				ecosystem: 'statoblast',
				id: 'obligation:future-auction',
				label: 'Future auction settlement',
				metadata: { auction: '0x0000000000000000000000000000000000000001' },
				notBefore: '2026-08-29T00:03:00.000Z',
				operationId: 'statoblast.auction.settle',
				status: 'deferred',
				updatedAt: '2026-08-29T00:00:00.000Z',
				workflowId: 'workflow:future-auction',
			},
		]
		const controller = createChaosDashboardController({
			configuration: { path: '/tmp/unused-chaos-config.json', rememberSigner: false, revision: 'revision', settings: current },
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			state,
		})

		expect(await controller.getState()).toMatchObject({
			obligations: [
				{
					attemptCount: 1,
					automaticRetryCount: 1,
					automaticRetryLimit: 3,
					blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
					id: 'obligation:future-auction',
					notBefore: '2026-08-29T00:03:00.000Z',
					status: 'deferred',
				},
			],
		})
	})

	test('surfaces a durable unplanned lifecycle presence blocker before the next scan', async () => {
		const current = settings()
		const state = runtimeState(current)
		state.error = undefined
		state.lifecyclePresenceBlocker = {
			count: 3,
			digest: `0x${'45'.repeat(32)}`,
			firstDefinitionId: 'statoblast.escalation.resume',
			firstEcosystem: 'statoblast',
			observedAtBlock: '88',
			presenceComplete: true,
			reason: 'unplanned-due-identity',
		}
		const controller = createChaosDashboardController({
			configuration: { path: '/tmp/unused-chaos-config.json', rememberSigner: false, revision: 'revision', settings: current },
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			state,
		})

		expect(await controller.getState()).toMatchObject({
			alerts: [
				{
					message: expect.stringContaining('Complete canonical lifecycle discovery at block 88 contained 3 unplanned due identities, beginning with statoblast.escalation.resume (statoblast)'),
					severity: 'error',
				},
			],
		})

		state.lifecyclePresenceBlocker.presenceComplete = false
		expect(await controller.getState()).toMatchObject({
			alerts: [{ message: expect.stringContaining('Incomplete canonical lifecycle discovery at block 88 exposed at least 3 unplanned due identities'), severity: 'error' }],
		})
	})

	test('validates the full execution-policy patch through the canonical parser', () => {
		const candidate = settingsPatchCandidate(settings(), {
			patch: {
				runtime: { execute: false },
				scheduler: { maximumDelaySeconds: 180, minimumDelaySeconds: 90 },
				strategy: {
					allowHighRiskOperations: false,
					allowIrreversibleOperations: false,
					enabledEcosystems: ['zoltar', 'open-oracle'],
					maximumEthPerOperation: '0.01',
					maximumGasCostEth: '0.005',
					maximumRepPerOperation: '1',
					minimumEthReserve: '0.1',
					minimumRepReserve: '2',
					selectableOperationAllowlist: ['open-oracle.weth.wrap'],
					workflowValidForBlocks: 288,
				},
			},
			revision: 'revision',
		})
		expect(candidate.settings.scheduler).toEqual({ maximumDelaySeconds: 180, minimumDelaySeconds: 90 })
		expect(candidate.settings.strategy.enabledEcosystems).toEqual(['zoltar', 'open-oracle'])
		expect(candidate.settings.strategy.selectableOperationAllowlist).toEqual(['open-oracle.weth.wrap'])
	})

	test('rejects a dashboard transition from single-reader dry run to live execution', () => {
		const configured = configuredSettings(true, false)
		const singleReader = parseSettings({
			...serializedSettings(configured),
			connectivity: {
				publicRpcUrls: ['https://public.example'],
				quorumRpcUrls: [],
				readRpcUrl: 'https://read.example',
				rpcQuorum: 1,
			},
		})

		expect(() => settingsPatchCandidate(singleReader, settingsUpdate(singleReader, 'revision', true))).toThrow('Live execution requires RPC quorum 2 with three independent read origins')
		expect(settingsPatchCandidate(singleReader, settingsUpdate(singleReader, 'revision', false)).settings.connectivity).toMatchObject({
			quorumRpcUrls: [],
			rpcQuorum: 1,
		})
	})

	test('requires both persisted and runtime pause before any execution-policy change', () => {
		const running = configuredSettings(false, false)
		const paused = configuredSettings(true, false)

		expect(() => assertSettingsUpdatePaused(running, false)).toThrow('changing execution policy')
		expect(() => assertSettingsUpdatePaused(paused, true)).not.toThrow()
		expect(() => assertSettingsUpdatePaused(paused, false)).toThrow('running chaos bot')
	})

	test('rejects a direct settings mutation while running before persistence', async () => {
		const current = configuredSettings(false, false)
		const state = runtimeState(current)
		let persisted = false
		const controller = createChaosDashboardController({
			configuration: { path: '/tmp/unused-chaos-config.json', rememberSigner: true, revision: 'revision', settings: current },
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async () => {
				persisted = true
				return 'unexpected-revision'
			},
			state,
		})

		await expect(controller.setSettings(settingsUpdate(current, 'revision', false, 90))).rejects.toThrow('changing execution policy')
		expect(persisted).toBeFalse()
	})

	test('invalidates a keyless wallet index during the first dashboard signer binding', async () => {
		const current = settings()
		const state = runtimeState(current)
		state.protocolIndex = {
			auctionBids: {},
			auctionRefunds: {},
			chainId: current.network.chainId,
			childRepSplits: [],
			cursor: { blockHash: zeroHash, blockNumber: current.runtime.protocolStartBlock.toString() },
			escalationDeposits: [],
			migrationRepSplits: [],
			openOracle: current.deployment.openOracle,
			reports: [],
			schemaVersion: 3,
			securityPoolForker: current.deployment.securityPoolForker,
			startBlock: current.runtime.protocolStartBlock.toString(),
			wallet: zeroAddress,
			zoltar: current.deployment.zoltar,
		}
		state.inventory = {
			eth: '1000000000000000000',
			rep: [{ balance: '1000000000000000000', symbol: 'REP', token: canonicalRepToken, universeId: 'root' }],
			weth: '1000000000000000000',
		}
		state.lastScanAt = '2026-08-29T00:00:00.000Z'
		state.lastScannedBlock = 42n
		state.topology = {
			anchor: { blockNumber: 42n, timestamp: 1_777_075_200n },
			auctions: [],
			complete: true,
			pairs: [],
			pools: [],
			reports: [],
			universes: [{ forkQuestionId: zeroHash, forkTime: '0', id: 'root', knownChildOutcomeCount: 0, repToken: canonicalRepToken }],
		}
		state.warnings = ['Keyless scan warning']
		const configuration = { path: '/tmp/unused-chaos-config.json', rememberSigner: false, revision: 'revision', settings: current }
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async () => 'next-revision',
			saveState: async () => undefined,
			state,
		})

		await controller.setSigner({ privateKey: firstPrivateKey, remember: true, revision: 'revision' })

		expect(state.signerAddress).toBe(privateKeyToAccount(firstPrivateKey).address)
		expect(state.protocolIndex).toBeUndefined()
		expect(state.inventory).toEqual({ eth: '0', rep: [], weth: '0' })
		expect(state.lastScanAt).toBeUndefined()
		expect(state.lastScannedBlock).toBeUndefined()
		expect(state.topology).toBeUndefined()
		expect(state.warnings).toEqual([])
		expect(state.activities[0]?.message).toContain('wallet-scoped protocol index invalidated')
	})

	test('requires a complete current-signer scan before live resume', async () => {
		const current = configuredSettings(true, true)
		const state = runtimeState(current)
		if (current.privateKey === undefined) throw new Error('Expected a configured signer')
		bindRuntimeStateToSigner(state, privateKeyToAccount(current.privateKey).address)
		state.lastScanAt = '2026-08-29T00:00:00.000Z'
		state.lastScannedBlock = 42n
		state.topology = {
			anchor: { blockNumber: 42n, timestamp: 1_777_075_200n },
			auctions: [],
			complete: false,
			pairs: [],
			pools: [],
			reports: [],
			universes: [],
		}
		const { controller } = noopController(current, state)

		await expect(controller.setPaused({ paused: false, revision: 'revision' })).rejects.toThrow('fresh, complete canonical scan for the configured signer')
		expect(state.paused).toBeTrue()
		expect(state.activities).toEqual([])
	})

	test('allows dry-run resume before the first canonical scan', async () => {
		const current = configuredSettings(true, false)
		const state = runtimeState(current)
		const { configuration, controller } = noopController(current, state)

		await controller.setPaused({ paused: false, revision: 'revision' })

		expect(configuration.settings.paused).toBeFalse()
		expect(state.paused).toBeFalse()
		expect(state.status).toBe('dry-run')
	})

	test('rejects live enable when the scanned signer has no ETH', async () => {
		const current = configuredSettings(true, false)
		const state = runtimeState(current)
		completeSignerScan(state, current, { eth: 0n })
		const { controller } = noopController(current, state)

		await expect(controller.setSettings(settingsUpdate(current, 'revision', true))).rejects.toThrow('minimumEthReserve plus one strategy.maximumGasCostEth')
		expect(state.paused).toBeTrue()
		expect(state.activities).toEqual([])
	})

	test('rejects live enable when the scanned signer has no canonical REP', async () => {
		const current = configuredSettings(true, false)
		const state = runtimeState(current)
		completeSignerScan(state, current, { rep: 0n })
		const { controller } = noopController(current, state)

		await expect(controller.setSettings(settingsUpdate(current, 'revision', true))).rejects.toThrow('canonical REP inventory balance')
		expect(state.paused).toBeTrue()
		expect(state.activities).toEqual([])
	})

	test('enables and resumes live execution from an exactly funded current-signer scan', async () => {
		const current = configuredSettings(true, false)
		const state = runtimeState(current)
		completeSignerScan(state, current)
		const { configuration, controller } = noopController(current, state)

		await controller.setSettings(settingsUpdate(current, 'revision', true))
		expect(configuration.settings.runtime.execute).toBeTrue()
		expect(configuration.revision).toBe('revision:1')
		await controller.setPaused({ paused: false, revision: 'revision:1' })

		expect(configuration.settings.paused).toBeFalse()
		expect(state.paused).toBeFalse()
		expect(state.status).toBe('running')
	})

	test('requires CAS-shaped pause and signer updates', () => {
		expect(pausedCandidate(settings(), { paused: true, revision: 'one' }).settings.paused).toBeTrue()
		expect(() => pausedCandidate(settings(), { paused: true })).toThrow('missing revision')
		const key = `0x${'11'.repeat(32)}` as Hex
		const signed = signerCandidateSettings(settings(), { privateKey: key, remember: false, revision: 'one' })
		expect(signed.settings.privateKey).toBe(key)
		expect(signed.rememberSigner).toBeFalse()
	})

	test('clears a live signer as one paused dry-run update', () => {
		const key = `0x${'11'.repeat(32)}` as Hex
		const configured = settings()
		const live = {
			...configured,
			paused: false,
			privateKey: key,
			runtime: { ...configured.runtime, execute: true },
		}
		const cleared = signerCandidateSettings(live, {
			privateKey: null,
			remember: false,
			revision: 'one',
		})
		expect(cleared.settings.privateKey).toBeUndefined()
		expect(cleared.settings.paused).toBeTrue()
		expect(cleared.settings.runtime.execute).toBeFalse()
	})

	test('never persists memory-only live credentials or an unrestartable live mode', () => {
		const key = `0x${'11'.repeat(32)}` as Hex
		const current = signerCandidateSettings(settings(), { privateKey: key, remember: false, revision: 'one' }).settings
		const live = { ...current, paused: false, runtime: { ...current.runtime, execute: true } }
		const persisted = restartSafeSettings(live, false)
		expect(persisted.privateKey).toBeUndefined()
		expect(persisted.paused).toBeTrue()
		expect(persisted.runtime.execute).toBeFalse()
	})

	test('durably latches a busy pause request until an explicit resume', async () => {
		const current = configuredSettings(false, true)
		const state = initialRuntimeState(false, undefined, current.network.chainId, initialDurableState(current.network.chainId, false))
		const gate = createSignerOperationGate()
		expect(gate.acquire('scan')).toBeTrue()
		let persistedSafetyPause = false
		const controller = createChaosDashboardController({
			configuration: {
				path: '/tmp/unused-chaos-config.json',
				rememberSigner: false,
				revision: 'revision',
				settings: current,
			},
			gate,
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveState: async (_path, candidate) => {
				persistedSafetyPause = candidate.safetyPaused
			},
			state,
		})

		await controller.setPaused({ paused: true, revision: 'revision' })

		expect(persistedSafetyPause).toBeTrue()
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
		expect(current.paused).toBeFalse()
		gate.release('scan')
	})

	test('retains the exact recovery signer while a signed intent is pending', () => {
		const sender = '0x0000000000000000000000000000000000000001'
		expect(() => assertSignerCompatibleWithPending(sender, sender)).not.toThrow()
		expect(() => assertSignerCompatibleWithPending(sender, undefined)).toThrow('cannot be cleared or replaced')
		expect(() => assertSignerCompatibleWithPending(sender, '0x0000000000000000000000000000000000000002')).toThrow('cannot be cleared or replaced')
	})

	test('keeps a durable state file scoped to one signer across memory-only restarts', () => {
		const recorded = '0x0000000000000000000000000000000000000001'
		expect(() => assertSignerCompatibleWithDurableScope(recorded, undefined)).not.toThrow()
		expect(() => assertSignerCompatibleWithDurableScope(recorded, recorded)).not.toThrow()
		expect(() => assertSignerCompatibleWithDurableScope(recorded, '0x0000000000000000000000000000000000000002')).toThrow('distinct state file')
	})

	test('commits a queued replacement only after durable persistence succeeds', async () => {
		const current = settings()
		const sender = '0x0000000000000000000000000000000000000001'
		const state = initialRuntimeState(true, sender, current.network.chainId, initialDurableState(current.network.chainId, true, 'profile:test', sender))
		const intentHash = `0x${'11'.repeat(32)}` as Hex
		const replacementHash = `0x${'22'.repeat(32)}` as Hex
		state.pendingTransactions = [
			{
				data: '0x',
				hash: intentHash,
				id: 'intent:test',
				label: 'Test intent',
				maxBlockNumber: 100n,
				mode: 'public',
				nonce: 0n,
				operationId: 'open-oracle.test',
				semanticExpectation: {
					balanceBaselines: [],
					evidence: [{ kind: 'receipt-success' }],
					postconditions: [],
					storageBaselines: [],
				},
				sender,
				serializedTransaction: '0x02',
				signedAt: '2026-08-24T00:00:00.000Z',
				status: 'signed',
				stepId: 'step:test',
				to: '0x0000000000000000000000000000000000000002',
				value: 0n,
				workflowId: 'workflow:test',
			},
		]
		const controller = createChaosDashboardController({
			configuration: {
				path: '/tmp/unused-chaos-config.json',
				rememberSigner: false,
				revision: 'revision',
				settings: current,
			},
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveState: async () => {
				throw new Error('injected persistence failure')
			},
			state,
		})
		await expect(controller.setReplacement({ intentHash, replacementHash })).rejects.toThrow('injected persistence failure')
		expect(state.pendingTransactions[0]?.replacementHash).toBeUndefined()
		expect(state.activities).toHaveLength(0)

		const durableController = createChaosDashboardController({
			configuration: {
				path: '/tmp/unused-chaos-config.json',
				rememberSigner: false,
				revision: 'revision',
				settings: current,
			},
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveState: async () => {},
			state,
		})
		await durableController.setReplacement({ intentHash, replacementHash })
		expect(state.pendingTransactions[0]?.replacementHash).toBe(replacementHash)
		expect(state.activities[0]?.hash).toBe(replacementHash)
	})

	test('queues and CAS-clears a strict nonce cancellation without changing the intent', async () => {
		const current = settings()
		const sender = '0x0000000000000000000000000000000000000001'
		const state = initialRuntimeState(true, sender, current.network.chainId, initialDurableState(current.network.chainId, true, 'profile:test', sender))
		const intentHash = `0x${'31'.repeat(32)}` as Hex
		const cancellationHash = `0x${'32'.repeat(32)}` as Hex
		state.pendingTransactions = [
			{
				data: '0x',
				hash: intentHash,
				id: 'intent:cancellation',
				label: 'Cancelable intent',
				maxBlockNumber: 100n,
				mode: 'public',
				nonce: 4n,
				operationId: 'trading.test',
				semanticExpectation: {
					balanceBaselines: [],
					evidence: [{ kind: 'receipt-success' }],
					postconditions: [],
					storageBaselines: [],
				},
				sender,
				serializedTransaction: '0x02',
				signedAt: '2026-08-24T00:00:00.000Z',
				status: 'signed',
				stepId: 'step:test',
				to: '0x0000000000000000000000000000000000000002',
				value: 0n,
				workflowId: 'workflow:test',
			},
		]
		const controller = createChaosDashboardController({
			configuration: {
				path: '/tmp/unused-chaos-config.json',
				rememberSigner: false,
				revision: 'revision',
				settings: current,
			},
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveState: async () => {},
			state,
		})
		await controller.setCancellation({
			cancellationHash,
			confirmation: 'VERIFY NONCE CANCELLATION',
			intentHash,
			reason: 'The original call is no longer viable',
		})
		expect(state.pendingTransactions[0]?.cancellationHash).toBe(cancellationHash)
		await expect(
			controller.setReplacement({
				intentHash,
				replacementHash: `0x${'34'.repeat(32)}`,
			}),
		).rejects.toThrow('cancellation verification is already queued')
		expect(state.pendingTransactions[0]?.replacementHash).toBeUndefined()
		await expect(
			controller.setCandidate({
				confirmation: 'CLEAR RECOVERY CANDIDATE',
				expectedCandidateHash: `0x${'33'.repeat(32)}`,
				intentHash,
				reason: 'Testing stale compare-and-swap input',
			}),
		).rejects.toThrow('candidate changed')
		expect(state.pendingTransactions[0]?.cancellationHash).toBe(cancellationHash)
		await controller.setCandidate({
			confirmation: 'CLEAR RECOVERY CANDIDATE',
			expectedCandidateHash: cancellationHash,
			intentHash,
			reason: 'The submitted cancellation hash was mistyped',
		})
		expect(state.pendingTransactions[0]?.cancellationHash).toBeUndefined()
		expect(state.pendingTransactions[0]?.hash).toBe(intentHash)
	})

	test('abandons only a paused partial random workflow after durable persistence', async () => {
		const current = settings()
		const state = initialRuntimeState(true, undefined, current.network.chainId, initialDurableState(current.network.chainId, true))
		const plan: OperationPlan = {
			classification: 'selectable',
			createdAtBlock: '10',
			definitionId: 'trading.test',
			ecosystem: 'trading',
			id: 'plan:partial',
			label: 'Partial trade',
			metadata: { pair: 'one' },
			obligation: false,
			planningSeed: 7,
			postconditions: [],
			priority: 'random',
			risk: 'low',
			steps: [
				{
					data: '0x11',
					evidence: [{ kind: 'receipt-success' }],
					gasLimit: '100000',
					id: 'approve',
					label: 'Approve',
					preflightCalls: [],
					to: '0x0000000000000000000000000000000000000001',
					walletAssetDebits: [],
				},
				{
					data: '0x22',
					evidence: [{ kind: 'receipt-success' }],
					gasLimit: '100000',
					id: 'trade',
					label: 'Trade',
					preflightCalls: [],
					to: '0x0000000000000000000000000000000000000002',
					walletAssetDebits: [],
				},
			],
		}
		const workflow = createDurableWorkflow(plan)
		markWorkflowStepConfirmed(workflow, 'approve', `0x${'41'.repeat(32)}`)
		workflow.status = 'waiting-continuation'
		state.workflows = [workflow]
		const controller = createChaosDashboardController({
			configuration: {
				path: '/tmp/unused-chaos-config.json',
				rememberSigner: false,
				revision: 'revision',
				settings: current,
			},
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveState: async () => {},
			state,
		})
		await controller.setWorkflow({
			action: 'abandon',
			confirmation: 'ABANDON PARTIAL WORKFLOW',
			reason: 'Canonical continuation is permanently unavailable',
			updatedAt: workflow.updatedAt,
			workflowId: workflow.id,
		})
		expect(state.workflows[0]?.status).toBe('abandoned')
		expect(state.scheduler.status).toBe('paused')
		expect(state.scheduler.nextRunAt).toBeDefined()
	})

	test('does not begin a resume when the pre-configuration safety checkpoint cannot persist', async () => {
		const current = configuredSettings(true, true)
		const state = runtimeState(current)
		completeSignerScan(state, current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: true,
			revision: 'revision',
			settings: current,
		}
		let configurationSaveCount = 0
		let lockCommitCount = 0
		let lockDiscardCount = 0
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => {
					lockCommitCount += 1
				},
				discardSigner: async () => {
					lockDiscardCount += 1
				},
				release: async () => undefined,
			},
			saveConfiguration: async () => {
				configurationSaveCount += 1
				return 'revision:unexpected'
			},
			saveState: async () => {
				throw new Error('injected pre-configuration state failure')
			},
			state,
		})

		await expect(controller.setPaused({ paused: false, revision: 'revision' })).rejects.toThrow('injected pre-configuration state failure')
		expect(configurationSaveCount).toBe(0)
		expect(lockCommitCount).toBe(0)
		expect(lockDiscardCount).toBe(1)
		expect(configuration.revision).toBe('revision')
		expect(configuration.settings.paused).toBeTrue()
		expect(state.paused).toBeTrue()
		expect(state.safetyPaused).toBeFalse()
		expect(state.status).toBe('paused')
	})

	test('latches a durable pause when a live-enable configuration save is indeterminate', async () => {
		const current = configuredSettings(true, false)
		const state = runtimeState(current)
		completeSignerScan(state, current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: true,
			revision: 'revision',
			settings: current,
		}
		const durableCheckpoints: Array<{
			paused: boolean
			safetyPaused: boolean
			schedulerStatus: string
			status: string
		}> = []
		let lockCommitCount = 0
		let lockDiscardCount = 0
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => {
					lockCommitCount += 1
				},
				discardSigner: async () => {
					lockDiscardCount += 1
				},
				release: async () => undefined,
			},
			saveConfiguration: async () => {
				throw new Error('injected configuration failure')
			},
			saveState: async (_path, candidate) => {
				durableCheckpoints.push({
					paused: candidate.paused,
					safetyPaused: candidate.safetyPaused,
					schedulerStatus: candidate.scheduler.status,
					status: candidate.status,
				})
			},
			state,
		})

		const failure = await captureFailure(() => controller.setSettings(settingsUpdate(current, 'revision', true)))
		expect(failure).toBeInstanceOf(ConfigurationCommitIndeterminate)
		expect(failure).toHaveProperty('message', expect.stringContaining('Treat the requested configuration as committed'))
		expect(durableCheckpoints).toEqual([
			{
				paused: true,
				safetyPaused: true,
				schedulerStatus: 'paused',
				status: 'paused',
			},
			{
				paused: true,
				safetyPaused: true,
				schedulerStatus: 'paused',
				status: 'paused',
			},
		])
		expect(lockCommitCount).toBe(0)
		expect(lockDiscardCount).toBe(1)
		expect(configuration.revision).toBe('revision')
		expect(configuration.settings.runtime.execute).toBeFalse()
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
		expect(state.error).toContain('owner-file save outcome is indeterminate')
		expect(state.scheduler.status).toBe('paused')
	})

	test('explicitly reports a remembered signer committed before a signer-lock failure', async () => {
		const current = settings()
		const state = runtimeState(current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: false,
			revision: 'revision',
			settings: current,
		}
		let discarded = false
		let persistedSigner: Hex | undefined
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => {
					throw new Error('injected signer-lock commit failure')
				},
				discardSigner: async () => {
					discarded = true
				},
				release: async () => undefined,
			},
			saveConfiguration: async (_path, candidate) => {
				persistedSigner = candidate.privateKey
				return 'revision:committed'
			},
			saveState: async () => undefined,
			state,
		})

		const failure = await captureFailure(() =>
			controller.setSigner({
				privateKey: secondPrivateKey,
				remember: true,
				revision: 'revision',
			}),
		)
		expect(failure).toBeInstanceOf(ConfigurationCommittedSafelyPaused)
		expect(failure).toHaveProperty('message', expect.stringContaining('configuration was committed'))
		expect(persistedSigner).toBe(secondPrivateKey)
		expect(discarded).toBeFalse()
		expect(configuration).toMatchObject({
			rememberSigner: true,
			revision: 'revision:committed',
		})
		expect(configuration.settings.privateKey).toBe(secondPrivateKey)
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
		expect(state.error).toContain('signer-lock activation failed')
	})

	test('treats a remembered signer save that throws after commit as committed and safety-paused', async () => {
		const current = settings()
		const state = runtimeState(current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: false,
			revision: 'revision',
			settings: current,
		}
		let ownerFileSigner: Hex | undefined
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async (_path, candidate) => {
				ownerFileSigner = candidate.privateKey
				throw new Error('injected post-rename directory-sync failure')
			},
			saveState: async () => undefined,
			state,
		})

		const failure = await captureFailure(() =>
			controller.setSigner({
				privateKey: secondPrivateKey,
				remember: true,
				revision: 'revision',
			}),
		)
		expect(failure).toBeInstanceOf(ConfigurationCommitIndeterminate)
		expect(failure).toHaveProperty('message', expect.stringContaining('Treat the requested configuration as committed'))
		expect(ownerFileSigner).toBe(secondPrivateKey)
		expect(configuration.settings.privateKey).toBeUndefined()
		expect(configuration.revision).toBe('revision')
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
	})

	test('keeps a committed live resume durably safety-paused when the final state commit fails', async () => {
		const current = configuredSettings(true, true)
		const state = runtimeState(current)
		completeSignerScan(state, current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: true,
			revision: 'revision',
			settings: current,
		}
		const durableCheckpoints: Array<{
			paused: boolean
			safetyPaused: boolean
		}> = []
		let stateSaveCount = 0
		let lockCommitted = false
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => {
					lockCommitted = true
				},
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async () => 'revision:committed',
			saveState: async (_path, candidate) => {
				stateSaveCount += 1
				if (stateSaveCount === 2) {
					throw new Error('injected final state commit failure')
				}
				durableCheckpoints.push({
					paused: candidate.paused,
					safetyPaused: candidate.safetyPaused,
				})
			},
			state,
		})

		const failure = await captureFailure(() => controller.setPaused({ paused: false, revision: 'revision' }))
		expect(failure).toBeInstanceOf(ConfigurationCommittedSafelyPaused)
		expect(failure).toHaveProperty('message', expect.stringContaining('final runtime-state and audit commit'))
		expect(lockCommitted).toBeTrue()
		expect(durableCheckpoints).toEqual([
			{ paused: true, safetyPaused: true },
			{ paused: true, safetyPaused: true },
		])
		expect(stateSaveCount).toBe(3)
		expect(configuration.revision).toBe('revision:committed')
		expect(configuration.settings.paused).toBeFalse()
		expect(configuration.settings.runtime.execute).toBeTrue()
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
		expect(state.scheduler.status).toBe('paused')
	})

	test('compensates through the owner file when both final and safety-checkpoint state writes fail', async () => {
		const current = configuredSettings(true, true)
		const state = runtimeState(current)
		completeSignerScan(state, current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: true,
			revision: 'revision',
			settings: current,
		}
		const ownerFileCandidates: Array<{
			execute: boolean
			paused: boolean
		}> = []
		let stateSaveCount = 0
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => undefined,
				commitSigner: async () => undefined,
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async (_path, candidate) => {
				ownerFileCandidates.push({
					execute: candidate.runtime.execute,
					paused: candidate.paused,
				})
				return ownerFileCandidates.length === 1 ? 'revision:live' : 'revision:safe'
			},
			saveState: async () => {
				stateSaveCount += 1
				if (stateSaveCount > 1) {
					throw new Error('injected runtime-state filesystem failure')
				}
			},
			state,
		})

		const failure = await captureFailure(() => controller.setPaused({ paused: false, revision: 'revision' }))
		expect(failure).toBeInstanceOf(ConfigurationCommittedSafelyPaused)
		expect(ownerFileCandidates).toEqual([
			{ execute: true, paused: false },
			{ execute: false, paused: true },
		])
		expect(configuration.revision).toBe('revision:safe')
		expect(configuration.settings.paused).toBeTrue()
		expect(configuration.settings.runtime.execute).toBeFalse()
		expect(state).toMatchObject({
			paused: true,
			safetyPaused: true,
			status: 'paused',
		})
	})

	test('commits configuration and audit before publishing a new CAS revision', async () => {
		const current = settings()
		const state = runtimeState(current)
		const configuration = {
			path: '/tmp/unused-chaos-config.json',
			rememberSigner: false,
			revision: 'revision',
			settings: current,
		}
		const expectedRevisions: Array<string | undefined> = []
		let lockAcquireCount = 0
		let lockCommitCount = 0
		let stateSaveCount = 0
		const commitBoundaries: string[] = []
		const controller = createChaosDashboardController({
			configuration,
			gate: createSignerOperationGate(),
			hostname: '127.0.0.1',
			locks: {
				acquireSigner: async () => {
					lockAcquireCount += 1
					return undefined
				},
				commitSigner: async () => {
					lockCommitCount += 1
					commitBoundaries.push('signer-lock')
				},
				discardSigner: async () => undefined,
				release: async () => undefined,
			},
			saveConfiguration: async (_path, _candidate, expectedRevision) => {
				expectedRevisions.push(expectedRevision)
				commitBoundaries.push('owner-file')
				return 'revision:next'
			},
			saveState: async () => {
				stateSaveCount += 1
				commitBoundaries.push(stateSaveCount === 1 ? 'safety-checkpoint' : 'runtime-and-audit')
			},
			state,
		})

		await controller.setSettings(settingsUpdate(current, 'revision', false, 90))
		expect(expectedRevisions).toEqual(['revision'])
		expect(lockAcquireCount).toBe(1)
		expect(lockCommitCount).toBe(1)
		expect(stateSaveCount).toBe(2)
		expect(commitBoundaries).toEqual(['safety-checkpoint', 'owner-file', 'signer-lock', 'runtime-and-audit'])
		expect(configuration.revision).toBe('revision:next')
		expect(configuration.settings.scheduler.minimumDelaySeconds).toBe(90)
		expect(state.safetyPaused).toBeFalse()
		expect(state.activities[0]?.message).toBe('Execution policy updated')

		await expect(controller.setSettings(settingsUpdate(configuration.settings, 'revision', false, 120))).rejects.toThrow('configuration changed after this editor loaded')
		expect(expectedRevisions).toEqual(['revision'])
		expect(lockAcquireCount).toBe(1)
		expect(lockCommitCount).toBe(1)
		expect(stateSaveCount).toBe(2)
		expect(configuration.settings.scheduler.minimumDelaySeconds).toBe(90)
	})
})
