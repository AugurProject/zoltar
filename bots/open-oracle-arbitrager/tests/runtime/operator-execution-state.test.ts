import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarketConsensusEstimate, MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { loadConfiguration } from '#config/configuration'
import type { OperatorState } from '#state/operator-state'
import type { PendingOperatorUpdates } from '../../src/runtime/operator-control-plane.ts'
import { applyQueuedExecutionSettings, resetReportScanState } from '../../src/runtime/operator-execution-state.ts'

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
