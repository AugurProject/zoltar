import { afterEach, expect, mock, test } from 'bun:test'
import { transactionErrorMessages } from '../lib/errors.js'
import { createRecoveringReceiptWaiter } from '../transactions/receiptRecovery.js'
import { announceTransactionTrackingStopped, resetTransactionTrackingStopsForTesting } from '../transactions/transactionTrackingStop.js'
import { createDeferred } from './testUtils/deferred.js'

afterEach(() => {
	resetTransactionTrackingStopsForTesting()
})

const hash = '0x0000000000000000000000000000000000000000000000000000000000000001'

test('stops recovery when the active environment changes without another read or submission callback', async () => {
	let current = true
	const readError = new Error('RPC unavailable')
	const waitForTransactionReceipt = mock(async () => {
		throw readError
	})
	const onTransactionSubmitted = mock(() => {
		current = false
	})
	const wait = createRecoveringReceiptWaiter(
		{
			getTransaction: mock(async () => {
				throw new Error('Unexpected transaction lookup')
			}),
			waitForTransactionReceipt,
		},
		{ isCurrentEnvironment: () => current, onTransactionSubmitted },
	)
	await expect(wait({ hash, pollingInterval: 1 })).rejects.toMatchObject({ cause: readError, message: 'Transaction tracking stopped because the active network changed' })
	expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1)
	expect(onTransactionSubmitted).toHaveBeenCalledTimes(1)
	expect(onTransactionSubmitted).toHaveBeenCalledWith(hash, 'uncertain')
})

test('preserves the bounded wait for callers that manage their own uncertain transaction state', async () => {
	const readError = new Error('Receipt timeout')
	const waitForTransactionReceipt = mock(async () => {
		throw readError
	})
	const wait = createRecoveringReceiptWaiter(
		{
			getTransaction: mock(async () => {
				throw new Error('Unexpected transaction lookup')
			}),
			waitForTransactionReceipt,
		},
		{},
	)
	await expect(wait({ hash, timeout: 1 })).rejects.toBe(readError)
	expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1)
	expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash, timeout: 1 })
})

test('releases a receipt wait as soon as the user stops tracking its transaction', async () => {
	const neverMined = new Promise<never>(() => undefined)
	const waitForTransactionReceipt = mock(async () => await neverMined)
	const onTransactionSubmitted = mock(() => undefined)
	const wait = createRecoveringReceiptWaiter(
		{
			getTransaction: mock(async () => {
				throw new Error('Unexpected transaction lookup')
			}),
			waitForTransactionReceipt,
		},
		{ isCurrentEnvironment: () => true, onTransactionSubmitted },
	)
	const waiting = wait({ hash, pollingInterval: 1 })
	announceTransactionTrackingStopped(hash)
	await expect(waiting).rejects.toThrow(transactionErrorMessages.trackingStopped)
	expect(onTransactionSubmitted).not.toHaveBeenCalled()
	// A later wait for the released hash, such as the activity watcher resuming, ends immediately too.
	await expect(wait({ hash, pollingInterval: 1 })).rejects.toThrow(transactionErrorMessages.trackingStopped)
	expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1)
})

test('stops tracking the new hash after the wallet speeds up a transaction', async () => {
	const speedUpHash = '0x0000000000000000000000000000000000000000000000000000000000000002'
	const account = '0x0000000000000000000000000000000000000001'
	const speedUp = createDeferred<void>()
	const wait = createRecoveringReceiptWaiter(
		{
			getTransaction: mock(async () => {
				throw new Error('Transaction read unavailable')
			}),
			waitForTransactionReceipt: async parameters => {
				parameters.onReplaced?.({
					reason: 'repriced',
					replacedTransaction: { hash },
					transaction: { hash: speedUpHash },
					transactionReceipt: { blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21000n, from: account, gasUsed: 21000n, logs: [], status: 'success', transactionHash: speedUpHash, transactionIndex: 0n },
				})
				speedUp.resolve()
				return await new Promise<never>(() => undefined)
			},
		},
		{ onTransactionSubmitted: mock(() => undefined) },
	)
	const pending = wait({ hash, onReplaced: () => undefined })
	void pending.catch(() => undefined)
	await speedUp.promise
	try {
		announceTransactionTrackingStopped(speedUpHash)
		await expect(Promise.race([pending, Bun.sleep(50).then(() => 'still tracking')])).rejects.toThrow(transactionErrorMessages.trackingStopped)
	} finally {
		announceTransactionTrackingStopped(hash)
	}
})
