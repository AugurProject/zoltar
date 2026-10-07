import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import type { ComponentChildren, RefObject } from 'preact'
import { useMemo, useRef } from 'preact/hooks'
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

/** Splits an address value, either bare or labelled as `Contract name (0x…)`, so it can render with the shared address component. */
function parseAddressDetailValue(value: ComponentChildren) {
	if (typeof value !== 'string') return undefined
	if (/^0x[0-9a-fA-F]{40}$/.test(value)) return { address: value, label: undefined }
	const labelled = /^(.+) \((0x[0-9a-fA-F]{40})\)$/.exec(value)
	const [, label, address] = labelled ?? []
	return label === undefined || address === undefined ? undefined : { address, label }
}

const embeddedAddressPattern = /(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/

/** Splits a call's argument list so embedded addresses use the shared responsive presentation. */
function splitEmbeddedAddresses(value: string) {
	return value
		.split(embeddedAddressPattern)
		.filter(segment => segment !== '')
		.map(segment => ({ isAddress: /^0x[0-9a-fA-F]{40}$/.test(segment), segment }))
}

function TransactionDetailAddress({ address, slot }: { address: string; slot: RefObject<HTMLElement> }) {
	const control = useRef<HTMLSpanElement>(null)
	const widthConstraint = useMemo(() => ({ slot, control }), [slot, control])
	return (
		<span className='global-transaction-detail-address' ref={control}>
			<AddressValue address={address} widthConstraint={widthConstraint} />
		</span>
	)
}

function TransactionDetailText({ value }: { value: string }) {
	const slot = useRef<HTMLSpanElement>(null)
	const segments = splitEmbeddedAddresses(value)
	if (!segments.some(({ isAddress }) => isAddress)) return <>{value}</>
	return (
		<span className='global-transaction-detail-text' ref={slot}>
			{segments.map(({ isAddress, segment }, index) => (isAddress ? <TransactionDetailAddress key={index} address={segment} slot={slot} /> : <span key={index}>{segment}</span>))}
		</span>
	)
}

function TransactionDetailValue({ value }: { value: ComponentChildren }) {
	const addressValue = parseAddressDetailValue(value)
	if (addressValue === undefined) return typeof value === 'string' ? <TransactionDetailText value={value} /> : <>{value}</>
	const { address, label } = addressValue
	const explorerUrl = buildAddressExplorerUrl(getActiveNetworkProfile(), address)
	// A long address abbreviates to fit its column rather than wrapping into a narrow stack of characters.
	return (
		<span className='global-transaction-identifier'>
			{label === undefined ? undefined : <span className='global-transaction-identifier-label'>{label}</span>}
			<AddressValue address={address} responsiveAbbreviation />
			{explorerUrl === undefined ? undefined : (
				<a href={explorerUrl} target='_blank' rel='noreferrer' aria-label={transactionCopy.formatViewAddressOnExplorer(address)}>
					{transactionCopy.explorer}
				</a>
			)}
		</span>
	)
}

export function TransactionPresentationNotice({ className = '', collapseDetails = false, compact = false, contextWarning, transaction }: TransactionPresentationNoticeProps) {
	const badge = getTransactionBadge(transaction.tone)
	const title = transaction.title
	const showsRecovery = compact && transaction.tone === 'error'
	const transactionHash = transaction.hash
	const rows = transaction.rows ?? []
	const technicalRows = transaction.technicalRows ?? []
	const noticeClassName = ['global-transaction-notice', className].filter(Boolean).join(' ')
	const technicalRowsList = (
		<dl className='global-transaction-notice-rows global-transaction-technical-rows'>
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
				{showsRecovery ? <div className='global-transaction-notice-recovery'>{transaction.detail ?? transactionCopy.failureReasonUnavailable}</div> : undefined}
				{/* The detail carries instructions such as "do not send it again" or "execute it manually", so it stays visible in the compact panel too. */}
				{showsRecovery || transaction.detail === undefined ? undefined : <div className='global-transaction-notice-detail'>{transaction.detail}</div>}
				{compact ? undefined : hashContent}
				{collapseDetails && (rows.length > 0 || technicalRows.length > 0) ? <ReadOnlyDetailAccordion title={transactionCopy.transactionDetails}>{detailRows}</ReadOnlyDetailAccordion> : detailRows}
			</div>
		</div>
	)
}
