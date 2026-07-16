import * as transactionReviewCopy from '../copy/transactionReview.js'
import { useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

type TransactionReviewRow = {
	label: ComponentChildren
	value: ComponentChildren
}

type TransactionReviewProps = {
	className?: string
	details?: TransactionReviewRow[]
	primary: TransactionReviewRow[]
	risks?: ComponentChildren[]
}

export function TransactionReview({ className = '', details = [], primary, risks = [] }: TransactionReviewProps) {
	const titleId = useId()
	return (
		<section className={`transaction-review ${className}`.trim()} aria-labelledby={titleId}>
			<div className='transaction-review-header'>
				<h4 id={titleId}>{transactionReviewCopy.transactionReview}</h4>
				<p className='detail'>{transactionReviewCopy.reviewBeforeSubmitting}</p>
			</div>
			<div className='transaction-review-primary' role='list'>
				{primary.map((row, index) => (
					<div className='transaction-review-row' key={`${index}`} role='listitem'>
						<span>{row.label}</span>
						<strong>{row.value}</strong>
					</div>
				))}
			</div>
			{details.length === 0 ? undefined : (
				<div className='transaction-review-details' role='list'>
					{details.map((row, index) => (
						<div className='transaction-review-detail-row' key={`${index}`} role='listitem'>
							<span>{row.label}</span>
							<strong>{row.value}</strong>
						</div>
					))}
				</div>
			)}
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
		</section>
	)
}
