import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import { useStatoblastRefreshError } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'

export function StatoblastReadFailure({ reason, readAt, onRetry, onOpenSettings }: { reason: string | undefined; readAt: number | undefined; onRetry(): void; onOpenSettings(): void }) {
	const failure = useStatoblastRefreshError(reason, readAt)
	if (failure === undefined) return undefined
	return (
		<UserMessage
			placement='page'
			tone={readAt === undefined ? 'error' : 'warning'}
			announcement='polite'
			title={readAt === undefined ? copy.cannotReachNetwork : undefined}
			detail={readAt === undefined ? undefined : failure}
			actions={
				<>
					<button className='secondary' type='button' onClick={onRetry}>
						{copy.tryAgain}
					</button>
					<button className='quiet' type='button' aria-haspopup='dialog' onClick={onOpenSettings}>
						{copy.changeRpcInSettings}
					</button>
				</>
			}
		/>
	)
}
