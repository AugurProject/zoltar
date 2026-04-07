import type { JSX } from 'preact'

type FormInputProps = JSX.IntrinsicElements['input'] & {
	invalid?: boolean
}

export function FormInput({ className = '', invalid = false, ...props }: FormInputProps) {
	const nextClassName = ['form-input', invalid ? 'is-invalid' : '', className].filter(Boolean).join(' ')

	return <input {...props} aria-invalid={invalid ? 'true' : undefined} className={nextClassName} />
}
