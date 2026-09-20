import { emptySettlementSnapshot } from '#state/settlement-store'
import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { executorArtifact } from '#contracts/artifacts.generated'
import { canonicalSecurityPoolFactory, networkConfiguration } from '#config/network'
import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarketConsensusEstimate, MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { authenticateConfiguredDeployments, refreshIncompleteCanonicalDeployments } from '#config/runtime-deployment'
import { validateDeploymentSettings } from '#config/deployment-settings'
import { loadConfiguration, runnableOperatorSettings } from '#config/configuration'
import type { OperatorState } from '#state/operator-state'
import type { PendingOperatorUpdates } from '../../src/runtime/operator-control-plane.ts'
import { applyQueuedExecutionSettings, recordScanDecision, resetReportScanState } from '../../src/runtime/operator-execution-state.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function exampleConfiguration() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-operator-execution-state-'))
	temporaryDirectories.push(directory)
	const settingsFile = join(directory, 'operator.json')
	await copyFile(new URL('../../config/operator.example.json', import.meta.url), settingsFile)
	return await loadConfiguration(settingsFile)
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
		paused: false,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		status: 'running',
		tokenAddresses: [],
		tokenMarkets: [],
		settlements: emptySettlementSnapshot(),
		transactionActivity: [],
	}
}

function noPendingUpdates(): PendingOperatorUpdates {
	return {
		centralizedMarkets: undefined,
		connectivity: undefined,
		deployment: undefined,
		execute: undefined,
		lookbackBlocks: undefined,
		maxHedgeSlippageBps: undefined,
		network: undefined,
		operatorSettings: undefined,
		paused: undefined,
		profileSwitch: false,
		privateKey: undefined,
		persistedPrivateKey: undefined,
		persistedTokenAddresses: undefined,
		riskLimits: undefined,
		rpcQuorum: undefined,
		settlement: undefined,
		signerLock: undefined,
		signerUpdate: false,
		strategy: undefined,
		submission: undefined,
		tokenAddresses: undefined,
	}
}

function sourceObservation(sourceId: string): MarketConsensusObservation {
	return { assetId: '0x0000000000000000000000000000000000000001', askDepthAttoEth: 1n, bidDepthAttoEth: 1n, chainId: 1, kind: 'cex', observationId: `${sourceId}:1`, observedAt: 1_000, priceRepPerEth: 10n, sourceId }
}

function reliableConsensus(observation: MarketConsensusObservation): MarketConsensusEstimate {
	const group = { askDepthAttoEth: 1n, bidDepthAttoEth: 1n, kind: 'cex' as const, maximumPriceRepPerEth: 10n, minimumPriceRepPerEth: 10n, observations: [observation], priceRepPerEth: 10n, reliable: true, reasons: [] }
	return { assetId: observation.assetId, cex: group, chainId: 1, dex: { ...group, kind: 'dex', observations: [], reliable: false }, priceRepPerEth: 10n, reliable: true, reasons: [], sourceCount: 1 }
}

test('logs a decision entry for priced reports only; skipped reports already logged their gate', () => {
	const state = operatorState()
	const token = `0x${'1'.repeat(40)}` as const
	recordScanDecision(state, { decision: 'skipped', reason: 'No configured pool can price REP', reportId: '11', token, tokenSymbol: 'REP', timeRemaining: '240', windowUnit: 'seconds' })
	expect(state.operationLog).toEqual([])
	recordScanDecision(state, {
		centralizedPriceDeviationBps: undefined,
		decision: 'unprofitable',
		direction: 'sell-rep',
		estimatedNetProfitEth: '-0.1',
		estimatedNetProfitWeth: '-0.1',
		executablePriceRepPerEth: '10',
		hasRequiredInventory: undefined,
		pool: token,
		poolFee: 3_000,
		reportId: '12',
		requiredToken: '1',
		requiredWeth: '1',
		token,
		tokenSymbol: 'REP',
		timeRemaining: '10',
		windowUnit: 'blocks',
	})
	expect(state.operationLog).toMatchObject([{ category: 'decision', details: 'direction=sell-rep estimatedProfitEth=-0.1', level: 'info', message: 'Decision: unprofitable', reportId: '12' }])
})

