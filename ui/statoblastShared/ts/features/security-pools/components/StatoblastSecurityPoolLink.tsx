import type { ComponentChildren } from 'preact'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { SecurityPoolLink as SharedSecurityPoolLink } from '@zoltar/ui-core-shared/components/SecurityPoolLink.js'
import { getSecurityPoolLinkHref, navigateToSecurityPool } from '../lib/securityPoolNavigation.js'

type StatoblastSecurityPoolLinkProps = {
	ariaLabel?: string
	children?: ComponentChildren
	className?: string
	securityPoolAddress: Address
	selectedPoolView?: string
	universeId?: bigint | undefined
}

/** The shared pool link addressed to the Statoblast security pool route, keeping the selected view and universe in the query. */
export function StatoblastSecurityPoolLink({ ariaLabel, children, className, securityPoolAddress, selectedPoolView, universeId }: StatoblastSecurityPoolLinkProps) {
	return (
		<SharedSecurityPoolLink ariaLabel={ariaLabel} className={className} href={getSecurityPoolLinkHref(securityPoolAddress, selectedPoolView, universeId)} onNavigate={() => navigateToSecurityPool(securityPoolAddress, selectedPoolView, universeId)} securityPoolAddress={securityPoolAddress}>
			{children}
		</SharedSecurityPoolLink>
	)
}
