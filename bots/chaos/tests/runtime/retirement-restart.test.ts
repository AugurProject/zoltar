import { resetPristineStateForDeploymentProfile } from '../../src/runtime/deployment-profile.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import type { EcosystemSnapshot, OperationPlan } from '../../src/operations/types.ts'
import { processRetirementCycle, updateRetirementAssessment } from '../../src/runtime/retirement-runner.ts'
import { loadDurableState, saveDurableState, type RuntimeState } from '../../src/state/operator-state.ts'
import { initialDurableState, initialRuntimeState } from '../../src/state/initial-state.ts'
import { cancelRetirement, DEFAULT_RETIREMENT_POLICIES, requestRetirement, uniswapV3PositionKey } from '../../src/state/retirement.ts'
import { createDurableWorkflow } from '../../src/runtime/workflows.ts'
import { readV3PositionsWithQuorum, reconcileV3PositionJournal, recordV3ScanSuccess } from '../../src/runtime/retirement-v3-positions.ts'
import { address, hash, snapshotFixture } from '../operations/fixture.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function statePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-retirement-restart-'))
	directories.push(directory)
	return join(directory, 'state.json')
}

function emptySnapshot() {
	const snapshot = snapshotFixture()
	snapshot.wallet.ethBalanceAttoEth = '0'
	snapshot.wallet.tokens = []
	snapshot.wallet.shares = []
	snapshot.wallet.lpTokens = []
	snapshot.wallet.openOracleEthCredit = '0'
	for (const pool of snapshot.pools) pool.vaults = []
	for (const pair of snapshot.pairs) pair.walletLiquidity = '0'
	snapshot.warnings = []
	return snapshot
}

function liveSettings() {
	const settings = parseSettings(example)
	settings.paused = false
	settings.runtime.execute = true
	return settings
}

function requestedState(snapshot: EcosystemSnapshot) {
	const durable = initialDurableState(snapshot.chainId, false, 'profile:test', snapshot.wallet.address)
	const recipient = snapshot.wallet.address
	requestRetirement(durable.retirement, durable.profileId, recipient, DEFAULT_RETIREMENT_POLICIES, `DRAIN ${durable.profileId} TO ${recipient}`, snapshot.wallet.address)
	return initialRuntimeState(false, snapshot.wallet.address, snapshot.chainId, durable)
}

async function reload(path: string, state: RuntimeState) {
	await saveDurableState(path, state)
	return initialRuntimeState(false, state.wallet, state.chainId, await loadDurableState(path, state.chainId))
}

async function cycle(path: string, state: RuntimeState, snapshot: EcosystemSnapshot, executed: string[], onExecute?: (plan: OperationPlan) => Promise<void>) {
	await processRetirementCycle({
		execute: async plan => {
			executed.push(plan.definitionId)
			await onExecute?.(plan)
			await saveDurableState(path, state)
		},
		persist: async () => await saveDurableState(path, state),
		prepareExecution: async () => {},
		scan: { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, executionReady: true, canonicalLifecyclePresenceComplete: true, carryProofsComplete: true, indexComplete: true, snapshot },
		settings: liveSettings(),
		state,
		v3: [],
	})
}

