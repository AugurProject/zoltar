/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { ReputationToken_ReputationToken } from '../../contractArtifact.js'
import { createSimulationEngine, type SimulationEngineDependencies } from '../../simulation/tevmEngine.js'
import { parseSavedSimulationStateEnvelope } from './savedStateStorage.js'

const dependencies: SimulationEngineDependencies = {
	getDeploymentSteps: () => [],
	getZoltarAddress: () => getAddress('0x00000000000000000000000000000000000000ee'),
}

async function createBaselineEngine() {
	return await createSimulationEngine({ dependencies, initialization: { kind: 'scenario', scenario: 'baseline' } })
}

async function readChainFacts(engine: Awaited<ReturnType<typeof createBaselineEngine>>) {
	const state = engine.getState()
	const account = state.selectedAccount
	const balance = await engine.request({ method: 'eth_getBalance', params: [account, 'latest'] })
	const repCode = await engine.request({ method: 'eth_getCode', params: [engine.getProfile().genesisRepTokenAddress, 'latest'] })
	const logs = await engine.request({ method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: 'latest' }] })
	return { balance, currentTimestamp: state.currentTimestamp, logs, repCode, transactionCount: state.transactionCountSinceReset }
}

async function readLogs(engine: Awaited<ReturnType<typeof createBaselineEngine>>) {
	const logs = await engine.request({ method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: 'latest' }] })
	if (!Array.isArray(logs)) throw new Error('Expected a log list')
	return logs
}

