import { getCreateAddress, TransactionLookupNotFoundError, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { expect, mock, test } from 'bun:test'
import { initialDeploymentDraft } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/creation.js'
import { readPendingDeploymentRecovery } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/deploymentWallet.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { deployRecoveryConfirmation, deployRetryConfirmation } from '@zoltar/ui-statoblast-shared/copy/securityPoolPage.js'
import { capitalClient } from './capitalClient.js'
import { owner, token } from './capitalFixture.js'

type PendingDeployment = Parameters<typeof readPendingDeploymentRecovery>[2]['pending']

const openPromptWarning = 'If a deployment request is still open in your wallet, reject it there before starting a new deployment.'
const missingTransaction = async ({ hash }: { hash: Hash }) => {
	throw new TransactionLookupNotFoundError('transaction', hash)
}
const visibleTransaction = async ({ hash }: { hash: Hash }) => ({ from: owner, hash, nonce: 7n, input: '0x' as const, gas: 1n, value: 0n })
const recorded = { id: 'saved', step: 'rules', nonce: '6' } satisfies PendingDeployment
const withHash = { ...recorded, hash: mockTransactionHash } satisfies PendingDeployment
const draft = initialDeploymentDraft('0')

function fixture(options: { confirmed: bigint; pending?: bigint; getTransaction?: ReadClient['getTransaction'] }) {
	const source = capitalClient()
	const client = source.client.extend(() => ({
		getTransaction: options.getTransaction ?? missingTransaction,
		getTransactionCount: async ({ blockTag }: { blockTag?: string }) => (blockTag === 'pending' ? (options.pending ?? options.confirmed) : options.confirmed),
		getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
			throw new TransactionLookupNotFoundError('receipt', hash)
		},
	}))
	const check = (pending: PendingDeployment, walletRejected = false) => readPendingDeploymentRecovery(client, owner, { pending, draft }, source.backend.profile, walletRejected)
	return { check, codes: source.codes }
}

test('an invisible saved hash with an unspent nonce is still locked', async () => {
	const { check } = fixture({ confirmed: 4n })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/check again/i) })
})

test('an idle-wallet check cannot unlock an invisible saved hash without a recorded nonce', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check({ id: 'saved', step: 'rules', hash: mockTransactionHash })).toMatchObject({ kind: 'waiting' })
})

test('a reload adopts question rules from an invisible replacement at a later confirmed nonce', async () => {
	const { check, codes } = fixture({ confirmed: 8n })
	const rules = getCreateAddress({ from: owner, nonce: 7n })
	const code = codes.get(token)
	if (code === undefined) throw new Error('Missing mock question rules code')
	codes.set(rules, code)
	expect(await check(withHash)).toEqual({ kind: 'recovered', rules })
})

test('a bounded rules scan cannot clear an invisible known hash if there are later nonces left to check', async () => {
	const { check } = fixture({ confirmed: 23n })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/limited range.*check again/i) })
})

test('each new check retries the nonce lookup and uses the nonce when the transaction is visible', async () => {
	let visible = false
	const lookup = mock(async (request: { hash: Hash }) => (visible ? await visibleTransaction(request) : await missingTransaction(request)))
	const { check } = fixture({ confirmed: 6n, getTransaction: lookup })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting' })
	visible = true
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', transactionNonce: '7' })
	expect(lookup).toHaveBeenCalledTimes(2)
})

test('a spent hashless nonce with no match warns that an older wallet prompt can stay open', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check(recorded)).toMatchObject({ kind: 'restart', detail: `No deployment was found. ${openPromptWarning}` })
	expect(deployRecoveryConfirmation).toContain(openPromptWarning)
	expect(deployRetryConfirmation).toContain(openPromptWarning)
})

test.each(['0x6000', '0xef01000000000000000000000000000000000000000044'] as const)('a wallet with code waits while a known transaction is visible without a receipt (%s)', async code => {
	let visible = true
	const { check, codes } = fixture({ confirmed: 6n, getTransaction: async request => (visible ? await visibleTransaction(request) : await missingTransaction(request)) })
	codes.set(owner, code)
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/still pending.*check again/i) })
	visible = false
	expect(await check(withHash)).toMatchObject({ kind: 'restart' })
})

test('a hashless wallet prompt can be rejected at an unspent nonce after earlier transactions dropped', async () => {
	const { check } = fixture({ confirmed: 4n })
	expect(await check(recorded, true)).toEqual({ kind: 'rejected' })
})

test('an earlier pending transaction blocks rejection of the hashless prompt', async () => {
	const { check } = fixture({ confirmed: 4n, pending: 5n })
	expect(await check(recorded, true)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/earlier transactions.*still pending/i) })
})

test('the hashless waiting state explains what to do with an open prompt', async () => {
	const { check } = fixture({ confirmed: 6n })
	expect(await check(recorded)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/Waiting for the wallet\. .*confirm or reject.*check again/i) })
})
