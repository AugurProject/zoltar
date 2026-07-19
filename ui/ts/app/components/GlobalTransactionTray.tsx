import * as commonCopy from '../../copy/common.js'
import * as transactionCopy from '../../copy/transaction.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Badge } from '../../components/Badge.js'
import { TransactionHashLink } from '../../components/TransactionHashLink.js'
import type { BadgeTone, GlobalTransactionPresentation } from '../../types/components.js'

type GlobalTransactionTrayProps = {
	transaction: GlobalTransactionPresentation | undefined
}

const dismissedKeys = new Set<string>()

function getDismissKey(transaction: GlobalTransactionPresentation | undefined) {
	return transaction?.dismissKey ?? transaction?.hash
}

function getTransactionBadge(tone: GlobalTransactionPresentation['tone']): { label: string; tone: BadgeTone } {
	if (tone === 'preparing') return { tone: 'pending', label: transactionCopy.preparing }
	if (tone === 'awaiting-wallet') return { tone: 'pending', label: transactionCopy.awaitingWallet }
	if (tone === 'pending') return { tone: 'pending', label: commonCopy.pending }
	if (tone === 'success') return { tone: 'ok', label: transactionCopy.confirmed }
	if (tone === 'error') return { tone: 'danger', label: commonCopy.failed }
	return { tone: 'warning', label: transactionCopy.attention }
}

export function GlobalTransactionTray({ transaction }: GlobalTransactionTrayProps) {
	const [dismissedKey, setDismissedKey] = useState<string | undefined>(() => {
		const transactionDismissKey = getDismissKey(transaction)
		if (transactionDismissKey === undefined || !dismissedKeys.has(transactionDismissKey)) return undefined
		return transactionDismissKey
	})
	const dismissKeyRef = useRef(getDismissKey(transaction))

	useEffect(() => {
		const nextDismissKey = getDismissKey(transaction)
		if (nextDismissKey === dismissKeyRef.current) return
		dismissKeyRef.current = nextDismissKey
		if (nextDismissKey === undefined || !dismissedKeys.has(nextDismissKey)) {
			setDismissedKey(undefined)
			return
		}
		setDismissedKey(nextDismissKey)
	}, [transaction])

	if (transaction === undefined) return undefined

	const transactionDismissKey = getDismissKey(transaction)
	if (transactionDismissKey !== undefined && transactionDismissKey === dismissedKey) return undefined
	const badge = getTransactionBadge(transaction.tone)
	const canDismiss = transaction.tone !== 'awaiting-wallet' && transaction.tone !== 'pending' && transaction.tone !== 'preparing' && transactionDismissKey !== undefined
	const transactionHash = transaction.hash
	const showHash = transactionHash !== undefined
	const rows = transaction.rows ?? []

	return (
		<div className='global-transaction-tray'>
			<div className='global-transaction-notice' role='status' aria-live='polite'>
				<div className='global-transaction-notice-copy'>
					<div className='global-transaction-notice-header'>
						<Badge tone={badge.tone}>{badge.label}</Badge>
						<strong>{transaction.title}</strong>
					</div>
					{transaction.detail === undefined ? undefined : <div className='global-transaction-notice-detail'>{transaction.detail}</div>}
					{rows.length === 0 ? undefined : (
						<dl className='global-transaction-notice-rows'>
							{rows.map((row, rowIndex) => (
								<div className='global-transaction-notice-row' key={`${row.label}:${rowIndex.toString()}`}>
									<dt>{row.label}</dt>
									<dd>{row.value}</dd>
								</div>
							))}
						</dl>
					)}
					{!showHash ? undefined : <TransactionHashLink hash={transactionHash} />}
				</div>
				{!canDismiss ? undefined : (
					<button
						className='quiet global-transaction-dismiss'
						type='button'
						onClick={() => {
							dismissedKeys.add(transactionDismissKey)
							setDismissedKey(transactionDismissKey)
						}}
					>
						{transactionCopy.dismiss}
					</button>
				)}
			</div>
		</div>
	)
}
