import type { ComponentChildren } from 'preact'
import { ReadOnlyAddressValue } from './AddressValue.js'

type SecurityPoolLinkProps = {
	ariaLabel?: string | undefined
	children?: ComponentChildren
	className?: string | undefined
	disabled?: boolean
	href: string
	/** In-app navigation for unmodified primary clicks; modified clicks and new tabs still follow `href`. */
	onNavigate?: (() => void) | undefined
	securityPoolAddress: string
}

/** Link from a security pool address to its detail route; the address is the visible label unless children replace it. */
export function SecurityPoolLink({ ariaLabel, children, className, disabled = false, href, onNavigate, securityPoolAddress }: SecurityPoolLinkProps) {
	return (
		<a
			aria-disabled={disabled ? 'true' : undefined}
			aria-label={ariaLabel}
			className={className === undefined ? 'security-pool-link' : `security-pool-link ${className}`}
			href={href}
			onClick={event => {
				if (disabled) {
					event.preventDefault()
					return
				}
				if (onNavigate === undefined || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
				event.preventDefault()
				onNavigate()
			}}
			title={securityPoolAddress}
		>
			{children ?? <ReadOnlyAddressValue address={securityPoolAddress} responsiveAbbreviation />}
		</a>
	)
}
