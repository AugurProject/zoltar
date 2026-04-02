import type { Hash } from 'viem'

type TransactionHashLinkProps = {
	hash: Hash
}

export function TransactionHashLink({ hash }: TransactionHashLinkProps) {
	return (
		<a className='transaction-hash-link' href={`https://etherscan.io/tx/${hash}`} target='_blank' rel='noreferrer' title='View on Etherscan'>
			{hash}
		</a>
	)
}
