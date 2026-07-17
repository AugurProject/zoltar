import * as transactionReviewCopy from '../copy/transactionReview.js'
import { useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { TransactionContextItem } from '../types/components.js'
import { TransactionObjectContext } from './TransactionObjectContext.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'

type TransactionReviewRow = {
	label: ComponentChildren
	value: ComponentChildren
}

type TransactionReviewProps = {
	className?: string
	context?: TransactionContextItem[]
	details?: TransactionReviewRow[]
	disclosures?: Array<{
		rows: TransactionReviewRow[]
		title: string
	}>
	primary: TransactionReviewRow[]
	risks?: ComponentChildren[]
	technicalDetails?: TransactionReviewRow[]
}

function renderDetailRows(rows: TransactionReviewRow[]) {
	return (
		<div className='transaction-review-details' role='list'>
			{rows.map((row, index) => (
				<div className='transaction-review-detail-row' key={`${index}`} role='listitem'>
					<span>{row.label}</span>
					<strong>{row.value}</strong>
				</div>
			))}
		</div>
	)
}

export function TransactionReview({ className = '', context = [], details = [], disclosures = [], primary, risks = [], technicalDetails = [] }: TransactionReviewProps) {
	const titleId = useId()
	return (
		<section className={`transaction-review ${className}`.trim()} aria-labelledby={titleId}>
			<TransactionObjectContext items={context} />
			<div className='transaction-review-header'>
				<h4 id={titleId}>{transactionReviewCopy.transactionReview}</h4>
			</div>
			<div className='transaction-review-primary' role='list'>
				{primary.map((row, index) => (
					<div className='transaction-review-row' key={`${index}`} role='listitem'>
						<span>{row.label}</span>
						<strong>{row.value}</strong>
					</div>
				))}
			</div>
			{details.length === 0 ? undefined : renderDetailRows(details)}
			{risks.length === 0 ? undefined : (
				<div className='transaction-review-risks'>
					<strong>{transactionReviewCopy.risksAndConsequences}</strong>
					<ul>
						{risks.map((risk, index) => (
							<li key={`${index}`}>{risk}</li>
						))}
					</ul>
				</div>
			)}
			{disclosures.map(disclosure => (
				<ReadOnlyDetailAccordion key={disclosure.title} title={disclosure.title}>
					{renderDetailRows(disclosure.rows)}
				</ReadOnlyDetailAccordion>
			))}
			{technicalDetails.length === 0 ? undefined : <ReadOnlyDetailAccordion title={transactionReviewCopy.technicalDetails}>{renderDetailRows(technicalDetails)}</ReadOnlyDetailAccordion>}
		</section>
	)
}
