import { expect, test } from 'bun:test'
import { executeUnusedSecurityPoolFunding, unusedSecurityPoolFunding } from '#execution/security-pool-unused-funding'
import { initialRuntimeState } from '#state/operator-state'
import { applySecurityPoolFundingEffect } from '#state/security-pool-instructions'
import { createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { recordingSubmit } from '../support/security-pool-execution.ts'
import type { refreshSecurityPoolExecution } from '#execution/security-pool-executor'
import { securityPoolObservation, securityPoolSettings, unit } from '../support/security-pool-observation.ts'

test('unused funding is bounded by tracked, free and withdrawable REP, and consumption removes its journal', () => {
	const observation = securityPoolObservation()
	const key = `${observation.snapshot.capitalLedger.toLowerCase()}:${observation.snapshot.owner.toLowerCase()}`
	const state = { securityPoolFunding: { [key]: { amount: 10n, target: 8n } } }
	observation.snapshot.ownerAccount.freeAttoRep = 7n
	observation.snapshot.withdrawableAttoRep = 5n
	expect(unusedSecurityPoolFunding(state, observation)).toEqual({ key, amount: 5n, target: 8n })
	expect(applySecurityPoolFundingEffect(state.securityPoolFunding, { key, operation: 'withdraw', amount: 5n })).toEqual({ [key]: { amount: 5n, target: 8n } })
	expect(applySecurityPoolFundingEffect(state.securityPoolFunding, { key, operation: 'consume', amount: 0n })).toEqual({})
})

test('unwind rechecks the original target even outside the current discovery page', async () => {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
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
	state.securityPoolFunding = { [key]: { amount: 60n * unit, target: 1n } }
	const pool = createRpcEndpointPool(['https://unused.example'])
	const targets: unknown[] = []
	let viable = true
	const refresh: typeof refreshSecurityPoolExecution = async (_wallet, _settings, _scopes, _pool, _target, id) => {
		targets.push(id)
		return { observation: { ...observation, positions: id === undefined || !viable ? [] : observation.positions }, totalPrincipal: 70n * unit, allowance: 0n }
	}
	const { calls, submit } = recordingSubmit()
	const target = { ...observation, positions: [] }
	await expect(executeUnusedSecurityPoolFunding(wallet, settings, state, pool, target, async () => true, { refresh, submit })).rejects.toThrow('still viable')
	expect(targets).toContain(1n)
	expect(calls).toHaveLength(0)
	viable = false
	expect(await executeUnusedSecurityPoolFunding(wallet, settings, state, pool, target, async () => true, { refresh, submit })).toBe(true)
	expect(calls[0]?.securityPoolFunding).toEqual({ key, operation: 'withdraw', amount: 60n * unit })
	expect(() => calls[0]?.gasBudgetExceeded?.()).toThrow('Unused funding withdrawal exceeds gas budget')
})
