import type { Hash } from 'viem'
import { getActiveNetworkProfile } from './activeEnvironment.js'
import { buildTransactionExplorerUrl } from './networkProfile.js'

export type TransactionState = {
	lastTransactionHash: Hash | undefined
	transactionInFlightCount: number
	transactionSubmitted: boolean
	transactionUrl: string | undefined
}

export function createInitialTransactionState(): TransactionState {
	return {
		lastTransactionHash: undefined,
		transactionInFlightCount: 0,
		transactionSubmitted: false,
		transactionUrl: undefined,
	}
}

export function markTransactionRequested(state: TransactionState): TransactionState {
	return {
		...state,
		transactionInFlightCount: state.transactionInFlightCount + 1,
		transactionSubmitted: false,
	}
}

export function markTransactionSubmitted(state: TransactionState, hash: Hash): TransactionState {
	return {
		...state,
		lastTransactionHash: hash,
		transactionSubmitted: true,
		transactionUrl: buildTransactionExplorerUrl(getActiveNetworkProfile(), hash),
	}
}

export function markTransactionFinished(state: TransactionState): TransactionState {
	return {
		...state,
		transactionInFlightCount: Math.max(0, state.transactionInFlightCount - 1),
	}
}
