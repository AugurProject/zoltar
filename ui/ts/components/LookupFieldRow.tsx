import type { ComponentChildren, JSX } from 'preact'

type LookupFieldRowProps = {
	action?: ComponentChildren
	inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode']
	label: ComponentChildren
	onInput: (value: string) => void
	placeholder?: string
	value: string
}

export function LookupFieldRow({ action, inputMode, label, onInput, placeholder, value }: LookupFieldRowProps) {
	const inputAriaLabel = typeof label === 'string' || typeof label === 'number' ? label.toString() : undefined

	return (
		<div className='field lookup-field-row'>
			<span>{label}</span>
			<div className={`lookup-field-controls ${action === undefined ? '' : 'has-action'}`.trim()}>
				<input aria-label={inputAriaLabel} value={value} inputMode={inputMode} onInput={event => onInput(event.currentTarget.value)} placeholder={placeholder} />
				{action === undefined ? undefined : <div className='actions'>{action}</div>}
			</div>
		</div>
	)
}
