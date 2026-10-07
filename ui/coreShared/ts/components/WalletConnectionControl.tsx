import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { Badge } from './Badge.js'
import { InlineHint } from './InlineHint.js'

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
	disabledReason,
}: {
	label: ComponentChildren
	pendingLabel?: ComponentChildren
	pending?: boolean
	disabled?: boolean
	onClick(): void
	className?: string
	ariaLabel?: string | undefined
	title?: string | undefined
	/** Why the disabled control is unavailable; shown under it and read as its accessible description, like other disabled actions. */
	disabledReason?: string | undefined
}) {
	const reasonId = useId()
	const reason = disabled && !pending ? disabledReason : undefined
	const button = (
		<button className={className} type='button' disabled={disabled || pending} aria-busy={pending} aria-label={ariaLabel} aria-describedby={reason === undefined ? undefined : reasonId} title={title} onClick={onClick}>
			{pending ? <LoadingText>{pendingLabel}</LoadingText> : label}
		</button>
	)
	if (reason === undefined) return button
	return (
		<div className='tx-action wallet-connection-action'>
			{button}
			<div className='tx-action-feedback'>
				<InlineHint id={reasonId} message={reason} />
			</div>
		</div>
	)
}

export function WalletNetworkControl({ label, badge, disabled = false, onClick, className }: { label: ComponentChildren; badge?: ComponentChildren; disabled?: boolean; onClick(): void; className?: string }) {
	return (
		<>
			{badge === undefined ? undefined : <Badge tone='danger'>{badge}</Badge>}
			<WalletConnectionControl label={label} disabled={disabled} onClick={onClick} className={`${className ?? 'secondary wallet-button'} wallet-network-switch`} />
		</>
	)
}
