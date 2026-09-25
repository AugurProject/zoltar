import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren } from 'preact'
import { Badge } from './Badge.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { AddressValue } from './AddressValue.js'
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { buildAddressExplorerUrl } from '../wallet/networkProfile.js'
import type { BadgeTone, GlobalTransactionPresentation } from '../types/components.js'

type TransactionPresentationNoticeProps = {
	className?: string
	collapseDetails?: boolean
	compact?: boolean
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

function TransactionDetailValue({ value }: { value: ComponentChildren }) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return <>{value}</>
	const explorerUrl = buildAddressExplorerUrl(getActiveNetworkProfile(), value)
	return (
		<span className='global-transaction-identifier'>
			<AddressValue address={value} responsiveAbbreviation />
			{explorerUrl === undefined ? undefined : (
				<a href={explorerUrl} target='_blank' rel='noreferrer' aria-label={transactionCopy.formatViewAddressOnExplorer(value)}>
					{transactionCopy.explorer}
				</a>
			)}
		</span>
	)
}

export function TransactionPresentationNotice({ className = '', collapseDetails = false, compact = false, contextWarning, transaction }: TransactionPresentationNoticeProps) {
	const badge = getTransactionBadge(transaction.tone)
	const title = transaction.title
	const collapsedDetail = compact && transaction.tone !== 'error' ? transaction.detail : undefined
	const transactionHash = transaction.hash
	const rows = transaction.rows ?? []
	const technicalRows = transaction.technicalRows ?? []
	const noticeClassName = ['global-transaction-notice', className].filter(Boolean).join(' ')
	const technicalRowsList = (
		<dl className='global-transaction-notice-rows'>
			{technicalRows.map((row, rowIndex) => (
				<div className='global-transaction-notice-row' key={`${row.label}:${rowIndex.toString()}`}>
					<dt>{row.label}</dt>
					<dd>
						<TransactionDetailValue value={row.value} />
					</dd>
				</div>
			))}
		</dl>
	)
	const detailRows = (
		<>
			{rows.length === 0 ? undefined : (
				<dl className='global-transaction-notice-rows'>
					{rows.map((row, rowIndex) => (
						<div className='global-transaction-notice-row' key={`${row.label}:${rowIndex.toString()}`}>
							<dt>{row.label}</dt>
							<dd>
								<TransactionDetailValue value={row.value} />
							</dd>
						</div>
					))}
				</dl>
			)}
			{technicalRows.length > 0 &&
				(collapseDetails ? (
					<section aria-label={commonCopy.technicalDetails}>
						<h4 className='global-transaction-technical-heading'>{commonCopy.technicalDetails}</h4>
						{technicalRowsList}
					</section>
				) : (
					<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>{technicalRowsList}</ReadOnlyDetailAccordion>
				))}
		</>
	)
	const hashContent =
		transactionHash === undefined ? undefined : (
			<div className='global-transaction-hash'>
				{compact ? undefined : <span>{transactionCopy.transactionHash}</span>}
				<TransactionHashLink hash={transactionHash} />
			</div>
		)

	return (
		<div className={noticeClassName} role={transaction.tone === 'error' ? 'alert' : 'status'} aria-live={transaction.tone === 'error' ? 'assertive' : 'polite'}>
			{contextWarning}
			<div className='global-transaction-notice-copy'>
				<div className='global-transaction-notice-header'>
					<Badge tone={badge.tone}>{badge.label}</Badge>
					{transaction.tone === 'awaiting-wallet' ? <span className='spinner global-transaction-spinner' aria-hidden='true' /> : undefined}
					{title === undefined ? undefined : <strong>{title}</strong>}
					{compact ? hashContent : undefined}
				</div>
				{compact && transaction.tone === 'error' ? <div className='global-transaction-notice-recovery'>{transaction.detail ?? transactionCopy.failureReasonUnavailable}</div> : undefined}
				{!compact && transaction.detail !== undefined ? <div className='global-transaction-notice-detail'>{transaction.detail}</div> : undefined}
				{compact ? undefined : hashContent}
				{collapseDetails && (rows.length > 0 || technicalRows.length > 0 || collapsedDetail !== undefined) ? (
					<ReadOnlyDetailAccordion title={transactionCopy.transactionDetails}>
						{collapsedDetail === undefined ? undefined : <div className='global-transaction-notice-detail'>{collapsedDetail}</div>}
						{detailRows}
					</ReadOnlyDetailAccordion>
				) : (
					detailRows
				)}
			</div>
		</div>
	)
}