test('applies queued settlement settings at the scan boundary and clears the queue entry', async () => {
	const config = await exampleConfiguration()
	const state = operatorState()
	const pending = noPendingUpdates()
	pending.settlement = { enabled: true, maxGasPriceAttoEthPerGas: 7n * 10n ** 9n, minimumProfitAttoWeth: 2n * 10n ** 15n, rewardWithdrawThresholdAttoEth: 3n * 10n ** 16n }
	expect(config.settlement.enabled).toBe(false)
	applyQueuedExecutionSettings(config, state, pending)
	expect(config.settlement).toEqual({ enabled: true, maxGasPriceAttoEthPerGas: 7n * 10n ** 9n, minimumProfitAttoWeth: 2n * 10n ** 15n, rewardWithdrawThresholdAttoEth: 3n * 10n ** 16n })
	expect(pending.settlement).toBeUndefined()
})

describe('queued operator execution settings', () => {
	test('removes old-source evidence before a replacement source can authorize execution', async () => {
		const config = await exampleConfiguration()
		const state = operatorState()
		const observation = sourceObservation('source-a')
		state.marketObservations = [observation]
		state.marketConsensus = reliableConsensus(observation)
		const pending = noPendingUpdates()
		pending.centralizedMarkets = { ...config.centralizedMarkets, sources: [{ ethMarket: undefined, exchangeId: 'source-b', repMarket: 'REP/ETH' }] }

		expect(applyQueuedExecutionSettings(config, state, pending)).toEqual({ reportScanReset: false })
		expect(config.centralizedMarkets.sources.map(source => source.exchangeId)).toEqual(['source-b'])
		expect(state.marketObservations).toEqual([])
		expect(state.marketConsensus).toBeUndefined()
		expect(pending.centralizedMarkets).toBeUndefined()
	})

	test('requests a complete report-window rebuild only when the bounded lookback changes', async () => {
		const config = await exampleConfiguration()
		const state = operatorState()
		const pending = noPendingUpdates()
		const expandedLookbackBlocks = config.lookbackBlocks + 16n
		pending.lookbackBlocks = expandedLookbackBlocks
		expect(applyQueuedExecutionSettings(config, state, pending)).toEqual({ reportScanReset: true })
		expect(config.lookbackBlocks).toBe(expandedLookbackBlocks)
		expect(pending.lookbackBlocks).toBeUndefined()
		const unchanged = noPendingUpdates()
		unchanged.lookbackBlocks = config.lookbackBlocks
		expect(applyQueuedExecutionSettings(config, state, unchanged)).toEqual({ reportScanReset: false })
	})

	test('clears every derived report view for a complete report-window rebuild', () => {
		const reports = new Map([[1n, { reportId: 1n }]])
		const state: {
			activeReportCount: number
			marketConsensus?: unknown
			marketObservations?: unknown[]
			opportunities: unknown[]
			reportPaths: unknown[]
			status: 'running' | 'syncing'
			tokenMarkets: unknown[]
		} = {
			activeReportCount: 1,
			marketConsensus: { reliable: true },
			marketObservations: [{ sourceId: 'source-a' }],
			opportunities: [{ reportId: '1' }],
			reportPaths: [{ reportId: '1' }],
			status: 'running',
			tokenMarkets: [{ token: 'REP' }],
		}
		const reset = resetReportScanState<{ blockNumber: bigint }>(state, reports)
		expect(reset).toEqual({ cachedLogs: [], cursor: undefined })
		expect(reports.size).toBe(0)
		expect(state).toEqual({
			activeReportCount: 0,
			marketConsensus: undefined,
			marketObservations: [],
			opportunities: [],
			reportPaths: [],
			status: 'syncing',
			tokenMarkets: [],
		})
	})
})

