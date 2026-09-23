import { useEffect, useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import type { GlobalTransactionPresentation } from '../../types/components.js'
import { dismissGlobalTransaction, getGlobalTransactionDismissKey, isGlobalTransactionDismissed } from '../../transactions/globalTransactionDismissal.js'

function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

type GlobalTransactionTrayProps = {
	activeUniverseId?: bigint | undefined
	routeKey?: string
	transaction: GlobalTransactionPresentation | undefined
}

function getTransactionKey(transaction: GlobalTransactionPresentation | undefined) {
	return transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash
}

export function GlobalTransactionTray({ activeUniverseId, routeKey, transaction }: GlobalTransactionTrayProps) {
	const [dismissedKey, setDismissedKey] = useState<string>()
	const dismissed = isGlobalTransactionDismissed(transaction)
	const dismissKeyRef = useRef(getGlobalTransactionDismissKey(transaction))
	const transactionOriginRef = useRef({ routeHash: window.location.hash, routeKey, transactionKey: getTransactionKey(transaction) })
	const noticeRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const nextKey = getGlobalTransactionDismissKey(transaction)
		if (nextKey === dismissKeyRef.current) return
		dismissKeyRef.current = nextKey
		setDismissedKey(undefined)
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
	}, [transaction, dismissed, dismissedKey])

	if (transaction === undefined) return undefined

	const transactionDismissKey = getGlobalTransactionDismissKey(transaction)
	const transactionKey = getTransactionKey(transaction)
	if (transactionOriginRef.current.transactionKey !== transactionKey) transactionOriginRef.current = { routeHash: window.location.hash, routeKey, transactionKey }
	if (dismissed || transactionDismissKey === dismissedKey) return undefined
	const canDismiss = transaction.tone !== 'awaiting-wallet' && transaction.tone !== 'preparing' && transactionDismissKey !== undefined
	const compact = canDismiss && transaction.tone !== 'pending' && routeKey !== undefined && transactionOriginRef.current.routeKey !== undefined && routeKey !== transactionOriginRef.current.routeKey
	const dismiss = () => {
		setDismissedKey(transactionDismissKey)
		dismissGlobalTransaction(transaction)
	}
	const originHash = transactionOriginRef.current.routeHash
	const returnHref = transaction.tone === 'error' && originHash !== '' && window.location.hash !== originHash ? originHash : undefined
	const transactionUniverseId = transaction.universeId
	const universeWarning =
		transactionUniverseId === undefined || activeUniverseId === undefined || transactionUniverseId === activeUniverseId ? undefined : (
			<WarningSurface className='global-transaction-universe-warning' surface='flat' variant='compact'>
				<strong>{appCopy.transactionUniverseMismatch}</strong>
				<p>{appCopy.formatTransactionUniverseMismatch(formatUniverseIdHex(transactionUniverseId), formatUniverseIdHex(activeUniverseId))}</p>
			</WarningSurface>
		)

	return (
		<div className='global-transaction-tray'>
			<TransactionPresentationNotice compact={compact} contextWarning={universeWarning} dismissible={canDismiss} noticeRef={noticeRef} onDismiss={dismiss} returnHref={returnHref} transaction={transaction} />
		</div>
	)
}
