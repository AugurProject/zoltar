import type { ComponentChildren } from 'preact'
import type { ActionAvailability } from '../types/components.js'
import { TransactionActionButton } from './TransactionActionButton.js'

type ActionLauncherButtonProps = {
	availability?: ActionAvailability
	className?: string
	describedBy?: string | undefined
	disabled?: boolean
	idleLabel: ComponentChildren
	onClick: () => void
	pending?: boolean
	pendingLabel: ComponentChildren
	showDisabledReason?: boolean
	tone?: 'primary' | 'secondary'
	type?: 'button' | 'submit'
}

/** Launches a workflow or dialog. Shares pending, disabled-reason, and lock behavior with `TransactionActionButton`. */
export function ActionLauncherButton({ describedBy, showDisabledReason = true, ...props }: ActionLauncherButtonProps) {
	// Launchers sit in dense action rows, so the reason slot only renders when a reason exists instead of reserving space.
	const rendersDisabledReason = showDisabledReason && props.availability?.disabled === true && props.availability.reason !== undefined
	return <TransactionActionButton {...props} disabledReasonElementId={describedBy} showDisabledReason={rendersDisabledReason} />
}
