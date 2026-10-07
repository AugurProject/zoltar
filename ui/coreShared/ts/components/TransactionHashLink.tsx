import * as transactionCopy from '../copy/transaction.js'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { buildTransactionExplorerUrl } from '../wallet/networkProfile.js'
import { IdentifierValue } from './IdentifierValue.js'

type TransactionHashLinkProps = {
	hash: Hash
}

export function TransactionHashLink({ hash }: TransactionHashLinkProps) {
	const transactionUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), hash)
	// Without an explorer the full hash stays copyable, like every other identifier, so it can be checked against the wallet.
	if (transactionUrl === undefined) return <IdentifierValue className='transaction-hash-link' value={hash} />

	return (
		<a className='transaction-hash-link' title={hash} href={transactionUrl} target='_blank' rel='noreferrer' aria-label={transactionCopy.formatViewTransactionOnExplorer(hash)}>
			<span>{hash}</span>
		</a>
	)
}
