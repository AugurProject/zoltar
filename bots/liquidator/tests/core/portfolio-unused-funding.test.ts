import { expect, test } from 'bun:test'
import { executeUnusedPortfolioFunding, unusedPortfolioFunding } from '#execution/portfolio-unused-funding'
import { initialRuntimeState } from '#state/operator-state'
import { applyPortfolioFundingEffect } from '#state/portfolio-instructions'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import type { submitCall } from '#execution/submit-call'
import type { refreshPortfolioExecution } from '#execution/portfolio-executor'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

test('unused funding is bounded by tracked, free and withdrawable REP, and consumption removes its journal', () => {
	const observation = portfolioObservation()
	const key = `${observation.snapshot.capitalLedger.toLowerCase()}:${observation.snapshot.owner.toLowerCase()}`
	const state = { portfolioFunding: { [key]: { amount: 10n, target: 8n } } }
	observation.snapshot.ownerAccount.freeAttoRep = 7n
	observation.snapshot.withdrawableAttoRep = 5n
	expect(unusedPortfolioFunding(state, observation)).toEqual({ key, amount: 5n, target: 8n })
	expect(applyPortfolioFundingEffect(state.portfolioFunding, { key, operation: 'withdraw', amount: 5n })).toEqual({ [key]: { amount: 5n, target: 8n } })
	expect(applyPortfolioFundingEffect(state.portfolioFunding, { key, operation: 'consume', amount: 0n })).toEqual({})
})

test('unwind rechecks the original target even outside the current discovery page', async () => {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.runtime.execute = true
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	observation.snapshot.owner = account.address
	observation.snapshot.ownerAccount.freeAttoRep = 70n * unit
	observation.snapshot.ownerPrincipalAttoRep = 70n * unit
	observation.snapshot.withdrawableAttoRep = 70n * unit
	const state = initialRuntimeState(false, account.address, 1)
	const key = `${observation.snapshot.capitalLedger.toLowerCase()}:${account.address.toLowerCase()}`
	state.portfolioFunding = { [key]: { amount: 60n * unit, target: 1n } }
	const pool = createRpcEndpointPool(['https://unused.example'])
	const targets: unknown[] = []
	let viable = true
	const refresh: typeof refreshPortfolioExecution = async (_wallet, _settings, _scopes, _pool, _target, id) => {
		targets.push(id)
		return { observation: { ...observation, positions: id === undefined || !viable ? [] : observation.positions }, totalPrincipal: 70n * unit, allowance: 0n }
	}
	const calls: Parameters<typeof submitCall>[4][] = []
	const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
		await call.preSubmit?.()
		calls.push(call)
		return `0x${'1'.repeat(64)}`
	}
	const target = { ...observation, positions: [] }
	await expect(executeUnusedPortfolioFunding(wallet, settings, state, pool, target, async () => true, { refresh, submit })).rejects.toThrow('still viable')
	expect(targets).toContain(1n)
	expect(calls).toHaveLength(0)
	viable = false
	expect(await executeUnusedPortfolioFunding(wallet, settings, state, pool, target, async () => true, { refresh, submit })).toBe(true)
	expect(calls[0]?.portfolioFunding).toEqual({ key, operation: 'withdraw', amount: 60n * unit })
})
