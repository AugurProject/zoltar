import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import type { GlobalTransactionPresentation, TransactionIntent } from './components.js'
import type { TransactionRequestPreview, TransactionSubmissionStatus } from '../wallet/chainBackend.js'
import type { TransactionFailureKind } from '../transactions/transactionLifecycle.js'

export type RefreshStateOptions = {
	loadChainClock?: boolean
	loadDeploymentState?: boolean
	loadWalletState?: boolean
}

type RefreshState = (options?: RefreshStateOptions) => Promise<void>

/** Identifies one requested transaction so its outcome callbacks reach it while other transactions are still pending. */
export type TransactionRequestKey = string

/** `false` rejects the request; a key identifies the accepted request for its later callbacks. */
export type TransactionRequestResult = TransactionRequestKey | boolean | void

export type TransactionFailureDetails = {
	kind?: TransactionFailureKind | undefined
	requestKey?: TransactionRequestKey | undefined
}

export type WriteOperationsParameters = {
	accountAddress: Address | undefined
	onTransactionCanceled?: (requestKey?: TransactionRequestKey) => void
	onTransactionFailed?: (message: string, details?: TransactionFailureDetails) => void
	onTransactionFinished: (requestKey?: TransactionRequestKey) => void
	onTransactionPresented: (presentation: GlobalTransactionPresentation) => void
	onTransactionPrepared?: (preview: TransactionRequestPreview) => void
	onTransactionRequested: (intent: TransactionIntent) => TransactionRequestResult
	onTransactionSubmitted: (hash: Hash, status?: TransactionSubmissionStatus) => void
	refreshState: RefreshState
}

export type TransactionLifecycleParameters = {
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: WriteOperationsParameters['onTransactionFinished']
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: WriteOperationsParameters['onTransactionSubmitted']
}

export type TransactionCancellationParameters = Pick<WriteOperationsParameters, 'onTransactionCanceled'>

export type WriteOperationContext = Pick<WriteOperationsParameters, 'accountAddress' | 'refreshState'>

export type AccountState = {
	address: Address | undefined
	chainId: string | undefined
	ethBalanceAttoEth: bigint | undefined
	wethBalanceAttoEth: bigint | undefined
}
