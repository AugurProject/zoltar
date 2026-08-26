import type { Address, Hash } from '@zoltar/shared/ethereum'
import type { GlobalTransactionPresentation, TransactionIntent } from './components.js'
import type { TransactionRequestPreview } from '../lib/chainBackend.js'

export type RefreshStateOptions = {
	loadChainClock?: boolean
	loadDeploymentState?: boolean
	loadWalletState?: boolean
}

type RefreshState = (options?: RefreshStateOptions) => Promise<void>

export type WriteOperationsParameters = {
	accountAddress: Address | undefined
	onTransactionCanceled?: () => void
	onTransactionFailed?: (message: string) => void
	onTransactionFinished: () => void
	onTransactionPresented: (presentation: GlobalTransactionPresentation) => void
	onTransactionPrepared?: (preview: TransactionRequestPreview) => void
	onTransactionRequested: (intent: TransactionIntent) => void
	onTransactionSubmitted: (hash: Hash) => void
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
