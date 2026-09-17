import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { Badge } from './Badge.js'

/** Presentation only: the application owns wallet sessions, visibility and callbacks. */
export function WalletConnectionControl({
	label,
	pendingLabel = label,
	pending = false,
	disabled = false,
	onClick,
	className = 'secondary wallet-button',
	ariaLabel,
	title,
}: {
	label: ComponentChildren
	pendingLabel?: ComponentChildren
	pending?: boolean
	disabled?: boolean
	onClick(): void
	className?: string
	ariaLabel?: string | undefined
	title?: string | undefined
}) {
	return (
		<button className={className} type='button' disabled={disabled || pending} aria-busy={pending} aria-label={ariaLabel} title={title} onClick={onClick}>
			{pending ? <LoadingText>{pendingLabel}</LoadingText> : label}
		</button>
	)
}

export function WalletNetworkControl({ label, badge, disabled = false, onClick, className }: { label: ComponentChildren; badge?: ComponentChildren; disabled?: boolean; onClick(): void; className?: string }) {
	return (
		<>
			{badge === undefined ? undefined : <Badge tone='danger'>{badge}</Badge>}
			<WalletConnectionControl label={label} disabled={disabled} onClick={onClick} {...(className === undefined ? {} : { className })} />
		</>
	)
}
