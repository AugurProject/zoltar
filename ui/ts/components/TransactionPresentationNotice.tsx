import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { RefObject } from 'preact'
import { Badge } from './Badge.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import type { BadgeTone, GlobalTransactionPresentation } from '../types/components.js'

type TransactionPresentationNoticeProps = {
	className?: string
	dismissible?: boolean
	noticeRef?: RefObject<HTMLDivElement>
	onDismiss?: () => void
	transaction: GlobalTransactionPresentation
}

function getTransactionBadge(tone: GlobalTransactionPresentation['tone']): { label: string; tone: BadgeTone } {
	if (tone === 'preparing') return { tone: 'pending', label: transactionCopy.preparing }
	if (tone === 'awaiting-wallet') return { tone: 'pending', label: transactionCopy.awaitingWallet }
	if (tone === 'pending') return { tone: 'pending', label: commonCopy.pending }
	if (tone === 'success') return { tone: 'ok', label: transactionCopy.confirmed }
	if (tone === 'error') return { tone: 'danger', label: commonCopy.failed }
	return { tone: 'warning', label: transactionCopy.attention }
}

export function TransactionPresentationNotice({ className = '', dismissible = false, noticeRef, onDismiss, transaction }: TransactionPresentationNoticeProps) {
	const badge = getTransactionBadge(transaction.tone)
	const transactionHash = transaction.hash
	const rows = transaction.rows ?? []
	const technicalRows = transaction.technicalRows ?? []
	const noticeClassName = ['global-transaction-notice', className].filter(Boolean).join(' ')

	return (
		<div {...(noticeRef === undefined ? {} : { ref: noticeRef })} className={noticeClassName} role='status' aria-live='polite'>
			{!dismissible ? undefined : (
				<button className='quiet global-transaction-close' type='button' aria-label={transactionCopy.closeStatus} onClick={onDismiss}>
					<span aria-hidden='true'>×</span>
				</button>
			)}
			<div className='global-transaction-notice-copy'>
				<div className='global-transaction-notice-header'>
					<Badge tone={badge.tone}>{badge.label}</Badge>
					{transaction.tone === 'awaiting-wallet' ? <span className='spinner global-transaction-spinner' aria-hidden='true' /> : undefined}
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
				{technicalRows.length === 0 ? undefined : (
					<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
						<dl className='global-transaction-notice-rows'>
							{technicalRows.map((row, rowIndex) => (
								<div className='global-transaction-notice-row' key={`${row.label}:${rowIndex.toString()}`}>
									<dt>{row.label}</dt>
									<dd>{row.value}</dd>
								</div>
							))}
						</dl>
					</ReadOnlyDetailAccordion>
				)}
				{transactionHash === undefined ? undefined : <TransactionHashLink hash={transactionHash} />}
			</div>
			{!dismissible ? undefined : (
				<div className='global-transaction-actions'>
					<button className='secondary global-transaction-dismiss' type='button' onClick={onDismiss}>
						{transactionCopy.dismiss}
					</button>
				</div>
			)}
		</div>
	)
}
