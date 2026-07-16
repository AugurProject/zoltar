import * as transactionReviewCopy from '../copy/transactionReview.js'
import { useId } from 'preact/hooks'
import type { TransactionContextItem } from '../types/components.js'

type TransactionObjectContextProps = {
	items: TransactionContextItem[]
}

export function TransactionObjectContext({ items }: TransactionObjectContextProps) {
	const titleId = useId()
	if (items.length === 0) return undefined

	return (
		<section className='transaction-object-context' aria-labelledby={titleId}>
			<strong id={titleId}>{transactionReviewCopy.confirmContext}</strong>
			<dl>
				{items.map((item, index) => (
					<div key={`${index}`}>
						<dt>{item.label}</dt>
						<dd>{item.value}</dd>
					</div>
				))}
			</dl>
		</section>
	)
}
