import type { CreateWriteClientCallbacks, WriteClient } from '../wallet/chainBackend.js'

/** Wraps a simulation write client so every submitted transaction hash reaches the caller's callbacks. */
export function withTransactionCallbacks(baseClient: WriteClient, callbacks: CreateWriteClientCallbacks): WriteClient {
	const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
		const hash = await baseClient.sendRawTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}
	const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
		const hash = await baseClient.sendTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}
	const writeContract: typeof baseClient.writeContract = async parameters => {
		const hash = await baseClient.writeContract(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}
	return {
		...baseClient,
		onTransactionPrepared: callbacks.onTransactionPrepared,
		sendRawTransaction,
		sendTransaction,
		writeContract,
	}
}
