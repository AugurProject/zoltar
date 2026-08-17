import { useId } from 'preact/hooks'
import type { TransactionContextItem } from '../types/components.js'

type TransactionObjectContextProps = {
	className?: string
	items: TransactionContextItem[]
	title?: string
}

export function TransactionObjectContext({ className = '', items, title }: TransactionObjectContextProps) {
	const titleId = useId()
	if (items.length === 0) return undefined

	return (
		<section className={`transaction-object-context ${className}`.trim()} {...(title === undefined ? {} : { 'aria-labelledby': titleId })}>
			{title === undefined ? undefined : <strong id={titleId}>{title}</strong>}
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
