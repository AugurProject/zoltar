import { getCreateAddress, TransactionLookupNotFoundError, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { expect, mock, test } from 'bun:test'
import { initialDeploymentDraft } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/creation.js'
import { readPendingDeploymentRecovery } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/deploymentWallet.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { deployRecoveryConfirmation, deployRetryConfirmation } from '@zoltar/ui-statoblast-shared/copy/securityPoolPage.js'
import { capitalClient } from './capitalClient.js'
import { capitalSnapshot, owner, token } from './capitalFixture.js'

type PendingDeployment = Parameters<typeof readPendingDeploymentRecovery>[2]['pending']

const receiptPending = 'Check your wallet activity, then check again for the deployment receipt.'
const openPromptWarning = 'If a deployment request is still open in your wallet, reject it there before starting a new deployment.'
const pendingTransactionWarning = 'This transaction may still be pending in your wallet. Cancel it there before starting a new deployment.'
const missingTransaction = async ({ hash }: { hash: Hash }) => {
	throw new TransactionLookupNotFoundError('transaction', hash)
}
const visibleTransaction = async ({ hash }: { hash: Hash }) => ({ from: owner, hash, nonce: 7n, input: '0x' as const, gas: 1n, value: 0n })
const visibleTransactionFromAnotherAddress = async (request: { hash: Hash }) => ({ ...(await visibleTransaction(request)), from: token })
const recorded = { id: 'saved', step: 'rules', nonce: '6' } satisfies PendingDeployment
const withHash = { ...recorded, hash: mockTransactionHash } satisfies PendingDeployment
const draft = initialDeploymentDraft('0')

function fixture(options: { confirmed: bigint; pending?: bigint; getTransaction?: ReadClient['getTransaction']; getTransactionCount?: ReadClient['getTransactionCount']; getTransactionReceipt?: ReadClient['getTransactionReceipt'] }) {
	const source = capitalClient()
	const client = source.client.extend(() => ({
		getTransaction: options.getTransaction ?? missingTransaction,
		getTransactionCount: options.getTransactionCount ?? (async ({ blockTag }: { blockTag?: string }) => (blockTag === 'pending' ? (options.pending ?? options.confirmed) : options.confirmed)),
		getTransactionReceipt:
			options.getTransactionReceipt ??
			(async ({ hash }: { hash: Hash }) => {
				throw new TransactionLookupNotFoundError('receipt', hash)
			}),
	}))
	const check = (pending: PendingDeployment, walletRejected = false) => readPendingDeploymentRecovery(client, owner, { pending, draft, rules: pending.step === 'pool' ? token : undefined }, source.backend.profile, walletRejected)
	return { check, codes: source.codes }
}

test('an invisible saved hash with an unspent estimate explains how to spend the nonce without unlocking', async () => {
	const { check } = fixture({ confirmed: 4n })
	expect(await check(withHash)).toMatchObject({
		kind: 'waiting',
		detail: 'If your wallet no longer shows this transaction, send or cancel a transaction with nonce 6 (or the nonce your wallet shows for it), then check again.',
	})
})

test('a legacy invisible saved hash without a nonce requires the transaction restart warning', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check({ id: 'saved', step: 'rules', hash: mockTransactionHash })).toMatchObject({ kind: 'restart', detail: pendingTransactionWarning, confirmationWarning: pendingTransactionWarning })
})

test('a legacy hash still visible to the RPC is not cleared when the sender differs', async () => {
	const { check } = fixture({ confirmed: 7n, getTransaction: visibleTransactionFromAnotherAddress })
	expect(await check({ id: 'saved', step: 'rules', hash: mockTransactionHash })).toMatchObject({ kind: 'waiting' })
})

test('a visible transaction at the confirmed nonce waits for its receipt', async () => {
	const { check } = fixture({ confirmed: 7n, getTransaction: visibleTransaction })
	expect(await check(withHash)).toEqual({ kind: 'waiting', detail: receiptPending, transactionNonce: '7' })
})

test('a visible transaction with an unspent estimated nonce waits for its receipt', async () => {
	const { check } = fixture({ confirmed: 4n, getTransaction: visibleTransactionFromAnotherAddress })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', detail: receiptPending })
})

test.each([7n, 23n])('a visible transaction with a spent estimated nonce stays locked at confirmed nonce %s', async confirmed => {
	const { check } = fixture({ confirmed, getTransaction: visibleTransactionFromAnotherAddress })
	expect(await check(withHash)).toEqual({ kind: 'waiting', detail: receiptPending })
})

