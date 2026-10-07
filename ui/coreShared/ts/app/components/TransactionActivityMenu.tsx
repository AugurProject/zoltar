import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { useDisclosurePopover } from '../../hooks/useDisclosurePopover.js'
import { abbreviateAddress } from '../../lib/address.js'
import * as commonCopy from '../../copy/common.js'
import * as transactionCopy from '../../copy/transaction.js'
import { retenseInProgressTitle } from '../../copy/transactionActionTenses.js'
import * as copy from '../../copy/transactionActivity.js'
import { Badge } from '../../components/Badge.js'
import { IdentifierValue } from '../../components/IdentifierValue.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { formatRelativeTimestamp, formatTimestamp, getWallClockTimestamp } from '../../lib/formatters.js'
import { countPendingTransactionActivity, type TransactionActivityEntry } from '../../transactions/transactionActivity.js'
import { markTransactionActivityOutcomesSeen, stopTrackingTransactionActivity, transactionActivity, unseenTransactionActivityOutcomes } from '../../transactions/transactionActivityStore.js'
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

/** A settled row reads as a result (`Created question`) or a plain action (`Create question`), not as still in progress. */
function getActivityTitle(entry: TransactionActivityEntry) {
	if (entry.status === 'pending') return entry.title
	return retenseInProgressTitle(entry.title, entry.status === 'confirmed' ? 'completed' : 'base')
}

function ActivityRow({ entry, onStopped }: { entry: TransactionActivityEntry; onStopped: () => void }) {
	const status = getStatusPresentation(entry)
	const title = getActivityTitle(entry)
	const submittedSeconds = BigInt(Math.floor(entry.submittedAt / 1_000))
	const explorerUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), entry.hash)
	return (
		<li className={`transaction-activity-item transaction-activity-${entry.status}`}>
			<div className='transaction-activity-item-heading'>
				<strong>{title}</strong>
				<Badge tone={status.tone}>{status.label}</Badge>
			</div>
			<div className='transaction-activity-item-meta'>
				<time dateTime={new Date(entry.submittedAt).toISOString()} title={formatTimestamp(submittedSeconds)}>
					{formatRelativeTimestamp(submittedSeconds, getWallClockTimestamp())}
				</time>
				{explorerUrl === undefined ? (
					// Without an explorer the hash is still copyable, so it can be checked against the wallet.
					<IdentifierValue className='transaction-activity-hash' value={entry.hash} abbreviated />
				) : (
					<a className='transaction-activity-hash' href={explorerUrl} target='_blank' rel='noreferrer' aria-label={transactionCopy.formatViewTransactionOnExplorer(entry.hash)}>
						{abbreviateAddress(entry.hash, 10, 6)}
					</a>
				)}
			</div>
			{/* A transaction replaced or dropped outside the app never gets a receipt; the user can release it after reading that it may still confirm. */}
			{entry.status === 'pending' ? <StopTrackingControl hash={entry.hash} title={title} onStopped={onStopped} /> : undefined}
		</li>
	)
}

/** Two steps, so releasing a transaction that can still confirm is never a single accidental click. */
function StopTrackingControl({ hash, onStopped, title }: { hash: TransactionActivityEntry['hash']; onStopped: () => void; title: string }) {
	const [confirming, setConfirming] = useState(false)
	const stopButtonRef = useRef<HTMLButtonElement>(null)
	const confirmButtonRef = useRef<HTMLButtonElement>(null)
	const returnToStopButton = useRef(false)
	const consequenceId = useId()
	useEffect(() => {
		if (confirming) {
			confirmButtonRef.current?.focus()
			return
		}
		if (!returnToStopButton.current) return
		returnToStopButton.current = false
		stopButtonRef.current?.focus()
	}, [confirming])
	if (!confirming)
		return (
			<button ref={stopButtonRef} className='quiet transaction-activity-dismiss' type='button' aria-label={copy.formatStopTracking(title)} onClick={() => setConfirming(true)}>
				{copy.stopTracking}
			</button>
		)
	return (
		<div className='transaction-activity-stop' role='group' aria-label={copy.formatStopTracking(title)}>
			<p id={consequenceId} className='transaction-activity-stop-consequence'>
				{copy.stopTrackingConsequence}
			</p>
			<div className='actions'>
				<button
					ref={confirmButtonRef}
					className='secondary'
					type='button'
					aria-describedby={consequenceId}
					onClick={() => {
						stopTrackingTransactionActivity(hash)
						onStopped()
					}}
				>
					{copy.stopTracking}
				</button>
				<button
					className='quiet'
					type='button'
					onClick={() => {
						returnToStopButton.current = true
						setConfirming(false)
					}}
				>
					{copy.keepTracking}
				</button>
			</div>
		</div>
	)
}

