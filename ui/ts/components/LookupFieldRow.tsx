import type { ComponentChildren, JSX } from 'preact'
import { FormInput } from './FormInput.js'

type LookupFieldRowProps = {
	action?: ComponentChildren
	disabled?: boolean
	inputClassName?: string
	inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode']
	invalid?: boolean
	label: ComponentChildren
	onInput: (value: string) => void
	placeholder?: string
	value: string
}

export function LookupFieldRow({ action, disabled = false, inputClassName = '', inputMode, invalid = false, label, onInput, placeholder, value }: LookupFieldRowProps) {
	return (
		<label className='field lookup-field-row'>
			<span>{label}</span>
			<div className={`lookup-field-controls ${action === undefined ? '' : 'has-action'}`.trim()}>
				<FormInput className={inputClassName} value={value} inputMode={inputMode} invalid={invalid} disabled={disabled} onInput={event => onInput(event.currentTarget.value)} placeholder={placeholder} />
				{action === undefined ? undefined : <div className='actions'>{action}</div>}
			</div>
		</label>
	)
}
