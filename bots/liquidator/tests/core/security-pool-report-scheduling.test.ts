import { expect, test } from 'bun:test'
import { executeSecurityPoolAutomation } from '../../src/runtime/scan-execution.ts'
import { createWalletClient, createRpcEndpointPool, getAddress, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolObservation, securityPoolSettings, unit } from '../support/security-pool-observation.ts'
import { SecurityPoolGasBudgetExceeded } from '../../src/execution/security-pool-executor.ts'

for (const pendingState of ['waiting', 'deselected', 'over-budget'] as const) {
	for (const action of ['takeover', 'recovery'] as const) {
		test(`a pending ${pendingState} report does not block another security pool's ${action}`, async () => {
			const first = securityPoolObservation()
			first.selected = pendingState !== 'deselected'
			const second = securityPoolObservation()
			second.selection = { ...second.selection, address: getAddress('0x0000000000000000000000000000000000000099') }
			second.snapshot.capitalLedger = second.selection.address
			const settings = securityPoolSettings()
			settings.centralizedMarkets.assetAddress = second.snapshot.repToken
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
			const runtime = { wallet, settings, readPool: createRpcEndpointPool(['https://read.example']) }
			const state = initialRuntimeState(false, account.address, 1)
			state.securityPools = [first, second]
			state.securityPoolFunding = {}
			if (action === 'recovery') {
				first.positions = []
				second.positions = []
				for (const observation of [first, second]) {
					observation.snapshot.ownerAccount.freeAttoRep = unit
					observation.snapshot.withdrawableAttoRep = unit
					const key = `${observation.snapshot.capitalLedger.toLowerCase()}:${observation.snapshot.owner.toLowerCase()}`
					state.securityPoolFunding[key] = { amount: unit, target: 1n }
				}
			}
			const calls: string[] = []
			const actions: Parameters<typeof executeSecurityPoolAutomation>[3] = {
				pendingReport: async (_wallet, _settings, _state, _pool, observation) => {
					if (observation !== first) return 'none'
					if (pendingState === 'over-budget') throw new SecurityPoolGasBudgetExceeded('Report settlement exceeds gas budget')
					return 'waiting'
				},
				earnings: async () => {
					throw new Error('Unexpected earnings action')
				},
				takeover: async (_wallet, _settings, _state, _pool, observation) => {
					expect(observation).toBe(second)
					calls.push('takeover')
				},
				unusedFunding: async (_wallet, _settings, _state, _pool, observation) => {
					expect(observation).toBe(second)
					calls.push('recovery')
					return true
				},
			}
			expect(await executeSecurityPoolAutomation(runtime, state, async () => true, actions)).toBe(true)
			expect(calls).toEqual([action])
		})
	}
}
