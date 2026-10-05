import { useEffect, useId, useRef } from 'preact/hooks'
import { useDisclosurePopover } from '../../hooks/useDisclosurePopover.js'
import { abbreviateAddress } from '../../lib/address.js'
import * as commonCopy from '../../copy/common.js'
import * as transactionCopy from '../../copy/transaction.js'
import * as copy from '../../copy/transactionActivity.js'
import { Badge } from '../../components/Badge.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { formatRelativeTimestamp, formatTimestamp, getWallClockTimestamp } from '../../lib/formatters.js'
import { countPendingTransactionActivity, type TransactionActivityEntry } from '../../transactions/transactionActivity.js'
import { stopTrackingTransactionActivity, transactionActivity } from '../../transactions/transactionActivityStore.js'
import { buildTransactionExplorerUrl } from '../../wallet/networkProfile.js'
import type { BadgeTone } from '../../types/components.js'

function getStatusPresentation(entry: TransactionActivityEntry): { label: string; tone: BadgeTone } {
	if (entry.status === 'pending') return { label: commonCopy.pending, tone: 'pending' }
	if (entry.status === 'confirmed') return { label: transactionCopy.confirmed, tone: 'ok' }
	switch (entry.failureKind) {
		case 'rejected':
			return { label: copy.rejected, tone: 'danger' }
		case 'reverted':
			return { label: copy.reverted, tone: 'danger' }
		case 'replaced':
			return { label: copy.replaced, tone: 'warning' }
		case 'dropped':
			return { label: copy.dropped, tone: 'warning' }
		default:
			return { label: commonCopy.failed, tone: 'danger' }
	}
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
					<span className='transaction-activity-hash'>{abbreviateAddress(entry.hash, 10, 6)}</span>
				) : (
					<a className='transaction-activity-hash' href={explorerUrl} target='_blank' rel='noreferrer' aria-label={transactionCopy.formatViewTransactionOnExplorer(entry.hash)}>
						{abbreviateAddress(entry.hash, 10, 6)}
					</a>
				)}
			</div>
			{/* A transaction replaced or dropped outside the app never gets a receipt; the user can release its lock. */}
			{entry.status === 'pending' ? (
				<button className='quiet transaction-activity-dismiss' type='button' aria-label={copy.formatStopTracking(entry.title)} onClick={() => stopTrackingTransactionActivity(entry.hash)}>
					{copy.stopTracking}
				</button>
			) : undefined}
		</li>
	)
}

/** Header control listing recent transactions of the connected account, with a count of those still pending. */
export function TransactionActivityMenu() {
	const { containerRef, open, toggle, triggerRef } = useDisclosurePopover({ closeOnFocusOutside: false })
	const panelRef = useRef<HTMLDivElement>(null)
	const titleId = useId()
	const entries = transactionActivity.value.entries
	const pendingCount = countPendingTransactionActivity(entries)

	useEffect(() => {
		if (open) panelRef.current?.focus()
	}, [open])

	return (
		<div className='app-settings transaction-activity' ref={containerRef}>
			<button ref={triggerRef} className='app-settings-trigger transaction-activity-trigger' type='button' aria-expanded={open} aria-haspopup='dialog' aria-label={copy.formatActivityTriggerLabel(pendingCount)} onClick={toggle}>
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
