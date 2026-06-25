import type { ComponentChildren, JSX } from 'preact'
import { useId } from 'preact/hooks'
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
	const inputId = useId()
	return (
		<div className='field lookup-field-row'>
			<label className='lookup-field-label' for={inputId}>
				{label}
			</label>
			<div className={`lookup-field-controls ${action === undefined ? '' : 'has-action'}`.trim()}>
				<FormInput id={inputId} className={inputClassName} value={value} inputMode={inputMode} invalid={invalid} disabled={disabled} onInput={event => onInput(event.currentTarget.value)} placeholder={placeholder} />
				{action === undefined ? undefined : <div className='actions'>{action}</div>}
			</div>
		</div>
	)
}
