import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import type { BadgeTone, GlobalTransactionPresentation } from '../types/components.js'

type TransactionPresentationNoticeProps = {
	className?: string
	contextWarning?: ComponentChildren
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

function getNoticeTitle(transaction: GlobalTransactionPresentation) {
	if (typeof transaction.title !== 'string') return transaction.title
	if (transaction.tone === 'error') return transaction.title.replace(/(?:^|\s)failed$/i, '') || undefined
	if (transaction.tone === 'success') return transaction.title.replace(/(?:^|\s)confirmed$/i, '') || undefined
	return transaction.title
}

export function TransactionPresentationNotice({ className = '', contextWarning, transaction }: TransactionPresentationNoticeProps) {
	const badge = getTransactionBadge(transaction.tone)
	const title = getNoticeTitle(transaction)
	const transactionHash = transaction.hash
	const rows = transaction.rows ?? []
	const technicalRows = transaction.technicalRows ?? []
	const noticeClassName = ['global-transaction-notice', className].filter(Boolean).join(' ')
	const transactionDetails = (
		<>
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
		</>
	)

	return (
		<div className={noticeClassName} role={transaction.tone === 'error' ? 'alert' : 'status'} aria-live={transaction.tone === 'error' ? 'assertive' : 'polite'}>
			{contextWarning}
			<div className='global-transaction-notice-copy'>
				<div className='global-transaction-notice-header'>
					<Badge tone={badge.tone}>{badge.label}</Badge>
					{transaction.tone === 'awaiting-wallet' ? <span className='spinner global-transaction-spinner' aria-hidden='true' /> : undefined}
					{title === undefined ? undefined : <strong>{title}</strong>}
				</div>
				{transactionHash === undefined ? undefined : <TransactionHashLink hash={transactionHash} />}
				{transactionDetails}
			</div>
		</div>
	)
}
