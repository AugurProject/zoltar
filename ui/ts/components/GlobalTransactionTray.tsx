import { useEffect, useRef, useState } from 'preact/hooks'
import { Badge } from './Badge.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import type { BadgeTone, GlobalTransactionPresentation } from '../types/components.js'

type GlobalTransactionTrayProps = {
	transaction: GlobalTransactionPresentation | undefined
}

const dismissedKeys = new Set<string>()

function getDismissKey(transaction: GlobalTransactionPresentation | undefined) {
	return transaction?.dismissKey ?? transaction?.hash
}

function getTransactionBadge(tone: GlobalTransactionPresentation['tone']): { label: string; tone: BadgeTone } {
	if (tone === 'awaiting-wallet') return { tone: 'pending', label: 'Awaiting Wallet' }
	if (tone === 'pending') return { tone: 'pending', label: 'Pending' }
	if (tone === 'success') return { tone: 'ok', label: 'Confirmed' }
	if (tone === 'error') return { tone: 'danger', label: 'Failed' }
	return { tone: 'warning', label: 'Attention' }
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
	const canDismiss = transaction.tone !== 'awaiting-wallet' && transaction.tone !== 'pending' && transactionDismissKey !== undefined
	const transactionHash = transaction.hash
	const showDetail = transaction.hash === undefined || transaction.tone === 'error'
	const showHash = transactionHash !== undefined

	return (
		<div className='global-transaction-tray'>
			<div className='global-transaction-notice' role='status' aria-live='polite'>
				<div className='global-transaction-notice-copy'>
					<div className='global-transaction-notice-header'>
						<Badge tone={badge.tone}>{badge.label}</Badge>
						<strong>{transaction.title}</strong>
					</div>
					{!showDetail ? undefined : <div className='global-transaction-notice-detail'>{transaction.detail}</div>}
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
						Dismiss
					</button>
				)}
			</div>
		</div>
	)
}