describe('simulation engine prepared states', () => {
	test('restoring an exported state brings back the chain clock with the accounts and contracts', async () => {
		const engine = await createBaselineEngine()
		await engine.bootstrap()
		await engine.advanceTime(3_600n)
		const exported = await engine.exportState('clock check')
		const before = await readChainFacts(engine)
		expect(before.currentTimestamp).toBeGreaterThan(1_735_689_600n)

		const restored = await createSimulationEngine({ dependencies, initialization: { envelope: parseSavedSimulationStateEnvelope(exported), kind: 'saved-state', stateId: 'clock-check' } })
		await restored.bootstrap()

		// The restore mines one block on top of the saved history, so the clock moves by a single block interval.
		expect(await readChainFacts(restored)).toEqual({ ...before, currentTimestamp: before.currentTimestamp + 1n })
		expect(restored.getState().blockCountSinceReset).toBe(engine.getState().blockCountSinceReset + 1n)
		expect(restored.getState().isBootstrapped).toBe(true)
		const wrappedEthLogs = await readLogs(engine)
		expect(wrappedEthLogs.length).toBeGreaterThan(0)
		const firstLog = wrappedEthLogs[0]
		if (typeof firstLog !== 'object' || firstLog === null || !('transactionHash' in firstLog)) throw new Error('Expected a log with a transaction hash')
		expect(await restored.request({ method: 'eth_getTransactionReceipt', params: [firstLog.transactionHash] })).toMatchObject({ status: '0x1', transactionHash: firstLog.transactionHash })
	}, 60_000)

	test('a state saved without block history still restores at its clock', async () => {
		const engine = await createBaselineEngine()
		await engine.bootstrap()
		await engine.advanceTime(900n)
		const envelope = parseSavedSimulationStateEnvelope(await engine.exportState('legacy'))
		const { blocks: _blocks, ...legacyState } = envelope.state
		const restored = await createSimulationEngine({ dependencies, initialization: { envelope: { ...envelope, state: legacyState }, kind: 'saved-state', stateId: 'legacy' } })
		await restored.bootstrap()
		expect(restored.getState().currentTimestamp).toBe(engine.getState().currentTimestamp)
		expect(await readLogs(restored)).toEqual([])
		expect(await restored.request({ method: 'eth_getBalance', params: [engine.getState().selectedAccount, 'latest'] })).toBe(await engine.request({ method: 'eth_getBalance', params: [engine.getState().selectedAccount, 'latest'] }))
	}, 60_000)

	test('a scenario bootstrap restores a matching prepared state and resets back to it', async () => {
		const seeded = await createBaselineEngine()
		await seeded.bootstrap()
		await seeded.advanceTime(60n)
		const scenarioSnapshot = await seeded.exportState('baseline snapshot')
		const expected = await readChainFacts(seeded)

		const engine = await createBaselineEngine()
		const labels: Array<string | undefined> = []
		engine.subscribe(() => labels.push(engine.getState().bootstrapLabel))
		await engine.bootstrap({ scenarioSnapshot })
		const restoredFacts = { ...expected, currentTimestamp: expected.currentTimestamp + 1n }
		expect(await readChainFacts(engine)).toEqual(restoredFacts)
		expect(engine.getState().currentSource).toEqual({ kind: 'scenario', scenario: 'baseline' })
		expect(labels).not.toContain('Funding QA account 1 of 3')

		await engine.advanceTime(500n)
		await engine.reset()
		expect(await readChainFacts(engine)).toEqual(restoredFacts)
	}, 60_000)

	test('a prepared state made for other sources is ignored when the bundle knows its own key', async () => {
		const seeded = await createBaselineEngine()
		await seeded.bootstrap()
		const scenarioSnapshot = await seeded.exportState('keyed')
		const bundled = { ...dependencies, getBundledSnapshotKey: () => 'bundle-key' }

		const mismatched = await createSimulationEngine({ dependencies: bundled, initialization: { kind: 'scenario', scenario: 'baseline' } })
		const labels: Array<string | undefined> = []
		mismatched.subscribe(() => labels.push(mismatched.getState().bootstrapLabel))
		await mismatched.bootstrap({ scenarioSnapshot, scenarioSnapshotKey: 'other-key' })
		expect(labels).toContain('Funding QA account 1 of 3')

		const matching = await createSimulationEngine({ dependencies: bundled, initialization: { kind: 'scenario', scenario: 'baseline' } })
		const matchingLabels: Array<string | undefined> = []
		matching.subscribe(() => matchingLabels.push(matching.getState().bootstrapLabel))
		await matching.bootstrap({ scenarioSnapshot, scenarioSnapshotKey: 'bundle-key' })
		expect(matchingLabels).not.toContain('Funding QA account 1 of 3')
		expect(matchingLabels).toContain('Loading prepared simulation scenario')
	}, 60_000)

	test('outside requests wait for a reset, and a mint under the chain lock survives concurrent calls', async () => {
		const engine = await createBaselineEngine()
		await engine.bootstrap()
		const account = engine.getState().selectedAccount
		const repToken = engine.getProfile().genesisRepTokenAddress
		const balanceCall = { data: encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'balanceOf', args: [account] }), to: repToken }
		const readBalance = async () => BigInt(String(await engine.request({ method: 'eth_call', params: [balanceCall, 'latest'] })))
		const before = await readBalance()

		const [, ...balances] = await Promise.all([engine.mintRep(5n * 10n ** 18n), readBalance(), readBalance(), readBalance()])
		for (const balance of balances) expect([before, before + 5n * 10n ** 18n]).toContain(balance)
		expect(await readBalance()).toBe(before + 5n * 10n ** 18n)

		const reset = engine.reset()
		const duringReset = await engine.request({ method: 'eth_getBalance', params: [account, 'latest'] })
		await reset
		expect(engine.getState().isBootstrapped).toBe(true)
		expect(duringReset).toBe(await engine.request({ method: 'eth_getBalance', params: [account, 'latest'] }))
		expect(await readBalance()).toBe(before)
	}, 60_000)

	test('a receipt wait that spans a reset does not mine on the chain being restored', async () => {
		const seeded = await createBaselineEngine()
		await seeded.bootstrap()
		const scenarioSnapshot = await seeded.exportState('reset race')
		const engine = await createBaselineEngine()
		await engine.bootstrap({ scenarioSnapshot })
		const account = engine.getState().selectedAccount
		const hash = await engine.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x1' }] })
		if (typeof hash !== 'string') throw new Error('Expected a transaction hash')
		const blockOneBefore = await engine.request({ method: 'eth_getBlockByNumber', params: ['0x1', false] })
		const logsBefore = await readLogs(engine)
		const headTimestampBefore = engine.getState().currentTimestamp

		for (const delays of [
			{ query: 0, transaction: 300 },
			{ query: 300, transaction: 0 },
		]) {
			engine.setTransactionDelayMilliseconds(delays.transaction)
			engine.setQueryDelayMilliseconds(delays.query)
			// The wait sleeps through its delay while the reset replaces and restores the chain underneath it.
			const receiptWait = engine.waitForTransactionReceipt(hash as `0x${string}`).then(
				() => 'found',
				() => 'missing',
			)
			await new Promise(resolve => setTimeout(resolve, 50))
			await engine.reset()
			expect(['found', 'missing']).toContain(await receiptWait)
			expect(await engine.request({ method: 'eth_getBlockByNumber', params: ['0x1', false] })).toEqual(blockOneBefore)
			expect(await readLogs(engine)).toEqual(logsBefore)
			expect(engine.getState().currentTimestamp).toBeGreaterThanOrEqual(headTimestampBefore - 1n)
		}
	}, 60_000)

	test('a mint queued behind a transaction when a reset starts does not reach the restored chain', async () => {
		const seeded = await createBaselineEngine()
		await seeded.bootstrap()
		const scenarioSnapshot = await seeded.exportState('mint race')
		const engine = await createBaselineEngine()
		await engine.bootstrap({ scenarioSnapshot })
		const account = engine.getState().selectedAccount
		const balanceCall = { data: encodeFunctionData({ abi: ReputationToken_ReputationToken.abi, functionName: 'balanceOf', args: [account] }), to: engine.getProfile().genesisRepTokenAddress }
		const readBalance = async () => BigInt(String(await engine.request({ method: 'eth_call', params: [balanceCall, 'latest'] })))
		const snapshotBalance = await readBalance()

		const transfer = engine.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x1' }] })
		const mint = engine.mintRep(7n * 10n ** 18n).then(
			() => 'minted',
			() => 'failed',
		)
		await new Promise(resolve => setTimeout(resolve, 5))
		await engine.reset()
		await transfer
		expect(['minted', 'failed']).toContain(await mint)
		expect(await readBalance()).toBe(snapshotBalance)
	}, 60_000)

	test('a prepared state for another scenario or universe is ignored in favour of live seeding', async () => {
		const seeded = await createBaselineEngine()
		await seeded.bootstrap()
		const foreign = (await seeded.exportState('foreign')).replace('"baseScenario": "baseline"', '"baseScenario": "deployed"')
		expect(foreign).toContain('"baseScenario": "deployed"')

		const engine = await createBaselineEngine()
		const labels: Array<string | undefined> = []
		engine.subscribe(() => labels.push(engine.getState().bootstrapLabel))
		await engine.bootstrap({ scenarioSnapshot: foreign })
		expect(engine.getState().isBootstrapped).toBe(true)
		expect(labels).toContain('Funding QA account 1 of 3')

		const otherUniverse = await createSimulationEngine({ dependencies, genesisOutcome: 'no', initialization: { kind: 'scenario', scenario: 'baseline' } })
		const universeLabels: Array<string | undefined> = []
		otherUniverse.subscribe(() => universeLabels.push(otherUniverse.getState().bootstrapLabel))
		await otherUniverse.bootstrap({ scenarioSnapshot: await seeded.exportState('yes universe') })
		expect(universeLabels).toContain('Funding QA account 1 of 3')
	}, 60_000)
})
