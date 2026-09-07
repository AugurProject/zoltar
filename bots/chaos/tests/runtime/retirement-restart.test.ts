import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import type { EcosystemSnapshot, OperationPlan } from '../../src/operations/types.ts'
import { processRetirementCycle } from '../../src/runtime/retirement-runner.ts'
import { initialDurableState, initialRuntimeState, loadDurableState, saveDurableState, type RuntimeState } from '../../src/state/operator-state.ts'
import { DEFAULT_RETIREMENT_POLICIES, requestRetirement, uniswapV3PositionKey } from '../../src/state/retirement.ts'
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
	requestRetirement(durable.retirement, durable.profileId, snapshot.wallet.address, DEFAULT_RETIREMENT_POLICIES, `DRAIN ${durable.profileId} TO ${snapshot.wallet.address}`)
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
		scan: { anchor: { baseFeePerGas: 1n, blockHash: hash(1), blockNumber: 1n, timestamp: 1n }, canonicalLifecyclePresenceComplete: true, carryProofJournalComplete: true, indexComplete: true, snapshot },
		settings: liveSettings(),
		state,
		v3: [],
	})
}

describe('Drain & Retire persisted restart behavior', () => {
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
		state.retirement.positions = [{ createdAt: new Date(0).toISOString(), creationWorkflowId: 'workflow:pending', fee: 3_000, id: `${pool.toLowerCase()}:${positionKey.toLowerCase()}`, owner, pool, positionKey, profileId: state.profileId, registeredBy: 'workflow', status: 'pending-confirmation', tickLower: -120, tickUpper: 120, token0: address(71), token1: address(72) }]
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

	test('persists the final-sweep boundary before execution and never repeats the sweep after restart', async () => {
		const path = await statePath()
		const snapshot = emptySnapshot()
		snapshot.wallet.tokens = [{ address: address(80), allowances: {}, balance: '7', openOracleCredit: '0', symbol: 'TEST' }]
		let state = await reload(path, requestedState(snapshot))
		const executed: string[] = []
		await cycle(path, state, snapshot, executed, async plan => {
			expect(plan.definitionId).toBe('retirement.sweep.erc20')
			const persistedBeforeExecution = await loadDurableState(path, snapshot.chainId)
			expect(persistedBeforeExecution.retirement.finalSweepStartedAt).toBeDefined()
			const token = snapshot.wallet.tokens[0]
			if (token === undefined) throw new Error('Expected sweep fixture')
			token.balance = '0'
		})
		state = await reload(path, state)
		await cycle(path, state, snapshot, executed)
		expect(state.retirement.status).toBe('drained')
		state = await reload(path, state)
		await cycle(path, state, snapshot, executed)
		expect(executed).toEqual(['retirement.sweep.erc20'])
	})
})