describe('Drain & Retire persisted restart behavior', () => {
	test.each(['trading.genesis-uniswap.seed-pool', 'trading.universe-uniswap.seed-pool'])('cancel, reseed, restart, and retire again uses fresh V3 balances: %s', async operationId => {
		const path = await statePath()
		const snapshot = emptySnapshot()
		let state = requestedState(snapshot)
		const seed = (id: string, transactionHash: ReturnType<typeof hash>) => {
			const workflow = createDurableWorkflow({
				classification: 'selectable',
				createdAtBlock: '1',
				definitionId: operationId,
				ecosystem: 'trading',
				id,
				label: 'Seed',
				metadata: { pool: address(70), token0: address(71), token1: address(72) },
				obligation: false,
				planningSeed: 1,
				postconditions: ['seeded'],
				priority: 'random',
				risk: 'medium',
				steps: [{ data: '0x', evidence: [{ kind: 'receipt-success' }], gasLimit: '1', id: 'seed-genesis-uniswap-pool', label: 'Seed', preflightCalls: [], to: address(73), value: '0', walletAssetDebits: [] }],
			})
			workflow.status = 'completed'
			for (const step of workflow.steps) {
				step.status = 'confirmed'
				step.transactionHash = transactionHash
			}
			return workflow
		}
		state.workflows = [seed('first', hash(11))]
		reconcileV3PositionJournal(state.retirement, state.workflows, state.profileId, snapshot.wallet.address)
		const original = state.retirement.positions[0]
		if (original === undefined) throw new Error('Seed position missing')
		recordV3ScanSuccess(state, { liquidity: 0n, position: original, tokensOwed0: 0n, tokensOwed1: 0n }, 2n)
		// An unresolved claim keeps the first retirement cancellable after the V3 drain.
		snapshot.wallet.openOracleEthCredit = '9'
		const scan = { anchor: { baseFeePerGas: 1n, blockHash: hash(2), blockNumber: 2n, timestamp: 2n }, executionReady: true, canonicalLifecyclePresenceComplete: true, carryProofsComplete: true, indexComplete: true, snapshot }
		updateRetirementAssessment(scan, liveSettings(), state, [{ liquidity: 0n, position: original, tokensOwed0: 0n, tokensOwed1: 0n }])
		expect(state.retirement.status).toBe('draining')
		cancelRetirement(state.retirement, 'CANCEL DRAIN')
		state = await reload(path, state)
		state.workflows.push(seed('reseed', hash(12)))
		reconcileV3PositionJournal(state.retirement, state.workflows, state.profileId, snapshot.wallet.address)
		expect(state.retirement.positions).toHaveLength(1)
		expect(state.retirement.positions[0]).toMatchObject({ id: original.id, creationWorkflowId: original.creationWorkflowId, creationTransactionHash: hash(12), status: 'closed' })
		const recipient = address(99)
		requestRetirement(state.retirement, state.profileId, recipient, DEFAULT_RETIREMENT_POLICIES, `DRAIN ${state.profileId} TO ${recipient}`, state.signerAddress)
		state = await reload(path, state)
		snapshot.wallet.openOracleEthCredit = '0'
		scan.anchor = { ...scan.anchor, blockHash: hash(3), blockNumber: 3n }
		const observations = await readV3PositionsWithQuorum([async position => ({ liquidity: 9n, position, tokensOwed0: 0n, tokensOwed1: 0n })], 1, state.retirement.positions, scan.anchor)
		for (const observation of observations) recordV3ScanSuccess(state, observation, 3n)
		expect(updateRetirementAssessment(scan, liveSettings(), state, observations)?.action?.kind).toBe('v3-position')
		state = await reload(path, state)
		expect(state.retirement.positions[0]?.status).toBe('active')
		expect(state.retirement.completionEvidence).toBeUndefined()
		await expect(resetPristineStateForDeploymentProfile(state, 'profile:replacement', false, state.wallet, path, async () => {})).rejects.toThrow('drain it first')
		const current = state.retirement.positions[0]
		if (current === undefined) throw new Error('Restored position missing')
		recordV3ScanSuccess(state, { liquidity: 0n, position: current, tokensOwed0: 0n, tokensOwed1: 0n }, 4n)
		reconcileV3PositionJournal(state.retirement, state.workflows, state.profileId, snapshot.wallet.address)
		expect(current.status).toBe('closed')
	})

	test('persists known-only recovery without permitting full-retirement exit or profile replacement', async () => {
		const path = await statePath()
		const snapshot = emptySnapshot()
		let state = requestedState(snapshot)
		state.retirement.policies.exitAfterCompletion = true
		const settings = liveSettings()
		settings.runtime.once = false
		const scan = { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, executionReady: true, canonicalLifecyclePresenceComplete: false, carryProofsComplete: false, indexComplete: false, snapshot }
		const result = await processRetirementCycle({
			execute: async () => {
				throw new Error('Nothing known remains to recover')
			},
			persist: async () => {
				await saveDurableState(path, state)
			},
			prepareExecution: async () => {},
			scan,
			settings,
			state,
			v3: [],
		})
		expect(result).toBeFalse()
		state = await reload(path, state)
		expect(state.retirement.status).toBe('known-claims-recovered')
		expect(state.retirement.completionEvidence).toBeUndefined()
		await expect(resetPristineStateForDeploymentProfile(state, 'profile:replacement', address(50), false, state.wallet, path, async () => {})).rejects.toThrow('drain it first')
		snapshot.wallet.openOracleEthCredit = '9'
		let recovered = false
		await processRetirementCycle({
			execute: async () => {
				recovered = true
			},
			persist: async () => {},
			prepareExecution: async () => {},
			scan,
			settings,
			state,
			v3: [],
		})
		expect(recovered).toBeTrue()
		expect(state.retirement.status).toBe('draining')
	})

	test('rescans requested, draining, waiting, blocked, drained, and residual phases idempotently', async () => {
		const path = await statePath()
		const executed: string[] = []

		const drainingSnapshot = emptySnapshot()
		drainingSnapshot.wallet.tokens = [{ address: address(40), allowances: { [address(41)]: '1' }, balance: '0', openOracleCredit: '0', symbol: 'TEST' }]
		let state = await reload(path, requestedState(drainingSnapshot))
		expect(state.retirement.status).toBe('requested')
		await cycle(path, state, drainingSnapshot, executed, async () => {
			const token = drainingSnapshot.wallet.tokens[0]
			if (token === undefined) throw new Error('Expected allowance fixture')
			token.allowances = {}
		})
		expect(state.retirement.status).toBe('draining')
		state = await reload(path, state)
		await cycle(path, state, drainingSnapshot, executed)
		expect(state.retirement.status).toBe('drained')
		state = await reload(path, state)
		await cycle(path, state, drainingSnapshot, executed)
		expect(state.retirement.status).toBe('drained')
		expect(executed).toEqual(['retirement.allowance.revoke-erc20'])

		const waitingSnapshot = emptySnapshot()
		const waitingPool = waitingSnapshot.pools[0]
		if (waitingPool === undefined) throw new Error('Expected pool fixture')
		waitingPool.questionOutcome = 3
		waitingSnapshot.wallet.shares = [{ invalid: '0', isApprovedForAll: {}, migrationProgressByRoute: {}, no: '1', shareToken: waitingPool.shareToken, universeId: waitingPool.universeId, yes: '0' }]
		state = await reload(path, requestedState(waitingSnapshot))
		await cycle(path, state, waitingSnapshot, executed)
		expect(state.retirement.status).toBe('waiting')
		state = await reload(path, state)
		await cycle(path, state, waitingSnapshot, executed)
		expect(state.retirement.status).toBe('waiting')

		const blockedSnapshot = emptySnapshot()
		state = requestedState(blockedSnapshot)
		const owner = blockedSnapshot.wallet.address
		const pool = address(70)
		const positionKey = uniswapV3PositionKey(owner, -120, 120)
		state.retirement.positions = [
			{
				createdAt: new Date(0).toISOString(),
				creationWorkflowId: 'workflow:pending',
				fee: 3_000,
				id: `${pool.toLowerCase()}:${positionKey.toLowerCase()}`,
				owner,
				pool,
				positionKey,
				profileId: state.profileId,
				registeredBy: 'workflow',
				status: 'pending-confirmation',
				tickLower: -120,
				tickUpper: 120,
				token0: address(71),
				token1: address(72),
			},
		]
		state = await reload(path, state)
		await cycle(path, state, blockedSnapshot, executed)
		expect(state.retirement.status).toBe('blocked')
		state = await reload(path, state)
		await cycle(path, state, blockedSnapshot, executed)
		expect(state.retirement.status).toBe('blocked')

		waitingPool.questionOutcome = 1
		state = await reload(path, requestedState(waitingSnapshot))
		await cycle(path, state, waitingSnapshot, executed)
		expect(state.retirement.status).toBe('drained-with-residuals')
		state = await reload(path, state)
		await cycle(path, state, waitingSnapshot, executed)
		expect(state.retirement.status).toBe('drained-with-residuals')
	})

	test('does not send signer-held tokens during a restarted retirement', async () => {
		const path = await statePath()
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(80), allowances: {}, balance: '7', openOracleCredit: '0', symbol: 'TEST' }]
		let state = await reload(path, requestedState(snapshot))
		const executed: string[] = []
		await cycle(path, state, snapshot, executed)
		state = await reload(path, state)
		await cycle(path, state, snapshot, executed)
		expect(executed).toEqual([])
		expect(snapshot.wallet.tokens[0]?.balance).toBe('7')
	})
})
