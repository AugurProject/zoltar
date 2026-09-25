import { useEffect, useId, useRef, useState } from 'preact/hooks'
import * as copy from '../../copy/transactionActivity.js'
import { Badge } from '../../components/Badge.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { formatRelativeTimestamp, formatTimestamp, getWallClockTimestamp } from '../../lib/formatters.js'
import { countPendingTransactionActivity, type TransactionActivityEntry } from '../../transactions/transactionActivity.js'
import { transactionActivity } from '../../transactions/transactionActivityStore.js'
import { buildTransactionExplorerUrl } from '../../wallet/networkProfile.js'
import type { BadgeTone } from '../../types/components.js'

function getStatusPresentation(entry: TransactionActivityEntry): { label: string; tone: BadgeTone } {
	if (entry.status === 'pending') return { label: copy.pending, tone: 'pending' }
	if (entry.status === 'confirmed') return { label: copy.confirmed, tone: 'ok' }
	switch (entry.failureKind) {
		case 'rejected':
			return { label: copy.rejected, tone: 'danger' }
		case 'reverted':
			return { label: copy.reverted, tone: 'danger' }
		case 'replaced':
			return { label: copy.replaced, tone: 'warning' }
		default:
			return { label: copy.failed, tone: 'danger' }
	}
}

function formatShortHash(hash: string) {
	return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function ActivityRow({ entry }: { entry: TransactionActivityEntry }) {
	const status = getStatusPresentation(entry)
	const submittedSeconds = BigInt(Math.floor(entry.submittedAt / 1_000))
	const explorerUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), entry.hash)
	return (
		<li className={`transaction-activity-item transaction-activity-${entry.status}`}>
			<div className='transaction-activity-item-heading'>
				<strong>{entry.title}</strong>
				<Badge tone={status.tone}>{status.label}</Badge>
			</div>
			<div className='transaction-activity-item-meta'>
				<time dateTime={new Date(entry.submittedAt).toISOString()} title={formatTimestamp(submittedSeconds)}>
					{formatRelativeTimestamp(submittedSeconds, getWallClockTimestamp())}
				</time>
				{explorerUrl === undefined ? (
					<span className='transaction-activity-hash'>{formatShortHash(entry.hash)}</span>
				) : (
					<a className='transaction-activity-hash' href={explorerUrl} target='_blank' rel='noreferrer' aria-label={copy.formatViewTransaction(entry.hash)}>
						{formatShortHash(entry.hash)}
					</a>
				)}
			</div>
		</li>
	)
}

/** Header control listing recent transactions of the connected account, with a count of those still pending. */
export function TransactionActivityMenu() {
	const [open, setOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const titleId = useId()
	const entries = transactionActivity.value.entries
	const pendingCount = countPendingTransactionActivity(entries)

	useEffect(() => {
		if (!open) return
		panelRef.current?.focus()
		const closeOnOutsideClick = (event: MouseEvent) => {
			if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			setOpen(false)
			triggerRef.current?.focus()
		}
		document.addEventListener('mousedown', closeOnOutsideClick)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('mousedown', closeOnOutsideClick)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [open])

	return (
		<div className='app-settings transaction-activity' ref={menuRef}>
			<button ref={triggerRef} className='app-settings-trigger transaction-activity-trigger' type='button' aria-expanded={open} aria-haspopup='dialog' aria-label={copy.formatActivityTriggerLabel(pendingCount)} onClick={() => setOpen(value => !value)}>
				{/* Narrow toolbars show the clock alone; the accessible name always carries the label and pending count. */}
				<svg className='transaction-activity-icon' aria-hidden='true' viewBox='0 0 16 16' width='16' height='16'>
					<circle cx='8' cy='8' r='6.25' fill='none' stroke='currentColor' stroke-width='1.5' />
					<path d='M8 4.5V8l2.5 1.5' fill='none' stroke='currentColor' stroke-linecap='round' stroke-width='1.5' />
				</svg>
				<span className='transaction-activity-label'>{copy.activity}</span>
				{pendingCount === 0 ? undefined : (
					<span className='transaction-activity-count' aria-hidden='true'>
						{pendingCount}
					</span>
				)}
			</button>
			<span className='visually-hidden' aria-live='polite'>
				{pendingCount === 0 ? '' : copy.formatPendingTransactionCount(pendingCount)}
			</span>
			{open ? (
				<div ref={panelRef} className='app-settings-menu transaction-activity-menu' role='dialog' aria-labelledby={titleId} tabIndex={-1}>
					<h2 id={titleId} className='transaction-activity-title'>
						{copy.recentTransactions}
					</h2>
					{entries.length === 0 ? (
						<p className='detail'>{copy.noRecentTransactions}</p>
					) : (
						<ol className='transaction-activity-list'>
							{entries.map(entry => (
								<ActivityRow key={entry.hash} entry={entry} />
							))}
						</ol>
					)}
				</div>
			) : undefined}
		</div>
	)
}
