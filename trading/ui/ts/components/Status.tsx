export function Status({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: preact.ComponentChildren }) {
	return (
		<span class={`status status--${tone}`}>
			<span aria-hidden='true' class='status__dot' />
			{children}
		</span>
	)
}

export function AddressValue({ value }: { value: string }) {
	return (
		<code class='address' title={value}>
			{value}
		</code>
	)
}

export function securityPoolHref(value: string) {
	return `#/security-pool/${value}`
}

export function SecurityPoolAddressLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return (
		<a class='security-pool-link' href={securityPoolHref(value)} aria-label={`Open security pool ${value}`} aria-disabled={disabled} onClick={disabled ? event => event.preventDefault() : undefined}>
			<AddressValue value={value} />
		</a>
	)
}
