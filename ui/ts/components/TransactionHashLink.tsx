import type { Hash } from '@zoltar/shared/ethereum'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { buildTransactionExplorerUrl } from '../lib/networkProfile.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type TransactionHashLinkProps = {
	hash: Hash
}

export function TransactionHashLink({ hash }: TransactionHashLinkProps) {
	const transactionUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), hash)
	if (transactionUrl === undefined) return <span className='transaction-hash-link'>{hash}</span>

	return (
		<a className='transaction-hash-link' href={transactionUrl} target='_blank' rel='noreferrer' title={TSX_STRINGS.componentsTransactionHashLink.copy001}>
			{hash}
		</a>
	)
}
