import { expect, test } from 'bun:test'
import { executePortfolioAutomation } from '../../src/runtime/scan-execution.ts'
import { createWalletClient, createRpcEndpointPool, getAddress, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { chainFor } from '../../src/monitoring/operator-chain.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

for (const tracked of [false, true]) {
	for (const deselected of [false, true]) {
		for (const action of ['takeover', 'recovery'] as const) {
			test(`a ${tracked ? 'tracked settled' : 'pending'} ${deselected ? 'deselected' : 'waiting'} report does not block another portfolio's ${action}`, async () => {
				const first = portfolioObservation()
				first.selected = !deselected
				const second = portfolioObservation()
				second.selection = { ...second.selection, address: getAddress('0x0000000000000000000000000000000000000099') }
				second.snapshot.capitalLedger = second.selection.address
				const settings = portfolioSettings()
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
				state.portfolios = [first, second]
				state.portfolioFunding = {}
				if (tracked) state.sponsoredReports = [{ feed: first.snapshot.priceFeed, fundingKey: `${first.snapshot.capitalLedger.toLowerCase()}:${first.snapshot.owner.toLowerCase()}`, sponsor: first.snapshot.owner, reportId: 7n, createdBlock: 1n, nextBlock: 1n }]
				if (action === 'recovery') {
					first.positions = []
					second.positions = []
					for (const observation of [first, second]) {
						observation.snapshot.ownerAccount.freeAttoRep = unit
						observation.snapshot.withdrawableAttoRep = unit
						const key = `${observation.snapshot.capitalLedger.toLowerCase()}:${observation.snapshot.owner.toLowerCase()}`
						state.portfolioFunding[key] = { amount: unit, target: 1n }
					}
				}
				const calls: string[] = []
				const actions: Parameters<typeof executePortfolioAutomation>[3] = {
					pendingReport: async (_wallet, _settings, _state, _pool, observation) => (observation === first && !tracked ? 'waiting' : 'none'),
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
				expect(await executePortfolioAutomation(runtime, state, async () => true, actions)).toBe(true)
				expect(calls).toEqual([action])
			})
		}
	}
}
