import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { ReadinessAction } from '@zoltar/ui-core-shared/types/components.js'

function VaultActionLauncher({ action }: { action: Omit<ReadinessAction, 'title'> }) {
	if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
	return (
		<div key={action.key} className='vault-action-launcher'>
			<ActionLauncherButton
				describedBy={action.disabledReasonId}
				idleLabel={action.actionLabel}
				pendingLabel={commonCopy.opening}
				onClick={() => action.onAction?.()}
				tone='secondary'
				availability={withWalletBlocker({ disabled: action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined, reason: action.blocker }, action.walletBlocker)}
			/>
			{action.description === undefined ? undefined : <UserMessage className='detail' detail={action.description} />}
		</div>
	)
}

/** The selected vault's actions that open their own workflow, such as liquidating it. */
export function VaultAdditionalActions({ error, additionalActions }: { error: string | undefined; additionalActions: Omit<ReadinessAction, 'title'>[] }) {
	return (
		<>
			{additionalActions.map(action => (
				<VaultActionLauncher key={action.key} action={action} />
			))}
			<ErrorNotice message={error} />
		</>
	)
}
