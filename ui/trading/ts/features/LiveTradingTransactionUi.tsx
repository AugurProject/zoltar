import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import * as workflowCopy from '../copy/workflows.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'

export function TradingTransactionHash({ hash }: { hash: Hash }) {
	return (
		<p className='transaction-hash'>
			<span>{workflowCopy.transaction}</span>
			<TransactionHashLink hash={hash} />
		</p>
	)
}

export function BalanceLoadError({ message, retry, disabled = false }: { message: string; retry(): Promise<void>; disabled?: boolean }) {
	return (
		<div className='balance-recovery'>
			<RetryableNotice message={message} retryLabel={workflowCopy.retryBalances} disabled={disabled} onRetry={() => void retry()} />
		</div>
	)
}
