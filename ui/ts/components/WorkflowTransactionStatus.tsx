import { EntityCard } from './EntityCard.js'
import { TransactionActionStatus } from './TransactionActionStatus.js'
import type { WorkflowTransactionStatusProps } from '../types/components.js'

export function WorkflowTransactionStatus({ latestAction, outcome }: WorkflowTransactionStatusProps) {
	if (latestAction === undefined && outcome === undefined) return undefined

	return (
		<div className='workflow-transaction-status'>
			{outcome === undefined ? undefined : (
				<TransactionActionStatus
					status={{
						detail:
							outcome.nextStep === undefined ? (
								outcome.detail
							) : (
								<>
									{outcome.detail} Next: {outcome.nextStep}
								</>
							),
						title: outcome.title,
						tone: 'success',
					}}
				/>
			)}
			{latestAction === undefined ? undefined : (
				<EntityCard className={latestAction.embedInCard === true ? 'transaction-status-card embedded' : 'transaction-status-card'} title={latestAction.title} variant='compact'>
					<ul className='status-list hashes'>
						{latestAction.rows.map(row => (
							<li key={row.label}>
								<span>{row.label}</span>
								<strong>{row.value}</strong>
							</li>
						))}
					</ul>
				</EntityCard>
			)}
		</div>
	)
}
