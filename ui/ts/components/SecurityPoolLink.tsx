import type { ComponentChildren } from 'preact'
import type { Address } from 'viem'
import { getSecurityPoolLinkHref, navigateToSecurityPool } from '../lib/securityPoolNavigation.js'

type SecurityPoolLinkProps = {
	children?: ComponentChildren
	className?: string
	securityPoolAddress: Address
	selectedPoolView?: string
	universeId?: bigint | undefined
}

export function SecurityPoolLink({ children, className = '', securityPoolAddress, selectedPoolView, universeId }: SecurityPoolLinkProps) {
	const href = getSecurityPoolLinkHref(securityPoolAddress, selectedPoolView, universeId)
	const label = children ?? securityPoolAddress

	return (
		<a
			className={`security-pool-link ${className}`}
			href={href}
			onClick={event => {
				if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
				event.preventDefault()
				navigateToSecurityPool(securityPoolAddress, selectedPoolView, universeId)
			}}
			title={securityPoolAddress}
		>
			{label}
		</a>
	)
}
