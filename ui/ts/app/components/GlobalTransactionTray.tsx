import { useEffect, useRef, useState } from 'preact/hooks'
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js'
import type { GlobalTransactionPresentation } from '../../types/components.js'

type GlobalTransactionTrayProps = {
	transaction: GlobalTransactionPresentation | undefined
}

const dismissedKeys = new Set<string>()

function getDismissKey(transaction: GlobalTransactionPresentation | undefined) {
	const baseKey = transaction?.dismissKey ?? transaction?.hash
	if (baseKey === undefined || transaction === undefined) return undefined
	return `${transaction.tone}:${baseKey}`
}

export function GlobalTransactionTray({ transaction }: GlobalTransactionTrayProps) {
	const [dismissedKey, setDismissedKey] = useState<string | undefined>(() => {
		const transactionDismissKey = getDismissKey(transaction)
		if (transactionDismissKey === undefined || !dismissedKeys.has(transactionDismissKey)) return undefined
		return transactionDismissKey
	})
	const dismissKeyRef = useRef(getDismissKey(transaction))
	const noticeRef = useRef<HTMLDivElement>(null)

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

	useEffect(() => {
		const notice = noticeRef.current
		if (notice === null) return
		const main = notice.closest('main')
		if (!(main instanceof HTMLElement) || transaction === undefined) return
		const updateReservedSpace = () => {
			const trayHeight = `${notice.getBoundingClientRect().height.toString()}px`
			main.style.setProperty('--global-transaction-tray-height', trayHeight)
			document.documentElement.style.scrollPaddingBottom = `calc(${trayHeight} + 2rem + env(safe-area-inset-bottom, 0rem))`
		}
		main.classList.add('global-transaction-tray-open')
		updateReservedSpace()
		const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateReservedSpace)
		resizeObserver?.observe(notice)
		return () => {
			resizeObserver?.disconnect()
			main.classList.remove('global-transaction-tray-open')
			main.style.removeProperty('--global-transaction-tray-height')
			document.documentElement.style.removeProperty('scroll-padding-bottom')
		}
	}, [transaction, dismissedKey])

	if (transaction === undefined) return undefined

	const transactionDismissKey = getDismissKey(transaction)
	if (transactionDismissKey !== undefined && transactionDismissKey === dismissedKey) return undefined
	const canDismiss = transaction.tone !== 'awaiting-wallet' && transaction.tone !== 'pending' && transaction.tone !== 'preparing' && transactionDismissKey !== undefined
	const dismiss = () => {
		if (transactionDismissKey === undefined) return
		dismissedKeys.add(transactionDismissKey)
		setDismissedKey(transactionDismissKey)
	}

	return (
		<div className='global-transaction-tray'>
			<TransactionPresentationNotice dismissible={canDismiss} noticeRef={noticeRef} onDismiss={dismiss} transaction={transaction} />
		</div>
	)
}
