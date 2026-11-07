import { expect, test } from 'bun:test'
import { executePortfolioEarnings } from '../../src/execution/portfolio-earnings.ts'
import type { refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import type { submitCall } from '../../src/execution/submit-call.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'
import { createWalletClient, createRpcEndpointPool, decodeFunctionData, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'

function fixture() {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.runtime.execute = true
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	observation.snapshot.owner = account.address
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	const pool = createRpcEndpointPool(['https://read.example'])
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [observation.nextScope]
	const refresh: typeof refreshPortfolioExecution = async () => ({ observation, totalPrincipal: 0n, allowance: 0n })
	const calls: Parameters<typeof submitCall>[4][] = []
	const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
		await call.preSubmit?.()
		calls.push(call)
		return `0x${'1'.repeat(64)}`
	}
	const run = (priceAllowed: boolean) => executePortfolioEarnings(wallet, settings, state, pool, observation, async () => priceAllowed, { refresh, submit })
	return { observation, settings, state, calls, run }
}

test('earned fees are claimed in a single transaction only when claim cost is covered', async () => {
	const f = fixture()
	await expect(f.run(true)).rejects.toThrow('cover claim gas')
	f.observation.snapshot.ownerAccount.feesAttoEth = unit
	await f.run(true)
	expect(f.calls).toHaveLength(1)
	const call = f.calls[0]
	if (call === undefined) throw new Error('Claim missing')
	expect(call.value).toBe(0n)
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: call.data }).functionName).toBe('claimEarnings')
})

test('earned REP counts for collection only with current independent market evidence', async () => {
	const f = fixture()
	f.observation.snapshot.ownerAccount.feesAttoRep = unit
	await expect(f.run(false)).rejects.toThrow('cover claim gas')
	f.observation.snapshot.priceValid = false
	await expect(f.run(true)).rejects.toThrow('cover claim gas')
	f.observation.snapshot.priceValid = true
	await f.run(true)
	expect(f.calls).toHaveLength(1)
})

test('earnings collection never runs during pending recovery', async () => {
	const f = fixture()
	f.observation.snapshot.ownerAccount.feesAttoEth = unit
	f.state.pendingStagedOperations.push({ coordinator: f.observation.snapshot.capitalLedger, operationId: 1n, queuedBlock: 1n, target: f.observation.snapshot.owner })
	await expect(f.run(true)).rejects.toThrow('Pending recovery')
	expect(f.calls).toHaveLength(0)
})
