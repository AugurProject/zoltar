import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { getTradingRouteHref } from '../lib/routing.js'

export function Status({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: preact.ComponentChildren }) {
	const badgeTones = { bad: 'blocked', good: 'ok', neutral: 'muted', warn: 'warning' } as const
	const badgeTone = badgeTones[tone]
	return (
		<Badge className={`status status--${tone}`} tone={badgeTone}>
			{children}
		</Badge>
	)
}

export function AddressValue({ value }: { value: string }) {
	return <ReadOnlyAddressValue address={value} className='address' responsiveAbbreviation />
}

function securityPoolHref(value: string) {
	return getTradingRouteHref(`#/security-pool/${value}`)
}

export function SecurityPoolAddressLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return (
		<a class='security-pool-link' href={securityPoolHref(value)} aria-label={`Open security pool ${value}`} aria-disabled={disabled} onClick={disabled ? event => event.preventDefault() : undefined}>
			<AddressValue value={value} />
		</a>
	)
}
