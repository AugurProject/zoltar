import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { openSecurityPoolLabel } from '../copy/app.js'

/** Plain link from a SecurityPool address to its detail route. */
export function SecurityPoolLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return (
		<a class='security-pool-link' href={getTradingRouteHref(`#/security-pool/${value}`)} aria-label={openSecurityPoolLabel(value)} aria-disabled={disabled} onClick={disabled ? event => event.preventDefault() : undefined}>
			<ReadOnlyAddressValue address={value} responsiveAbbreviation />
		</a>
	)
}
