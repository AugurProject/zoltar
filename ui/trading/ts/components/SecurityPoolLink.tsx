import { SecurityPoolLink as SharedSecurityPoolLink } from '@zoltar/ui-core-shared/components/SecurityPoolLink.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { openSecurityPoolLabel } from '../copy/app.js'

/** The shared pool link addressed to Trading's security pool route. */
export function SecurityPoolLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return <SharedSecurityPoolLink ariaLabel={openSecurityPoolLabel(value)} disabled={disabled} href={getTradingRouteHref(`#/security-pool/${value}`)} securityPoolAddress={value} />
}
