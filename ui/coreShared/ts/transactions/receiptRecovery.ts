import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { transactionErrorMessages } from '../lib/errors.js'
import type { CreateWriteClientCallbacks, WriteClient } from '../wallet/chainBackend.js'
import { isTransactionTrackingStopped, subscribeTransactionTrackingStopped } from './transactionTrackingStop.js'

function createTrackingStoppedError() {
	return new Error(transactionErrorMessages.trackingStopped)
}

/** Whether the user stopped tracking any hash a receipt wait follows: its own, or a transaction the wallet replaced it with. */
function isAnyTrackingStopped(hashes: ReadonlySet<Hash>) {
	return [...hashes].some(isTransactionTrackingStopped)
}

/** Ends a receipt wait as soon as the user stops tracking its transaction, instead of after the wait's own timeout. */
async function untilTrackingStopped<TResult>(hashes: ReadonlySet<Hash>, work: Promise<TResult>) {
	let release: (() => void) | undefined
	const stopped = new Promise<never>((_resolve, reject) => {
		release = subscribeTransactionTrackingStopped(stoppedHash => {
			if ([...hashes].some(hash => hash.toLowerCase() === stoppedHash.toLowerCase())) reject(createTrackingStoppedError())
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
	return async requested => {
		// The tray and activity list follow a sped-up transaction under its new hash, so stopping either hash releases this wait.
		const trackedHashes = new Set<Hash>([requested.hash])
		const { onReplaced } = requested
		const parameters =
			onReplaced === undefined
				? requested
				: {
						...requested,
						onReplaced: (replacement: Parameters<typeof onReplaced>[0]) => {
							trackedHashes.add(replacement.transaction.hash)
							onReplaced(replacement)
						},
					}
		if (isAnyTrackingStopped(trackedHashes)) throw createTrackingStoppedError()
		if (callbacks.onTransactionSubmitted === undefined) return await untilTrackingStopped(trackedHashes, client.waitForTransactionReceipt(parameters))
		let transaction = parameters.transaction
		let uncertain = false
		let lastReadError: unknown
		while (callbacks.isCurrentEnvironment?.() !== false) {
			if (isAnyTrackingStopped(trackedHashes)) throw createTrackingStoppedError()
			try {
				if (parameters.onReplaced !== undefined && transaction === undefined) {
					try {
						transaction = await client.getTransaction({ hash: parameters.hash })
					} catch (error) {
						lastReadError = error
						// The receipt may already exist even if the original transaction was dropped.
					}
				}
				const receipt = await untilTrackingStopped(trackedHashes, client.waitForTransactionReceipt({ ...parameters, ...(transaction === undefined ? {} : { transaction }) }))
				if (callbacks.isCurrentEnvironment?.() === false) break
				if (uncertain) callbacks.onTransactionSubmitted(receipt.transactionHash, 'pending')
				return receipt
			} catch (error) {
				// The user released the transaction; never keep waiting for it.
				if (isAnyTrackingStopped(trackedHashes)) throw error
				lastReadError = error
				// Re-read the receipt; never repeat the wallet submission.
				if (callbacks.isCurrentEnvironment?.() === false) break
				uncertain = true
				callbacks.onTransactionSubmitted(parameters.hash, 'uncertain')
				await untilTrackingStopped(trackedHashes, new Promise(resolve => setTimeout(resolve, parameters.pollingInterval ?? 5_000)))
			}
		}
		throw new Error('Transaction tracking stopped because the active network changed', { cause: lastReadError })
	}
}
