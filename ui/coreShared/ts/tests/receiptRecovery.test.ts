import { expect, mock, test } from 'bun:test'
import { createRecoveringReceiptWaiter } from '../transactions/receiptRecovery.js'

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
