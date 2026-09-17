import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'

export function RequiredFieldLabel({ children }: { children: ComponentChildren }) {
	return (
		<>
			{children}{' '}
			<span className='required-field-indicator' aria-hidden='true'>
				*
			</span>
			<span className='visually-hidden'> ({commonCopy.required})</span>
		</>
	)
}

/** FormInput owns input hints and errors; this wrapper associates the label with its control. */
export function FormField({ id, label, required = false, children }: { id: string; label: ComponentChildren; required?: boolean; children: ComponentChildren }) {
	return (
		<div className='field'>
			<label for={id}>
				<span>{required ? <RequiredFieldLabel>{label}</RequiredFieldLabel> : label}</span>
			</label>
			{children}
		</div>
	)
}
