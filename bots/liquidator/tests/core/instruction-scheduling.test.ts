import { expect, test } from 'bun:test'
import { executePortfolioAutomation, executeQueuedPortfolioInstructions } from '../../src/runtime/scan-execution.ts'
import { PortfolioOpportunityExpired } from '../../src/execution/portfolio-executor.ts'
import type { PortfolioInstruction } from '../../src/config/portfolio-instructions.ts'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings } from '../support/portfolio-observation.ts'

const instruction = (id: string): PortfolioInstruction => ({ id, action: 'auction-refund', bidId: 1n, portfolio: portfolioObservation().selection.address, universeId: 0n })

test('#1450 an over-budget queued instruction stays queued while later instructions and takeover automation still run', async () => {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.centralizedMarkets.assetAddress = observation.snapshot.repToken
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const wallet = createWalletClient({
		account,
		chain: chainFor(settings),
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC call')
			},
		}),
	})
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolios = [observation]
	const attempted: string[] = []
	const instructionExecuted = await executeQueuedPortfolioInstructions(state, [instruction('over-budget'), instruction('blocked')], async current => {
		attempted.push(current.id)
		throw new PortfolioOpportunityExpired('Estimated instruction gas exceeds strategy.maximumGasCostEth')
	})
	expect(instructionExecuted).toBe(false)
	expect(attempted).toEqual(['over-budget', 'blocked'])
	expect(state.completedPortfolioInstructions ?? {}).toEqual({})
	expect(state.activities.map(activity => [activity.status, activity.message, activity.details])).toEqual([
		['info', 'Portfolio instruction blocked deferred; retry next cycle', 'Estimated instruction gas exceeds strategy.maximumGasCostEth'],
		['info', 'Portfolio instruction over-budget deferred; retry next cycle', 'Estimated instruction gas exceeds strategy.maximumGasCostEth'],
	])

	const takeovers: unknown[] = []
	const actions: Parameters<typeof executePortfolioAutomation>[3] = {
		pendingReport: async () => 'none',
		earnings: async () => {
			throw new Error('Unexpected earnings action')
		},
		takeover: async (_wallet, _settings, _state, _pool, target) => {
			takeovers.push(target)
		},
		unusedFunding: async () => false,
	}
	expect(await executePortfolioAutomation({ wallet, settings, readPool: createRpcEndpointPool(['https://read.example']) }, state, async () => true, actions)).toBe(true)
	expect(takeovers).toEqual([observation])
})

test('queued instructions stop at the first submission and rethrow unexpected failures', async () => {
	const state = initialRuntimeState(false, undefined, 1)
	const attempted: string[] = []
	expect(
		await executeQueuedPortfolioInstructions(state, [instruction('first'), instruction('second')], async current => {
			attempted.push(current.id)
			return true
		}),
	).toBe(true)
	expect(attempted).toEqual(['first'])
	await expect(
		executeQueuedPortfolioInstructions(state, [instruction('failing')], async () => {
			throw new Error('Pending recovery or dry-run mode blocks portfolio instructions')
		}),
	).rejects.toThrow('Pending recovery')
})
