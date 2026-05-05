import type { Hash } from 'viem'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { buildTransactionExplorerUrl } from '../lib/networkProfile.js'

type TransactionHashLinkProps = {
	hash: Hash
}

export function TransactionHashLink({ hash }: TransactionHashLinkProps) {
	const transactionUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), hash)
	if (transactionUrl === undefined) {
		return <span className='transaction-hash-link'>{hash}</span>
	}

	return (
		<a className='transaction-hash-link' href={transactionUrl} target='_blank' rel='noreferrer' title='View transaction'>
			{hash}
		</a>
	)
}
