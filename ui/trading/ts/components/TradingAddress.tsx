import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { openSecurityPoolLabel } from '../copy/app.js'

export function TradingAddressValue({ value }: { value: string }) {
	return <ReadOnlyAddressValue address={value} className='address' responsiveAbbreviation />
}

function securityPoolHref(value: string) {
	return getTradingRouteHref(`#/security-pool/${value}`)
}

export function SecurityPoolAddressLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return (
		<a class='security-pool-link' href={securityPoolHref(value)} aria-label={openSecurityPoolLabel(value)} aria-disabled={disabled} onClick={disabled ? event => event.preventDefault() : undefined}>
			<TradingAddressValue value={value} />
		</a>
	)
}
