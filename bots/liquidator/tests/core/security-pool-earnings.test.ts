import { expect, test } from 'bun:test'
import { executeSecurityPoolEarnings } from '../../src/execution/security-pool-earnings.ts'
import type { refreshSecurityPoolExecution } from '../../src/execution/security-pool-executor.ts'
import { recordingSubmit } from '../support/security-pool-execution.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolObservation, securityPoolSettings, unit } from '../support/security-pool-observation.ts'
import { createWalletClient, createRpcEndpointPool, decodeFunctionData, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'

function fixture() {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
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
	state.securityPoolScopes = [observation.nextScope]
	const refresh: typeof refreshSecurityPoolExecution = async () => ({ observation, totalPrincipal: 0n, allowance: 0n })
	const { calls, submit } = recordingSubmit()
	const run = (priceAllowed: boolean) => executeSecurityPoolEarnings(wallet, settings, state, pool, observation, async () => priceAllowed, { refresh, submit })
	return { observation, settings, state, calls, run, owner: account.address }
}

test('earned fees are claimed in a single transaction only when claim cost is covered', async () => {
	const f = fixture()
	await expect(f.run(true)).rejects.toThrow('cover claim gas')
	f.observation.snapshot.ownerAccount.feesAttoEth = unit
	f.observation.snapshot.accruedFeesAttoEth = unit
	await f.run(true)
	expect(f.calls).toHaveLength(1)
	const call = f.calls[0]
	if (call === undefined) throw new Error('Claim missing')
	expect(call.value).toBe(0n)
	const decoded = decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: call.data })
	expect(decoded.functionName).toBe('claimEarnings')
	expect(decoded.args).toEqual([f.owner])
})

test('earned REP counts for collection only with current independent market evidence', async () => {
	const f = fixture()
	f.observation.snapshot.ownerAccount.feesAttoRep = unit
	f.observation.snapshot.accruedFeesAttoRep = unit
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
	f.observation.snapshot.accruedFeesAttoEth = unit
	f.state.pendingTransactions.push({
		hash: `0x${'ab'.repeat(32)}`,
		kind: 'deposit',
		label: 'Pending deposit',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 1n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender: f.observation.snapshot.owner,
		serializedTransaction: '0x',
		submissionBlock: 1n,
	})
	await expect(f.run(true)).rejects.toThrow('Pending recovery')
	expect(f.calls).toHaveLength(0)
})

test('#1496: uncredited position earnings cover the claim cost', async () => {
	const f = fixture()
	f.observation.snapshot.accruedFeesAttoEth = unit
	await f.run(true)
	expect(f.calls).toHaveLength(1)
})
