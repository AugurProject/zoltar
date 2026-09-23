import type { CreateWriteClientCallbacks, WriteClient } from '../wallet/chainBackend.js'

/** A failed receipt read cannot resolve an operation that was already broadcast. */
export function createRecoveringReceiptWaiter(client: Pick<WriteClient, 'waitForTransactionReceipt' | 'getTransaction'>, callbacks: CreateWriteClientCallbacks): WriteClient['waitForTransactionReceipt'] {
	return async parameters => {
		if (callbacks.onTransactionSubmitted === undefined) return await client.waitForTransactionReceipt(parameters)
		let transaction = parameters.transaction
		let uncertain = false
		let lastReadError: unknown
		while (callbacks.isCurrentEnvironment?.() !== false) {
			try {
				if (parameters.onReplaced !== undefined && transaction === undefined) {
					try {
						transaction = await client.getTransaction({ hash: parameters.hash })
					} catch (error) {
						lastReadError = error
						// The receipt may already exist even if the original transaction was dropped.
					}
				}
				const receipt = await client.waitForTransactionReceipt({ ...parameters, ...(transaction === undefined ? {} : { transaction }) })
				if (callbacks.isCurrentEnvironment?.() === false) break
				if (uncertain) callbacks.onTransactionSubmitted(receipt.transactionHash, 'pending')
				return receipt
			} catch (error) {
				lastReadError = error
				// Re-read the receipt; never repeat the wallet submission.
				if (callbacks.isCurrentEnvironment?.() === false) break
				uncertain = true
				callbacks.onTransactionSubmitted(parameters.hash, 'uncertain')
				await new Promise(resolve => setTimeout(resolve, parameters.pollingInterval ?? 5_000))
			}
		}
		throw new Error('Transaction tracking stopped because the active network changed', { cause: lastReadError })
	}
}
