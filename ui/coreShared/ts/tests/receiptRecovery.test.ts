import { afterEach, expect, mock, test } from 'bun:test'
import { transactionErrorMessages } from '../lib/errors.js'
import { createRecoveringReceiptWaiter } from '../transactions/receiptRecovery.js'
import { announceTransactionTrackingStopped, resetTransactionTrackingStopsForTesting } from '../transactions/transactionTrackingStop.js'

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

test('releases a receipt wait when the user stops tracking the transaction that replaced it', async () => {
	const replacementHash = '0x0000000000000000000000000000000000000000000000000000000000000002'
	const neverMined = new Promise<never>(() => undefined)
	let reportReplaced: () => void = () => undefined
	const replaced = new Promise<void>(resolve => {
		reportReplaced = resolve
	})
	const onReplaced = mock(() => reportReplaced())
	const wait = createRecoveringReceiptWaiter(
		{
			getTransaction: mock(async () => {
				throw new Error('Transaction not found')
			}),
			waitForTransactionReceipt: mock(async parameters => {
				// The wallet sped the transaction up; the tray and activity list now follow only the replacement hash.
				parameters.onReplaced?.({ reason: 'repriced', replacedTransaction: { hash } as never, transaction: { hash: replacementHash } as never, transactionReceipt: { transactionHash: replacementHash } as never })
				return await neverMined
			}),
		},
		{ isCurrentEnvironment: () => true, onTransactionSubmitted: mock(() => undefined) },
	)
	const waiting = wait({ hash, onReplaced, pollingInterval: 1 })
	await replaced
	announceTransactionTrackingStopped(replacementHash)
	// Bounded so a wait that never releases fails this test instead of hanging the run.
	let timer: ReturnType<typeof setTimeout> | undefined
	const stillWaiting = new Promise<string>(resolve => {
		timer = setTimeout(() => resolve('still waiting'), 1_000)
	})
	const outcome = await Promise.race([
		waiting.then(
			() => 'resolved',
			(error: unknown) => (error instanceof Error ? error.message : 'unexpected rejection'),
		),
		stillWaiting,
	])
	clearTimeout(timer)
	expect(outcome).toBe(transactionErrorMessages.trackingStopped)
	expect(onReplaced).toHaveBeenCalledTimes(1)
})
