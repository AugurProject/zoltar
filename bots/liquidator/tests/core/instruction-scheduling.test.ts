import { expect, test } from 'bun:test'
import { executeSecurityPoolAutomation, executeQueuedSecurityPoolInstructions } from '../../src/runtime/scan-execution.ts'
import { SecurityPoolGasBudgetExceeded, SecurityPoolOpportunityExpired } from '../../src/execution/security-pool-executor.ts'
import { securityPoolInstructionKind } from '../../src/execution/security-pool-instructions.ts'
import type { SecurityPoolInstruction } from '../../src/config/security-pool-instructions.ts'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolObservation, securityPoolSettings } from '../support/security-pool-observation.ts'

const instruction = (id: string): SecurityPoolInstruction => ({ id, action: 'auction-refund', bidId: 1n, securityPool: securityPoolObservation().selection.address, universeId: 0n })

test('#1450 an over-budget queued instruction stays queued while later instructions and takeover automation still run', async () => {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
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
	state.securityPools = [observation]
	const attempted: string[] = []
	const instructionExecuted = await executeQueuedSecurityPoolInstructions(state, [instruction('over-budget'), instruction('blocked')], async current => {
		attempted.push(current.id)
		throw new SecurityPoolOpportunityExpired('Estimated instruction gas exceeds strategy.maximumGasCostEth')
	})
	expect(instructionExecuted).toBe(false)
	expect(attempted).toEqual(['over-budget', 'blocked'])
	expect(state.completedSecurityPoolInstructions ?? {}).toEqual({})
	expect(state.activities.map(activity => [activity.status, activity.message, activity.details])).toEqual([
		['info', 'Security pool instruction blocked deferred; retry next cycle', 'Estimated instruction gas exceeds strategy.maximumGasCostEth'],
		['info', 'Security pool instruction over-budget deferred; retry next cycle', 'Estimated instruction gas exceeds strategy.maximumGasCostEth'],
	])

	const takeovers: unknown[] = []
	observation.snapshot.accruedFeesAttoEth = settings.strategy.maximumGasCostAttoEth + settings.securityPoolPolicy.minimumNetRewardAttoEth
	let earningsChecks = 0
	const actions: Parameters<typeof executeSecurityPoolAutomation>[3] = {
		pendingReport: async () => 'none',
		earnings: async () => {
			earningsChecks++
			throw new SecurityPoolGasBudgetExceeded('Earnings exceed gas budget')
		},
		takeover: async (_wallet, _settings, _state, _pool, target) => {
			takeovers.push(target)
		},
		unusedFunding: async () => false,
	}
	expect(await executeSecurityPoolAutomation({ wallet, settings, readPool: createRpcEndpointPool(['https://read.example']) }, state, async () => true, actions)).toBe(true)
	expect(earningsChecks).toBe(1)
	expect(takeovers).toEqual([observation])
})

test('queued instructions stop at the first submission and rethrow unexpected failures', async () => {
	const state = initialRuntimeState(false, undefined, 1)
	const attempted: string[] = []
	expect(
		await executeQueuedSecurityPoolInstructions(state, [instruction('first'), instruction('second')], async current => {
			attempted.push(current.id)
			return true
		}),
	).toBe(true)
	expect(attempted).toEqual(['first'])
	await expect(
		executeQueuedSecurityPoolInstructions(state, [instruction('failing')], async () => {
			throw new Error('Pending recovery or dry-run mode blocks security pool instructions')
		}),
	).rejects.toThrow('Pending recovery')
})

test('journals each security pool instruction by its effect on funds', () => {
	expect(securityPoolInstructionKind('vault-health')).toBe('configuration')
	expect(securityPoolInstructionKind('vault-earnings')).toBe('fees')
	expect(securityPoolInstructionKind('vault-withdraw')).toBe('withdrawal')
	expect(securityPoolInstructionKind('vault-deposit')).toBe('deposit')
	expect(securityPoolInstructionKind('auction-bid')).toBe('deposit')
	expect(securityPoolInstructionKind('vault-fork-choice')).toBe('migration')
})
