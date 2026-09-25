/// <reference types="bun-types" />

import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, custom, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { TransactionActivityMenu } from '../../app/components/TransactionActivityMenu.js'
import { installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { serializeTransactionActivity } from '../../transactions/transactionActivity.js'
import { setTransactionActivityOwner, transactionActivity, useTransactionActivityReceiptWatcher } from '../../transactions/transactionActivityStore.js'
import { MAINNET_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { createFakeBackend } from '../testUtils/fakeBackend.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

installDomTestLifecycle({
	afterTest: () => {
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	},
})

const account = '0x00000000000000000000000000000000000000a1'
const pendingHash: Hash = '0x1111000000000000000000000000000000000000000000000000000000000000'
const failedHash: Hash = '0x2222000000000000000000000000000000000000000000000000000000000000'

const originalTransaction = { from: account, gas: 21_000n, hash: pendingHash, input: '0x', nonce: 7n, to: account, value: 0n } as const

function minedReceipt(transactionHash: Hash) {
	return { blockHash: transactionHash, blockNumber: 5n, cumulativeGasUsed: 21_000n, effectiveGasPrice: 1n, from: account, gasUsed: 21_000n, logs: [], status: 'success' as const, to: account, transactionHash, transactionIndex: 0, type: 'eip1559' as const }
}

function WatchedMenu() {
	useTransactionActivityReceiptWatcher()
	return <TransactionActivityMenu />
}

test('lists recent transactions with their status and a pending count', async () => {
	transactionActivity.value = {
		chainId: 1,
		entries: [
			{ chainId: 1, hash: pendingHash, scope: ['security-pool:0x1'], status: 'pending', submittedAt: Date.now(), title: 'Depositing REP' },
			{ chainId: 1, failureKind: 'rejected', hash: failedHash, scope: [], status: 'failed', submittedAt: Date.now() - 60_000, settledAt: Date.now(), title: 'Creating Question' },
		],
		ownerKey: 'test',
		storageKey: undefined,
	}
	const rendered = await renderIntoDocument(<TransactionActivityMenu />)
	const queries = within(document.body)
	const trigger = queries.getByRole('button', { name: 'Activity, 1 pending' })
	expect(trigger.getAttribute('aria-expanded')).toBe('false')
	expect(document.body.textContent).toContain('1 transaction pending')
	await act(() => fireEvent.click(trigger))
	const panel = queries.getByRole('dialog', { name: 'Recent transactions' })
	const items = panel.querySelectorAll('li')
	expect(items).toHaveLength(2)
	expect(items[0]?.textContent).toContain('Depositing REP')
	expect(items[0]?.textContent).toContain('Pending')
	expect(items[1]?.textContent).toContain('Rejected in wallet')
	expect(
		within(panel)
			.getByRole('link', { name: `View transaction ${pendingHash}` })
			.getAttribute('href'),
	).toContain(pendingHash)
	await act(() => fireEvent.keyDown(document, { key: 'Escape' }))
	expect(queries.queryByRole('dialog')).toBeNull()
	expect(document.activeElement).toBe(trigger)
	await rendered.cleanup()
})

test('lets the user stop tracking a pending transaction that will never confirm', async () => {
	transactionActivity.value = { chainId: 1, entries: [{ chainId: 1, hash: pendingHash, scope: ['market:0x1'], status: 'pending', submittedAt: Date.now(), title: 'Depositing REP' }], ownerKey: 'test', storageKey: undefined }
	const rendered = await renderIntoDocument(<TransactionActivityMenu />)
	const queries = within(document.body)
	await act(() => fireEvent.click(queries.getByRole('button', { name: 'Activity, 1 pending' })))
	await act(() => fireEvent.click(queries.getByRole('button', { name: 'Stop tracking Depositing REP' })))
	expect(transactionActivity.value.entries).toEqual([])
	expect(queries.getByRole('button', { name: 'Activity' })).not.toBeNull()
	await rendered.cleanup()
})

test('follows a transaction replaced outside the app after a reload and settles it as replaced', async () => {
	const restoredHash: Hash = '0x4444000000000000000000000000000000000000000000000000000000000000'
	const speedUpHash: Hash = '0x5555000000000000000000000000000000000000000000000000000000000000'
	const cancellationHash: Hash = '0x6666000000000000000000000000000000000000000000000000000000000000'
	const baseClient = createPublicClient({ chain: MAINNET_NETWORK_PROFILE.chain, transport: custom({ request: async () => undefined }) })
	const backend = {
		...createFakeBackend(),
		createReadClient: () => ({
			...baseClient,
			waitForTransactionReceipt: async (parameters: Parameters<typeof baseClient.waitForTransactionReceipt>[0]) => {
				// The wallet first sped the transaction up, then cancelled it; the cancellation is what gets mined.
				parameters.onReplaced?.({ reason: 'repriced', replacedTransaction: { hash: restoredHash }, transaction: { ...originalTransaction, hash: speedUpHash }, transactionReceipt: minedReceipt(speedUpHash) })
				expect(transactionActivity.value.entries[0]?.hash).toBe(speedUpHash)
				parameters.onReplaced?.({ reason: 'cancelled', replacedTransaction: { hash: speedUpHash }, transaction: { ...originalTransaction, hash: cancellationHash }, transactionReceipt: minedReceipt(cancellationHash) })
				return minedReceipt(cancellationHash)
			},
		}),
	}
	installActiveEnvironmentForTesting(backend)
	transactionActivity.value = { chainId: 1, entries: [{ chainId: 1, hash: restoredHash, scope: ['market:0x1'], status: 'pending', submittedAt: Date.now(), title: 'Trade' }], ownerKey: 'restored', storageKey: undefined }
	const rendered = await renderIntoDocument(<WatchedMenu />)
	for (let attempt = 0; attempt < 50 && transactionActivity.value.entries[0]?.status === 'pending'; attempt += 1) {
		await act(async () => await Bun.sleep(10))
	}
	expect(transactionActivity.value.entries).toHaveLength(1)
	expect(transactionActivity.value.entries[0]).toMatchObject({ hash: speedUpHash, status: 'failed', failureKind: 'replaced' })
	// The original hash is released so a later row with that hash could be watched again.
	transactionActivity.value = { chainId: 1, entries: [{ chainId: 1, hash: restoredHash, scope: [], status: 'pending', submittedAt: Date.now(), title: 'Again' }], ownerKey: 'restored', storageKey: undefined }
	for (let attempt = 0; attempt < 50 && transactionActivity.value.entries[0]?.status === 'pending'; attempt += 1) {
		await act(async () => await Bun.sleep(10))
	}
	expect(transactionActivity.value.entries[0]?.status).toBe('failed')
	await rendered.cleanup()
})

test('shows an empty list when this account has no transactions', async () => {
	const rendered = await renderIntoDocument(<TransactionActivityMenu />)
	const queries = within(document.body)
	await act(() => fireEvent.click(queries.getByRole('button', { name: 'Activity' })))
	expect(queries.getByRole('dialog', { name: 'Recent transactions' }).textContent).toContain('No transactions from this account yet.')
	await rendered.cleanup()
})

test('resumes receipt watching for a pending transaction restored after a reload', async () => {
	const receiptReads: string[] = []
	const backend = {
		...createFakeBackend(),
		createReadClient: () =>
			createPublicClient({
				chain: MAINNET_NETWORK_PROFILE.chain,
				transport: custom({
					request: async ({ method, params }: { method: string; params?: unknown }) => {
						if (method === 'eth_chainId') return '0x1'
						if (method === 'eth_blockNumber') return '0x2'
						if (method === 'eth_getTransactionByHash') return { blockHash: null, blockNumber: null, from: account, gas: '0x5208', gasPrice: '0x1', hash: pendingHash, input: '0x', nonce: '0x7', to: account, transactionIndex: null, value: '0x0', v: '0x1', r: '0x1', s: '0x1', type: '0x0', chainId: '0x1' }
						if (method === 'eth_getTransactionReceipt') {
							receiptReads.push(JSON.stringify(params))
							return { blockHash: pendingHash, blockNumber: '0x1', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', from: account, gasUsed: '0x5208', logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', to: account, transactionHash: pendingHash, transactionIndex: '0x0', type: '0x2' }
						}
						throw new Error(`Unexpected RPC ${method}`)
					},
				}),
			}),
	}
	installActiveEnvironmentForTesting(backend)
	setTransactionActivityOwner(account)
	const storageKey = transactionActivity.value.storageKey
	if (storageKey === undefined) throw new Error('Expected stored activity for a connected account')
	window.localStorage.setItem(storageKey, serializeTransactionActivity([{ chainId: 1, hash: pendingHash, scope: ['market:0x1'], status: 'pending', submittedAt: Date.now(), title: 'Trade · Will this resolve?' }]))
	// A fresh page load reads the stored list for the same owner.
	transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	setTransactionActivityOwner(account)
	expect(transactionActivity.value.entries[0]?.status).toBe('pending')

	const rendered = await renderIntoDocument(<WatchedMenu />)
	for (let attempt = 0; attempt < 50 && transactionActivity.value.entries[0]?.status === 'pending'; attempt += 1) {
		await act(async () => await Bun.sleep(20))
	}
	expect(receiptReads.length).toBeGreaterThan(0)
	expect(transactionActivity.value.entries[0]?.status).toBe('confirmed')
	expect(window.localStorage.getItem(storageKey)).toContain('"confirmed"')
	expect(within(document.body).getByRole('button', { name: 'Activity' })).not.toBeNull()
	await rendered.cleanup()
})
