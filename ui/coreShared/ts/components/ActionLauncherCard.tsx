import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'
import { ActionLauncherButton } from './ActionLauncherButton.js'
import type { ReadinessAction } from '../types/components.js'
import { getActiveAppChainWalletBlocker, withWalletBlocker } from '../transactions/actionGuards.js'

type ActionLauncherCardProps = {
	action: ReadinessAction
	children?: ComponentChildren
	pending?: boolean
	pendingLabel?: string
	tone?: 'primary' | 'secondary'
	/** Wallet state for launchers whose guards check the wallet before anything else, so a shown blocker offers the connect or switch fix while the wallet blocks. */
	wallet?: { accountAddress: string | undefined; isOnActiveAppChain: boolean } | undefined
}

export function ActionLauncherCard({ action, children, pending = false, pendingLabel = commonCopy.opening, tone = 'secondary', wallet }: ActionLauncherCardProps) {
	if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
	const disabled = action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined
	const showTitle = action.title.trim().toLowerCase() !== action.actionLabel.trim().toLowerCase()
	const showCopy = action.description !== undefined || showTitle || children !== undefined
	return (
		<section className={`action-launcher-card ${action.readiness} ${showCopy ? '' : 'compact'}`.trim()}>
			{showCopy ? (
				<div className='action-launcher-card-copy'>
					{showTitle ? <h4>{action.title}</h4> : undefined}
					{action.description === undefined ? undefined : <p className='detail'>{action.description}</p>}
					{children}
				</div>
			) : undefined}
			<div className='action-launcher-card-actions'>
				<ActionLauncherButton
					{...(action.disabledReasonId === undefined ? {} : { describedBy: action.disabledReasonId })}
					idleLabel={action.actionLabel}
					pendingLabel={pendingLabel}
					onClick={() => action.onAction?.()}
					pending={pending}
					tone={tone}
					availability={withWalletBlocker({ disabled, reason: action.blocker }, action.walletBlocker ?? (wallet === undefined || action.blocker === undefined ? undefined : getActiveAppChainWalletBlocker(wallet)))}
					showDisabledReason
				/>
			</div>
		</section>
	)
}
