import type { Hash } from '@zoltar/shared/ethereum'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { buildTransactionExplorerUrl } from '../lib/networkProfile.js'
import { UI_STRING_VIEW_TRANSACTION } from '../lib/uiStrings.js'

type TransactionHashLinkProps = {
	hash: Hash
}

export function TransactionHashLink({ hash }: TransactionHashLinkProps) {
	const transactionUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), hash)
	if (transactionUrl === undefined) return <span className='transaction-hash-link'>{hash}</span>

	return (
		<a className='transaction-hash-link' href={transactionUrl} target='_blank' rel='noreferrer' title={UI_STRING_VIEW_TRANSACTION}>
			{hash}
		</a>
	)
}
