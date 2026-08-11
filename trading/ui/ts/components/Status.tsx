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
