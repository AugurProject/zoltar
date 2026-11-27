import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { transactionErrorMessages } from '../lib/errors.js'
import type { CreateWriteClientCallbacks, WriteClient } from '../wallet/chainBackend.js'
import { isTransactionTrackingStopped, subscribeTransactionTrackingStopped } from './transactionTrackingStop.js'

function createTrackingStoppedError() {
	return new Error(transactionErrorMessages.trackingStopped)
}

/** Ends a receipt wait as soon as the user stops tracking its transaction, instead of after the wait's own timeout. */
async function untilTrackingStopped<TResult>(getHash: () => Hash, work: Promise<TResult>) {
	let release: (() => void) | undefined
	const stopped = new Promise<never>((_resolve, reject) => {
		if (isTransactionTrackingStopped(getHash())) reject(createTrackingStoppedError())
		release = subscribeTransactionTrackingStopped(stoppedHash => {
			if (stoppedHash.toLowerCase() === getHash().toLowerCase()) reject(createTrackingStoppedError())
		})
	})
	try {
		return await Promise.race([work, stopped])
	} finally {
		release?.()
	}
}

/** A failed receipt read cannot resolve an operation that was already broadcast. */
export function createRecoveringReceiptWaiter(client: Pick<WriteClient, 'waitForTransactionReceipt' | 'getTransaction'>, callbacks: CreateWriteClientCallbacks): WriteClient['waitForTransactionReceipt'] {
	return async parameters => {
		if (isTransactionTrackingStopped(parameters.hash)) throw createTrackingStoppedError()
		let hash = parameters.hash
		const getHash = () => hash
		let transaction = parameters.transaction
		const { transaction: _originalTransaction, onReplaced, ...receiptRequest } = parameters
		const waitParameters =
			onReplaced === undefined
				? receiptRequest
				: {
						...receiptRequest,
						onReplaced: (replacement: Parameters<typeof onReplaced>[0]) => {
							hash = replacement.transaction.hash
							transaction = undefined
							onReplaced(replacement)
						},
					}
		if (callbacks.onTransactionSubmitted === undefined) return await untilTrackingStopped(getHash, client.waitForTransactionReceipt({ ...waitParameters, ...(transaction === undefined ? {} : { transaction }) }))
		let uncertain = false
		let lastReadError: unknown
		while (callbacks.isCurrentEnvironment?.() !== false) {
			if (isTransactionTrackingStopped(hash)) throw createTrackingStoppedError()
			try {
				if (parameters.onReplaced !== undefined && transaction === undefined) {
					try {
						transaction = await client.getTransaction({ hash })
					} catch (error) {
						lastReadError = error
						// The receipt may already exist even if the original transaction was dropped.
					}
				}
				const receipt = await untilTrackingStopped(getHash, client.waitForTransactionReceipt({ ...waitParameters, hash, ...(transaction === undefined ? {} : { transaction }) }))
				if (callbacks.isCurrentEnvironment?.() === false) break
				if (uncertain) callbacks.onTransactionSubmitted(receipt.transactionHash, 'pending')
				return receipt
			} catch (error) {
				// The user released the transaction; never keep waiting for it.
				if (isTransactionTrackingStopped(hash)) throw error
				lastReadError = error
				// Re-read the receipt; never repeat the wallet submission.
				if (callbacks.isCurrentEnvironment?.() === false) break
				uncertain = true
				callbacks.onTransactionSubmitted(hash, 'uncertain')
				await untilTrackingStopped(getHash, new Promise(resolve => setTimeout(resolve, parameters.pollingInterval ?? 5_000)))
			}
		}
		throw new Error('Transaction tracking stopped because the active network changed', { cause: lastReadError })
	}
}