test('V4-only execution starts and authenticates without a manifest or V3 deployment identities', async () => {
	const config = await exampleConfiguration()
	const deployment = validateDeploymentSettings({ coordinatorAddresses: [config.openOracle], executor: config.openOracle, quorumRpcUrls: ['https://second.example', 'https://third.example'], uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: true }, config.network.name)
	const manager = deployment.uniswapV4PoolManager
	const quoter = deployment.uniswapV4Quoter
	if (manager === undefined || quoter === undefined) throw new Error('Expected the canonical V4 pair')
	const settings = { ...config.operatorSettings, rpcQuorum: 2 as const, deployment, runtime: { ...config.operatorSettings.runtime, execute: true } }
	expect(runnableOperatorSettings(config.settingsFile, settings).deployment.uniswapRouter).toBeUndefined()
	const reads: string[] = []
	const client = createPublicClient({
		chain: config.network.chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Unexpected authentication request')
				reads.push(params[0])
				if (params[0].toLowerCase() === canonicalExecutorIdentity().address.toLowerCase()) return `0x${executorArtifact.evm.deployedBytecode.object}`
				if ([config.network.factory, config.network.quoter].some(address => address.toLowerCase() === String(params[0]).toLowerCase())) throw new Error('V3 is absent')
				return '0x01'
			},
		}),
	})
	await authenticateConfiguredDeployments([client, client], {
		...config,
		execute: true,
		executor: deployment.executor,
		coordinatorAddresses: [...deployment.coordinatorAddresses],
		router: undefined,
		v2Router: undefined,
		v4PoolManager: manager,
		v4Quoter: quoter,
		quorumRpcUrls: ['https://second.example', 'https://third.example'],
	})
	expect(reads.length).toBeGreaterThan(0)
	expect(() => runnableOperatorSettings(config.settingsFile, { ...settings, deployment: { ...settings.deployment, uniswapV4PoolManager: undefined, uniswapV4Quoter: undefined } })).toThrow('at least one enabled Uniswap venue')
})

for (const code of ['0x', '0x01'] as const)
	test(`rejects canonical executor with missing or wrong code (${code})`, async () => {
		const config = await exampleConfiguration()
		const client = createPublicClient({ chain: config.network.chain, transport: custom({ request: async () => code }) })
		await expect(authenticateConfiguredDeployments([client], { ...config, execute: true, router: undefined, v2Router: undefined, v4PoolManager: undefined, v4Quoter: undefined })).rejects.toThrow('Canonical executor is missing or has unexpected bytecode')
	})

test('dry-run authentication reports the missing executor and contracts without failing', async () => {
	const config = await exampleConfiguration()
	const deployedExecutor = `0x${executorArtifact.evm.deployedBytecode.object}` as const
	let executorCode: string = '0x'
	const missing = new Set([config.network.weth.toLowerCase()])
	let reads = 0
	const client = createPublicClient({
		chain: config.network.chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Unexpected deployment read')
				reads += 1
				const address = params[0].toLowerCase()
				if (address === canonicalExecutorIdentity().address.toLowerCase()) return executorCode
				return missing.has(address) ? '0x' : '0x01'
			},
		}),
	})
	const dryRun = { ...config, execute: false, router: undefined, v2Router: undefined, v4PoolManager: undefined, v4Quoter: undefined }
	const absent = await authenticateConfiguredDeployments([client], dryRun)
	expect(absent.executor).toBe('missing')
	expect(absent.contracts.map(contract => [contract.role, contract.deployed])).toEqual([
		['open-oracle', true],
		['weth', false],
		['security-pool-factory', true],
	])
	await expect(authenticateConfiguredDeployments([client], { ...dryRun, execute: true })).rejects.toThrow('Canonical executor is missing or has unexpected bytecode; deploy the bundled executor')
	executorCode = '0x01'
	expect((await authenticateConfiguredDeployments([client], dryRun)).executor).toBe('mismatched')
	executorCode = deployedExecutor
	// An incomplete inspection is repeated every scan; the executor deployed meanwhile shows up, and WETH is still reported absent.
	const wethMissing = await refreshIncompleteCanonicalDeployments([client], dryRun, absent)
	expect(wethMissing.executor).toBe('deployed')
	await expect(authenticateConfiguredDeployments([client], { ...dryRun, execute: true })).rejects.toThrow(`Canonical weth ${config.network.weth} is not deployed`)
	missing.clear()
	const verified = await refreshIncompleteCanonicalDeployments([client], dryRun, wethMissing)
	expect(verified.contracts.every(contract => contract.deployed)).toBe(true)
	// A verified inspection holds without further RPC reads until the settings change.
	const readsAfterVerification = reads
	expect(await refreshIncompleteCanonicalDeployments([client], dryRun, verified)).toBe(verified)
	expect(reads).toBe(readsAfterVerification)
})

