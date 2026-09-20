import { emptySettlementSnapshot } from '#state/settlement-store'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { loadConfiguration } from '#config/configuration'
import { createDeploymentManifest } from '../helpers/deployment-manifest.ts'
import { canonicalSecurityPoolFactory } from '#config/network'
import { loadOperatorSettings, parseOperatorSettings, saveOperatorSettings } from '#config/settings-store'
import type { ExecutionLockManager } from '#execution/execution-locks'
import type { OperatorSnapshotFixedState, OperatorState } from '#state/operator-state'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { ExclusiveProcessLock } from '#state/position-store'
import example from '../../config/operator.example.json'
import { startOperatorControlPlane } from '../../src/runtime/operator-control-plane.ts'
import { applyQueuedExecutionSettings, applyQueuedSigner } from '../../src/runtime/operator-execution-state.ts'

const temporaryDirectories: string[] = []
const dashboards: { stop: (closeActiveConnections?: boolean) => void }[] = []
const rpcServers: Bun.Server<unknown>[] = []

/** A Sepolia JSON-RPC stand-in that answers every method with the chain id, which satisfies the connectivity probes. */
function mockSepoliaRpc() {
	const server = Bun.serve({
		async fetch(request) {
			const body = (await request.json()) as { id: unknown }
			return Response.json({ id: body.id, jsonrpc: '2.0', result: '0xaa36a7' })
		},
		hostname: '127.0.0.1',
		port: 0,
	})
	rpcServers.push(server)
	if (server.port === undefined) throw new Error('Mock RPC did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}/`
}

afterEach(async () => {
	for (const dashboard of dashboards.splice(0)) dashboard.stop(true)
	for (const server of rpcServers.splice(0)) server.stop(true)
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function unusedPort() {
	const server = Bun.serve({ fetch: () => new Response('reserved'), hostname: '127.0.0.1', port: 0 })
	const port = server.port
	await server.stop(true)
	if (port === undefined) throw new Error('Temporary server did not expose a port')
	return port
}

function operatorState(): OperatorState {
	return {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: true,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		status: 'paused',
		tokenAddresses: [],
		tokenMarkets: [],
		settlements: emptySettlementSnapshot(),
		transactionActivity: [],
	}
}

/** Records every signer lock the control plane reserves or releases so execution activation can be asserted without files. */
function recordingLockManager() {
	const acquired: Address[] = []
	const released: ExclusiveProcessLock[] = []
	const locks = new Map<string, ExclusiveProcessLock>()
	const manager: ExecutionLockManager = {
		acquireSigner: async account => {
			acquired.push(account)
			const retained = locks.get(account.toLowerCase())
			if (retained !== undefined) return retained
			const lock: ExclusiveProcessLock = { path: `${account}.lock`, release: async () => undefined }
			locks.set(account.toLowerCase(), lock)
			return lock
		},
		release: async lock => {
			released.push(lock)
		},
	}
	return { acquired, manager, released }
}

/** A manifest whose identities are the selected network's canonical contracts; startup validation is not exercised here. */
async function sepoliaManifest(openOracle: Address, weth: Address) {
	return await createDeploymentManifest(
		'sepolia',
		11_155_111,
		[
			{ address: openOracle, role: 'open-oracle' },
			{ address: canonicalSecurityPoolFactory('sepolia'), role: 'security-pool-factory' },
			{ address: weth, role: 'weth' },
		],
		async () => '0x01',
	)
}

async function startControlPlane(parameters: { manifest?: boolean; privateKey?: Hex; quorumRpcUrls?: readonly string[]; readRpcUrl?: string; rpcQuorum?: 1 | 2 } = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-control-plane-'))
	temporaryDirectories.push(directory)
	const settingsFile = join(directory, 'operator.json')
	const settings = parseOperatorSettings({
		...example,
		connectivity: { publicRpcUrls: [parameters.readRpcUrl ?? 'https://public.example/'], readRpcUrl: parameters.readRpcUrl ?? 'https://read.example/' },
		deployment: { ...example.deployment, quorumRpcUrls: parameters.quorumRpcUrls ?? [] },
		network: 'sepolia',
		networkConfigured: true,
		rpcQuorum: parameters.rpcQuorum ?? 1,
		runtime: { ...example.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl'), uiPort: await unusedPort() },
	})
	const deploymentManifest = parameters.manifest === true ? await sepoliaManifest(settings.deployment.openOracle, settings.deployment.weth) : undefined
	await saveOperatorSettings(settingsFile, { ...settings, deployment: { ...settings.deployment, deploymentManifest } })
	const config = await loadConfiguration(settingsFile)
	config.privateKey = parameters.privateKey
	const state = operatorState()
	const fixedState: OperatorSnapshotFixedState & { deployment: DeploymentSettings } = {
		deployment: config.operatorSettings.deployment,
		execute: false,
		executor: undefined,
		expectedChainId: config.network.chain.id,
		explorerUrl: config.network.explorerUrl,
		network: config.network.name,
		networkConfigured: true,
		openOracle: config.openOracle,
		queuedWallet: undefined,
		savedWallet: undefined,
		wallet: parameters.privateKey === undefined ? undefined : privateKeyToAccount(parameters.privateKey).address,
	}
	const locks = recordingLockManager()
	const { dashboard, pending } = startOperatorControlPlane({
		config,
		deploymentRecovery: { pending: false },
		fixedState,
		getCursor: () => undefined,
		lockManager: locks.manager,
		signerOperationGate: createSignerOperationGate(),
		state,
	})
	if (dashboard === undefined) throw new Error('Control plane did not start a dashboard')
	dashboards.push(dashboard)
	const origin = `http://127.0.0.1:${config.uiPort.toString()}`
	const put = async (pathname: string, body: unknown) =>
		await fetch(`${origin}${pathname}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json', origin },
			method: 'PUT',
		})
	const publicState = async () => (await (await fetch(`${origin}/api/state`)).json()) as Record<string, unknown>
	return { config, fixedState, locks, pending, publicState, put, settingsFile, state }
}

test('focused settlement, risk-limit, and market-source forms persist their section and queue it for the scan boundary', async () => {
	const { pending, publicState, put, settingsFile, state } = await startControlPlane()
	expect((await publicState())['queuedSettings']).toEqual([])
	const settlement = await put('/api/settlement', { enabled: true, maxGasPriceNanoEth: '25', minimumProfitWeth: '0.002', rewardWithdrawThresholdEth: '0.05' })
	expect(settlement.status, await settlement.clone().text()).toBe(200)
	expect(await settlement.json()).toEqual({ settlement: { enabled: true, maxGasPriceNanoEth: '25', minimumProfitWeth: '0.002', rewardWithdrawThresholdEth: '0.05' } })
	expect(pending.settlement).toEqual({ enabled: true, maxGasPriceAttoEthPerGas: 25n * 10n ** 9n, minimumProfitAttoWeth: 2n * 10n ** 15n, rewardWithdrawThresholdAttoEth: 5n * 10n ** 16n })
	expect((await publicState())['queuedSettings']).toEqual(['settlement'])

	const rejectedSettlement = await put('/api/settlement', { enabled: 'yes', maxGasPriceNanoEth: '25', minimumProfitWeth: '0.002', rewardWithdrawThresholdEth: '0.05' })
	expect(rejectedSettlement.status).toBe(400)
	expect(await rejectedSettlement.json()).toEqual({ error: 'Settlement enabled must be a boolean' })
	expect(pending.settlement?.maxGasPriceAttoEthPerGas).toBe(25n * 10n ** 9n)

	const runtime = await put('/api/runtime-limits', {
		lookbackBlocks: '32',
		maxHedgeSlippageBps: '75',
		riskLimits: { lifecycleGasReserveWeth: '0.02', maxConcurrentPositions: 3, maxDailyGasSpendWeth: '0.1', maxPositionNotionalWeth: '2', maxTotalLockedWeth: '4' },
	})
	expect(runtime.status, await runtime.clone().text()).toBe(200)
	expect(await runtime.json()).toEqual({
		runtime: { lookbackBlocks: '32', maxHedgeSlippageBps: '75', riskLimits: { lifecycleGasReserveWeth: '0.02', maxConcurrentPositions: 3, maxDailyGasSpendWeth: '0.1', maxPositionNotionalWeth: '2', maxTotalLockedWeth: '4' } },
	})
	expect(pending.lookbackBlocks).toBe(32n)
	expect(pending.maxHedgeSlippageBps).toBe(75n)
	expect(pending.riskLimits?.maxConcurrentPositions).toBe(3)
	expect((await publicState())['queuedSettings']).toEqual(['risk', 'settlement'])
	expect((await put('/api/runtime-limits', { lookbackBlocks: '50000', maxHedgeSlippageBps: '75', riskLimits: { lifecycleGasReserveWeth: '0.02', maxConcurrentPositions: 3, maxDailyGasSpendWeth: '0.1', maxPositionNotionalWeth: '2', maxTotalLockedWeth: '4' } })).status).toBe(400)
	expect(pending.lookbackBlocks).toBe(32n)
	expect((await put('/api/runtime-limits', { execute: true, lookbackBlocks: '32', maxHedgeSlippageBps: '75', riskLimits: { lifecycleGasReserveWeth: '0.02', maxConcurrentPositions: 3, maxDailyGasSpendWeth: '0.1', maxPositionNotionalWeth: '2', maxTotalLockedWeth: '4' } })).status).toBe(400)

	const markets = await put('/api/centralized-markets', {
		...example.centralizedMarkets,
		assetAddress: '0x0000000000000000000000000000000000000001',
		assetChainId: 1,
		minimumSourceCount: 1,
		sources: [{ ethMarket: 'ETH/USDT', exchangeId: 'binance', repMarket: 'REP/USDT' }],
	})
	expect(markets.status, await markets.clone().text()).toBe(200)
	const marketBody = (await markets.json()) as { centralizedMarkets: Record<string, unknown> }
	expect(marketBody.centralizedMarkets['minimumSourceCount']).toBe(1)
	expect(marketBody.centralizedMarkets['sources']).toEqual([{ ethMarket: 'ETH/USDT', exchangeId: 'binance', repMarket: 'REP/USDT' }])
	expect(marketBody.centralizedMarkets).not.toHaveProperty('assetAddress')
	expect(pending.centralizedMarkets?.assetChainId).toBe(11_155_111)
	expect(pending.centralizedMarkets?.sources.map(source => source.exchangeId)).toEqual(['binance'])
	expect((await publicState())['queuedSettings']).toEqual(['markets', 'risk', 'settlement'])
	const unknownField = await put('/api/centralized-markets', { ...example.centralizedMarkets, unknownField: true })
	expect(unknownField.status).toBe(400)
	expect(await unknownField.json()).toEqual({ error: 'Unknown centralizedMarkets field: unknownField' })
	expect(pending.centralizedMarkets?.sources.map(source => source.exchangeId)).toEqual(['binance'])

	const saved = await loadOperatorSettings(settingsFile)
	expect(saved?.settlement.enabled).toBe(true)
	expect(saved?.runtime.lookbackBlocks).toBe(32n)
	expect(saved?.runtime.riskLimits.maxTotalLockedAttoWeth).toBe(4n * 10n ** 18n)
	expect(saved?.runtime.execute).toBe(false)
	expect(saved?.centralizedMarkets.minimumSourceCount).toBe(1)
	expect(state.operationLog.map(entry => entry.message)).toEqual(['REP market source policy saved and queued', 'Risk limits saved and queued', 'Third-party settlement enabled and saved'])
})

test('execution mode requires a startable live configuration and an active signer before reserving its lock', async () => {
	const withoutQuorum = await startControlPlane({ manifest: true, privateKey: `0x${'11'.repeat(32)}`, quorumRpcUrls: ['https://quorum-one.example/'], rpcQuorum: 2 })
	const blocked = await withoutQuorum.put('/api/execution', { execute: true })
	expect(blocked.status).toBe(400)
	expect(await blocked.json()).toEqual({ error: 'Execution is enabled, but live operation requires at least two independent quorum RPCs (three read endpoints total)' })
	expect(withoutQuorum.pending.execute).toBeUndefined()
	expect(withoutQuorum.locks.acquired).toEqual([])

	const withoutManifest = await startControlPlane({ privateKey: `0x${'11'.repeat(32)}`, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	const armedWithoutManifest = await withoutManifest.put('/api/execution', { execute: true })
	expect(armedWithoutManifest.status, await armedWithoutManifest.clone().text()).toBe(200)
	expect(withoutManifest.pending.execute).toBe(true)
	expect(withoutManifest.locks.acquired).toHaveLength(1)
	expect((await loadOperatorSettings(withoutManifest.settingsFile))?.runtime.execute).toBe(true)

	const withoutSigner = await startControlPlane({ manifest: true, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	const unsigned = await withoutSigner.put('/api/execution', { execute: true })
	expect(unsigned.status).toBe(400)
	expect(await unsigned.json()).toEqual({ error: 'Execution requires an active signer' })
	expect(withoutSigner.pending.execute).toBeUndefined()
	expect((await loadOperatorSettings(withoutSigner.settingsFile))?.runtime.execute).toBe(false)
	expect((await withoutSigner.put('/api/execution', { execute: true, extra: 1 })).status).toBe(400)
	expect((await withoutSigner.put('/api/execution', { execute: 'true' })).status).toBe(400)
})

test('execution mode reserves the running signer lock and pauses when enabled, and leaves the lock in place when disabled', async () => {
	const privateKey = `0x${'22'.repeat(32)}` as Hex
	const wallet = privateKeyToAccount(privateKey).address
	const { config, fixedState, locks, pending, publicState, put, settingsFile, state } = await startControlPlane({ manifest: true, privateKey, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	Object.assign(state, { paused: false, status: 'running' })
	expect((await publicState())['execute']).toBe(false)
	const enabled = await put('/api/execution', { execute: true })
	expect(enabled.status, await enabled.clone().text()).toBe(200)
	expect(await enabled.json()).toEqual({ execute: true })
	expect(pending.execute).toBe(true)
	expect(locks.acquired).toEqual([wallet])
	expect(pending.signerUpdate).toBe(true)
	expect(pending.privateKey).toBe(privateKey)
	expect(pending.signerLock).toBeDefined()
	expect(fixedState.queuedWallet).toBe(wallet)
	expect(pending.paused).toBe(true)
	expect(state.paused).toBe(true)
	expect(state.status).toBe('paused')
	const armed = await loadOperatorSettings(settingsFile)
	expect(armed?.runtime.execute).toBe(true)
	expect(armed?.paused).toBe(true)
	expect((await publicState())['execute']).toBe(true)
	expect((await publicState())['mode']).toBe('execute')
	expect((await publicState())['queuedSettings']).toEqual(['execution'])

	// Re-applying the armed mode is a no-op: no new lock, no second pause of an operator that was resumed meanwhile.
	Object.assign(state, { paused: false, status: 'running' })
	const again = await put('/api/execution', { execute: true })
	expect(again.status).toBe(200)
	expect(locks.acquired).toEqual([wallet])
	expect(locks.released).toEqual([])
	expect(state.paused).toBe(false)
	expect((await loadOperatorSettings(settingsFile))?.paused).toBe(true)

	// The scan boundary consumes the queued state: the pause and execute flags apply and the signer keeps the reserved lock.
	const queuedLock = pending.signerLock
	applyQueuedExecutionSettings(config, state, pending)
	expect(config.paused).toBe(true)
	expect(state.paused).toBe(true)
	Object.assign(config, { execute: true })
	const applied = await applyQueuedSigner({ activeSignerLock: undefined, config, createWallet: () => wallet, fixedState, lockManager: locks.manager, pending, state, walletAddress: current => current })
	expect(applied.activeSignerLock).toBe(queuedLock)
	expect(config.privateKey).toBe(privateKey)
	expect(fixedState.wallet).toBe(wallet)
	expect(pending.signerUpdate).toBe(false)
	expect(pending.signerLock).toBeUndefined()
	expect(locks.released).toEqual([])
	Object.assign(fixedState, { execute: true })
	Object.assign(pending, { execute: undefined })

	const disabled = await put('/api/execution', { execute: false })
	expect(disabled.status, await disabled.clone().text()).toBe(200)
	expect(await disabled.json()).toEqual({ execute: false })
	expect(pending.execute).toBe(false)
	// The running live scan can still sign until the boundary, so the snapshot keeps reporting live execution.
	expect((await publicState())['mode']).toBe('execute')
	expect(pending.signerUpdate).toBe(false)
	expect(locks.released).toEqual([])
	expect((await loadOperatorSettings(settingsFile))?.runtime.execute).toBe(false)
	expect(state.operationLog.map(entry => entry.message)).toEqual(['Dry-run mode saved and queued', `Live execution with signer ${wallet} saved and queued; operator paused`])
})

test('execution mode binds to a queued signer and skips lock acquisition when the running signer already executes', async () => {
	const runningKey = `0x${'33'.repeat(32)}` as Hex
	const queuedKey = `0x${'44'.repeat(32)}` as Hex
	const queuedWallet = privateKeyToAccount(queuedKey).address
	const queued = await startControlPlane({ manifest: true, privateKey: runningKey, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	queued.pending.signerUpdate = true
	queued.pending.privateKey = queuedKey
	queued.pending.persistedPrivateKey = undefined
	queued.fixedState.queuedWallet = queuedWallet
	expect((await queued.put('/api/execution', { execute: true })).status).toBe(200)
	expect(queued.locks.acquired).toEqual([queuedWallet])
	expect(queued.pending.privateKey).toBe(queuedKey)
	expect(queued.pending.signerLock).toBeDefined()

	const clearing = await startControlPlane({ manifest: true, privateKey: runningKey, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	clearing.pending.signerUpdate = true
	clearing.pending.privateKey = undefined
	const rejected = await clearing.put('/api/execution', { execute: true })
	expect(rejected.status).toBe(400)
	expect(await rejected.json()).toEqual({ error: 'Execution requires an active signer' })
	expect(clearing.locks.acquired).toEqual([])

	const live = await startControlPlane({ manifest: true, privateKey: runningKey, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	live.fixedState.execute = true
	live.config.execute = true
	expect((await live.put('/api/execution', { execute: true })).status).toBe(200)
	expect(live.locks.acquired).toEqual([])
	expect(live.pending.signerUpdate).toBe(false)
	expect(live.pending.execute).toBe(true)

	// Re-saving the running key queues it without a pending lock; the active lock still covers it, so none is reserved.
	const requeued = await startControlPlane({ manifest: true, privateKey: runningKey, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] })
	requeued.fixedState.execute = true
	requeued.config.execute = true
	requeued.pending.signerUpdate = true
	requeued.pending.privateKey = runningKey
	requeued.pending.persistedPrivateKey = runningKey
	expect((await requeued.put('/api/execution', { execute: true })).status).toBe(200)
	expect(requeued.locks.acquired).toEqual([])
	expect(requeued.pending.signerLock).toBeUndefined()
	expect(requeued.pending.privateKey).toBe(runningKey)
})

test('the RPC endpoints form saves quorum RPC URLs into the deployment section and queues them without touching identities', async () => {
	const readRpcUrl = mockSepoliaRpc()
	const quorumOne = mockSepoliaRpc()
	const quorumTwo = mockSepoliaRpc()
	const { config, pending, publicState, put, settingsFile, state } = await startControlPlane({ readRpcUrl, rpcQuorum: 2 })
	const before = await loadOperatorSettings(settingsFile)
	const request = { connectivity: { publicRpcUrls: [readRpcUrl], readRpcUrl }, network: 'sepolia', quorumRpcUrls: [quorumOne, quorumTwo], rpcQuorum: 2 }
	const saved = await put('/api/connectivity', request)
	expect(saved.status, await saved.clone().text()).toBe(200)
	expect(await saved.json()).toEqual({ connectivity: request.connectivity, network: 'sepolia', quorumRpcUrls: [quorumOne, quorumTwo], rpcQuorum: 2 })
	const after = await loadOperatorSettings(settingsFile)
	expect(after?.deployment.quorumRpcUrls).toEqual([quorumOne, quorumTwo])
	expect(after?.deployment.openOracle).toBe(before?.deployment.openOracle)
	expect(after?.deployment.uniswapV3Enabled).toBe(before?.deployment.uniswapV3Enabled)
	expect(pending.deployment?.quorumRpcUrls).toEqual([quorumOne, quorumTwo])
	expect(pending.deployment?.executor).toBe(config.operatorSettings.deployment.executor)
	expect(pending.connectivity?.readRpcUrl).toBe(readRpcUrl)
	expect(state.operationLog[0]?.message).toBe('Network and RPC configuration verified and saved')
	expect((await publicState())['queuedSettings']).toEqual(['connectivity', 'deployment'])

	// A quorum URL sharing the read RPC origin is rejected before anything is written.
	const collision = await put('/api/connectivity', { ...request, quorumRpcUrls: [`${readRpcUrl}alternate`] })
	expect(collision.status).toBe(400)
	expect(await collision.json()).toEqual({ error: 'Read RPC quorum must use independent origins; changing only the URL path does not create an independent provider' })
	expect((await loadOperatorSettings(settingsFile))?.deployment.quorumRpcUrls).toEqual([quorumOne, quorumTwo])
	expect(pending.deployment?.quorumRpcUrls).toEqual([quorumOne, quorumTwo])

	// Resubmitting the same URLs leaves the deployment section alone.
	const unchanged = await put('/api/connectivity', request)
	expect(unchanged.status).toBe(200)
	expect(pending.deployment?.quorumRpcUrls).toEqual([quorumOne, quorumTwo])
	const tooMany = await put('/api/connectivity', { ...request, quorumRpcUrls: Array.from({ length: 9 }, (_, index) => `https://quorum-${index.toString()}.example/`) })
	expect(tooMany.status).toBe(400)
	expect(await tooMany.json()).toEqual({ error: 'Quorum RPC URLs must contain no more than 8 URLs' })
})

test('deployment saves merge only the submitted fields into the latest stored section', async () => {
	const quorumOne = mockSepoliaRpc()
	const { pending, put, settingsFile } = await startControlPlane({ manifest: true, quorumRpcUrls: [quorumOne] })
	const before = await loadOperatorSettings(settingsFile)
	const venues = await put('/api/deployment', { uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: true })
	expect(venues.status, await venues.clone().text()).toBe(200)
	const afterVenues = await loadOperatorSettings(settingsFile)
	expect(afterVenues?.deployment.uniswapV4Enabled).toBe(true)
	expect(afterVenues?.deployment.uniswapV3Enabled).toBe(false)
	expect(afterVenues?.deployment.quorumRpcUrls).toEqual([quorumOne])
	expect(afterVenues?.deployment.deploymentManifest).toEqual(before?.deployment.deploymentManifest)
	expect(pending.deployment?.quorumRpcUrls).toEqual([quorumOne])
	const removed = await put('/api/deployment', { deploymentManifest: null })
	expect(removed.status, await removed.clone().text()).toBe(200)
	const afterRemoval = await loadOperatorSettings(settingsFile)
	expect(afterRemoval?.deployment.deploymentManifest).toBeUndefined()
	expect(afterRemoval?.deployment.uniswapV4Enabled).toBe(true)
	expect(afterRemoval?.deployment.quorumRpcUrls).toEqual([quorumOne])
	expect((await put('/api/deployment', { executor: '0x0000000000000000000000000000000000000001' })).status).toBe(400)
	expect((await loadOperatorSettings(settingsFile))?.deployment.uniswapV4Enabled).toBe(true)
})
