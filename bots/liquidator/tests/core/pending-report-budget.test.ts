import { openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import { expect, test } from 'bun:test'
import { createRpcEndpointPool, createWalletClient, privateKeyToAccount, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { decodeFunctionResult, encodeAbiParameters, mainnet } from '@zoltar/core-shared/evm/ethereum'
import { executePendingPortfolioReport } from '../../src/execution/portfolio-report.ts'
import { PortfolioOpportunityExpired } from '../../src/execution/portfolio-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioClient } from '../support/portfolio-client.ts'
import type { PortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { ownerAddress, targetAddress } from '../support/portfolio-observation.ts'

test.each([0n, 3600n])('sponsored report gas budget defers settlement or recovery without a safety pause (settled %s)', async settledAt => {
	const gameAbi = openOracleAbi.find(item => item.type === 'function' && item.name === 'storedGame')
	if (gameAbi === undefined || gameAbi.type !== 'function') throw new Error('Stored game ABI missing')
	const pending: NonNullable<PortfolioObservation['pendingOperationReport']> = {
		id: 7n,
		oracle: targetAddress,
		reservedRep: 0n,
		game: decodeFunctionResult({ abi: openOracleAbi, functionName: 'storedGame', data: encodeAbiParameters(gameAbi.outputs, [1n, 1n, targetAddress, 1n, settledAt, ownerAddress, 0n, 480n, 0n, zeroAddress, 101n, targetAddress, 1n, 0n, 0n, 100n, targetAddress, 7_000_000n, 0n, 1n]) }),
		helper: Object.assign([targetAddress, 0n, 0n] as const, { creator: targetAddress, blockTimestamp: 0n, blockNumber: 0n }),
	}
	const f = portfolioClient({
		sponsorOperationReport: 7n,
		reportOutcome: 0n,
		reportCandidates: [targetAddress, ownerAddress, 0n],
		openOracle: targetAddress,
		storedGame: pending.game,
		storedHelper: pending.helper,
		tokenHolder: 0n,
	})
	f.settings.runtime.execute = true
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected wallet RPC')
			},
		}),
	})
	// The approved owner must match the indexed report sponsor.
	f.values['reportCandidates'] = [targetAddress, account.address, 0n]
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [f.observation.nextScope]
	f.observation.pendingOperationReport = pending
	await expect(
		executePendingPortfolioReport(
			wallet,
			f.settings,
			state,
			createRpcEndpointPool(['https://read.example']),
			f.observation,
			async (_wallet, _settings, _state, _pool, call) => {
				call.gasBudgetExceeded?.()
				throw new Error('Gas budget failure would safety-pause')
			},
			[{ endpoint: 'https://read.example', client: f.client }],
		),
	).rejects.toBeInstanceOf(PortfolioOpportunityExpired)
	expect(state.paused).toBe(false)
})