/** The latest outcome the watcher recorded while no status panel showed it, as live-region text. */
function getSettledAnnouncement(entries: readonly TransactionActivityEntry[], unseen: readonly string[]) {
	const latest = unseen.at(-1)
	const entry = latest === undefined ? undefined : entries.find(candidate => candidate.hash === latest)
	if (entry === undefined || entry.status === 'pending') return ''
	return copy.formatSettledTransactionAnnouncement(getActivityTitle(entry), getStatusPresentation(entry).label)
}

/** Header control listing recent transactions of the connected account, with a count of those still pending. */
export function TransactionActivityMenu() {
	const { containerRef, open, toggle, triggerRef } = useDisclosurePopover()
	const panelRef = useRef<HTMLDivElement>(null)
	const titleId = useId()
	const { entries, ownerKey } = transactionActivity.value
	const unseen = unseenTransactionActivityOutcomes.value
	const pendingCount = countPendingTransactionActivity(entries)
	const unseenEntries = entries.filter(entry => entry.status !== 'pending' && unseen.includes(entry.hash))
	const unseenFailure = unseenEntries.some(entry => entry.status === 'failed')
	// The owner key ends with the account; without one there is no list to show yet.
	const hasAccount = ownerKey !== undefined && !ownerKey.endsWith(':')

	useEffect(() => {
		if (open) panelRef.current?.focus()
	}, [open])
	// The open list shows every outcome, including ones recorded while it is open.
	useEffect(() => {
		if (open) markTransactionActivityOutcomesSeen()
	}, [open, unseen])

	let liveText = ''
	if (pendingCount > 0) liveText = copy.formatPendingTransactionCount(pendingCount)
	else if (unseenEntries.length > 0) liveText = getSettledAnnouncement(entries, unseen)

	return (
		<div className='app-settings transaction-activity' ref={containerRef}>
			<button ref={triggerRef} className='app-settings-trigger transaction-activity-trigger' type='button' aria-expanded={open} aria-haspopup='dialog' aria-label={copy.formatActivityTriggerLabel(pendingCount, unseenEntries.length)} onClick={toggle}>
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
				{/* A result recorded while no status panel showed it stays marked until the list is opened. */}
				{pendingCount > 0 || unseenEntries.length === 0 ? undefined : <span className={`transaction-activity-result ${unseenFailure ? 'danger' : 'ok'}`} aria-hidden='true' />}
			</button>
			<span className='visually-hidden' aria-live='polite'>
				{liveText}
			</span>
			{open ? (
				<div ref={panelRef} className='app-settings-menu transaction-activity-menu' role='dialog' aria-labelledby={titleId} tabIndex={-1}>
					<h2 id={titleId} className='transaction-activity-title'>
						{copy.recentTransactions}
					</h2>
					{entries.length === 0 ? (
						<p className='detail'>{hasAccount ? copy.noRecentTransactions : copy.connectWalletForActivity}</p>
					) : (
						<ol className='transaction-activity-list'>
							{entries.map(entry => (
								<ActivityRow key={entry.hash} entry={entry} onStopped={() => panelRef.current?.focus()} />
							))}
						</ol>
					)}
				</div>
			) : undefined}
		</div>
	)
}
