import { WarningSurface } from './WarningSurface.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import type { TransactionActionStatus as TransactionActionStatusValue } from '../types/components.js'

type TransactionActionStatusProps = {
	status: TransactionActionStatusValue
}

export function TransactionActionStatus({ status }: TransactionActionStatusProps) {
	const content = (
		<>
			<strong className='transaction-action-status-title'>{status.title}</strong>
			<p className='detail transaction-action-status-detail'>
				{status.detail}
				{status.hash === undefined ? undefined : (
					<>
						{' '}
						<TransactionHashLink hash={status.hash} />
					</>
				)}
			</p>
		</>
	)

	if (status.tone === 'warning') {
		return (
			<WarningSurface as='div' className='transaction-action-status warning' role='status' variant='compact'>
				{content}
			</WarningSurface>
		)
	}

	return (
		<div className={`transaction-action-status ${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>
			{content}
		</div>
	)
}