test('live authentication tolerates a lagging endpoint once the quorum has verified the deployments', async () => {
	const config = await exampleConfiguration()
	const clientReporting = (executorCode: string) =>
		createPublicClient({
			chain: config.network.chain,
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Unexpected deployment read')
					return params[0].toLowerCase() === canonicalExecutorIdentity().address.toLowerCase() ? executorCode : '0x01'
				},
			}),
		})
	const verified = clientReporting(`0x${executorArtifact.evm.deployedBytecode.object}`)
	const lagging = clientReporting('0x')
	const foreign = clientReporting('0x01')
	const live = { ...config, execute: true, router: undefined, v2Router: undefined, v4PoolManager: undefined, v4Quoter: undefined, quorumRpcUrls: ['https://second.example', 'https://third.example'] }
	expect((await authenticateConfiguredDeployments([lagging, verified], live)).executor).toBe('deployed')
	// Without a verifying endpoint the incomplete observation is what the operator rejects.
	await expect(authenticateConfiguredDeployments([lagging, lagging], live)).rejects.toThrow('Canonical executor is missing or has unexpected bytecode')
	await expect(authenticateConfiguredDeployments([lagging, verified], { ...live, executor: config.openOracle })).rejects.toThrow('Executor must use the canonical derived address')
	// Lag never produces foreign bytecode at the canonical address, so a mismatch is never set aside as a lagging endpoint.
	await expect(authenticateConfiguredDeployments([verified, foreign], live)).rejects.toThrow('Canonical executor is missing or has unexpected bytecode')
	expect((await authenticateConfiguredDeployments([verified, foreign], { ...live, execute: false })).executor).toBe('deployed')
	const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
	process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
	try {
		expect((await authenticateConfiguredDeployments([lagging, verified, verified], live)).executor).toBe('deployed')
		await expect(authenticateConfiguredDeployments([lagging, lagging, verified], live)).rejects.toThrow('Canonical executor is missing or has unexpected bytecode')
		const offline = createPublicClient({
			chain: config.network.chain,
			transport: custom({
				request: async () => {
					throw new Error('fetch failed')
				},
			}),
		})
		await expect(authenticateConfiguredDeployments([offline, offline, verified], live)).rejects.toThrow('Deployment authentication requires at least two independent RPC endpoints')
	} finally {
		if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
		else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
	}
})

for (const name of ['mainnet', 'sepolia'] as const)
	test(`canonical ${name} deployment checks work without pins and reject every missing required contract`, async () => {
		const base = await exampleConfiguration()
		const deployment = validateDeploymentSettings({ quorumRpcUrls: [], uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: false }, name)
		const config = { ...base, network: networkConfiguration(name), openOracle: deployment.openOracle, router: deployment.uniswapRouter, v2Router: deployment.uniswapV2Router, execute: true }
		const expected = [config.openOracle, config.network.weth, canonicalSecurityPoolFactory(config.network.name), config.network.factory, config.network.quoter, config.router, config.v2Router].filter(address => address !== undefined)
		let missing: string | undefined
		const reads = new Set<string>()
		const client = createPublicClient({
			chain: config.network.chain,
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Unexpected deployment read')
					const address = params[0].toLowerCase()
					reads.add(address)
					if (address === canonicalExecutorIdentity().address.toLowerCase()) return `0x${executorArtifact.evm.deployedBytecode.object}`
					return address === missing ? '0x' : '0x01'
				},
			}),
		})
		await authenticateConfiguredDeployments([client], config)
		for (const address of expected) {
			expect(reads.has(address.toLowerCase())).toBe(true)
			missing = address.toLowerCase()
			await expect(authenticateConfiguredDeployments([client], config)).rejects.toThrow('is not deployed')
		}
	})