test('a spent estimated nonce with no match warns that the known transaction could still be pending', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check(withHash)).toMatchObject({ kind: 'restart', detail: pendingTransactionWarning, confirmationWarning: pendingTransactionWarning })
	expect(deployRecoveryConfirmation(pendingTransactionWarning)).toContain(pendingTransactionWarning)
	expect(deployRetryConfirmation(pendingTransactionWarning)).toContain(pendingTransactionWarning)
	expect(deployRecoveryConfirmation(pendingTransactionWarning)).not.toContain(openPromptWarning)
})

test('a reload adopts question rules from an invisible replacement at a later confirmed nonce', async () => {
	const { check, codes } = fixture({ confirmed: 8n })
	const rules = getCreateAddress({ from: owner, nonce: 7n })
	const code = codes.get(token)
	if (code === undefined) throw new Error('Missing mock question rules code')
	codes.set(rules, code)
	expect(await check(withHash)).toEqual({ kind: 'recovered', rules })
})

test('an exhausted rules scan offers a confirmed restart with the known-transaction warning', async () => {
	const { check } = fixture({ confirmed: 23n })
	expect(await check(withHash)).toMatchObject({ kind: 'restart', detail: pendingTransactionWarning, confirmationWarning: pendingTransactionWarning })
})

test('an exhausted rules scan keeps waiting when the wallet is not idle', async () => {
	const { check } = fixture({ confirmed: 23n, pending: 24n })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/earlier transactions.*still pending/i) })
})

test('a hashless marker without a saved nonce asks the user to check their wallet', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check({ id: 'saved', step: 'rules' })).toMatchObject({ kind: 'restart', detail: 'No transaction nonce was saved. Check your wallet activity before starting a new deployment.', confirmationWarning: openPromptWarning })
})

test('each new check retries the nonce lookup and uses the nonce when the transaction is visible', async () => {
	let visible = false
	const lookup = mock(async (request: { hash: Hash }) => (visible ? await visibleTransaction(request) : await missingTransaction(request)))
	const { check } = fixture({ confirmed: 6n, getTransaction: lookup })
	expect(await check(withHash)).toMatchObject({ kind: 'waiting' })
	visible = true
	expect(await check(withHash)).toMatchObject({
		kind: 'waiting',
		detail: 'This transaction (nonce 7) is waiting behind an earlier one. Speed up or cancel the earlier transaction in your wallet, then check again.',
		transactionNonce: '7',
	})
	expect(lookup).toHaveBeenCalledTimes(2)
})

test('a spent hashless nonce with no match warns that an older wallet prompt can stay open', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check(recorded)).toMatchObject({ kind: 'restart', detail: `No deployment was found. ${openPromptWarning}` })
	expect(deployRecoveryConfirmation()).toContain(openPromptWarning)
	expect(deployRetryConfirmation()).toContain(openPromptWarning)
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

test('a wallet rejection cannot clear a hashless marker once its nonce is spent', async () => {
	const { check } = fixture({ confirmed: 7n })
	expect(await check(recorded, true)).toMatchObject({ kind: 'restart', detail: `No deployment was found. ${openPromptWarning}` })
})

test('a wallet rejection cannot clear a marker that already has a transaction hash', async () => {
	const { check } = fixture({ confirmed: 6n })
	expect(await check(withHash, true)).toMatchObject({ kind: 'waiting' })
})

test.each([undefined, '0x6000'] as const)('a reverted receipt does not offer restart before finality for wallet code %s', async code => {
	const { blockHash, blockNumber } = capitalSnapshot()
	const { check, codes } = fixture({
		confirmed: 7n,
		getTransactionReceipt: async () => ({ status: 'reverted', blockHash, blockNumber: blockNumber + 1n, from: owner, to: undefined, contractAddress: undefined, transactionHash: mockTransactionHash, logs: [], cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n }),
	})
	if (code !== undefined) codes.set(owner, code)
	expect(await check({ ...withHash, nonceVerified: true })).toMatchObject({ kind: 'waiting' })
})

test('unavailable history keeps a known hash locked when the saved nonce is an estimate', async () => {
	const { blockNumber } = capitalSnapshot()
	const { check } = fixture({
		confirmed: 7n,
		getTransactionCount: async ({ blockNumber: requestedBlock }) => {
			if (requestedBlock !== undefined && requestedBlock < blockNumber) throw new Error('missing trie node')
			return 7n
		},
	})
	expect(await check({ ...withHash, step: 'pool' })).toMatchObject({ kind: 'waiting', detail: 'This RPC can’t check older blocks. Switch to an archive RPC or check your wallet activity.' })
})

test('the hashless waiting state explains what to do with an open prompt', async () => {
	const { check } = fixture({ confirmed: 6n })
	expect(await check(recorded)).toMatchObject({ kind: 'waiting', detail: expect.stringMatching(/Waiting for the wallet\. .*confirm or reject.*check again/i) })
})
