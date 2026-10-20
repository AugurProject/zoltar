import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import { AddressValue } from './AddressValue.js'

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

/** Pool identity links to its explorer; the separate local link opens the pool's detail route. */
export function SecurityPoolLink({ ariaLabel, children, className, disabled = false, href, onNavigate, securityPoolAddress }: SecurityPoolLinkProps) {
	const navigation = (
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
			{children ?? commonCopy.openPool}
		</a>
	)
	if (children !== undefined && children !== null) return navigation
	return (
		<span className='security-pool-navigation'>
			<AddressValue address={securityPoolAddress} />
			{navigation}
		</span>
	)
}
