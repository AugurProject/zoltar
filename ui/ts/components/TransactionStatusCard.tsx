import { EntityCard } from './EntityCard.js'
import type { TransactionStatusCardProps } from '../types/components.js'

export function TransactionStatusCard({ actions, badge, className = '', detail, metrics, title }: TransactionStatusCardProps) {
	return (
		<EntityCard actions={actions} badge={badge} className={`transaction-status-card ${className}`.trim()} title={title} variant='compact'>
			{detail === undefined ? undefined : <p className='detail'>{detail}</p>}
			{metrics}
		</EntityCard>
	)
}
