import type { ComponentChildren, JSX } from 'preact'
import { useId } from 'preact/hooks'

type FormInputProps = JSX.IntrinsicElements['input'] & {
	adornment?: ComponentChildren
	error?: string | undefined
	hint?: string | undefined
	invalid?: boolean
}

function joinIds(...ids: Array<string | undefined>) {
	const joined = ids.filter(id => id !== undefined && id !== '').join(' ')
	return joined === '' ? undefined : joined
}

export function FormInput({ adornment, 'aria-describedby': ariaDescribedBy, className = '', error, hint, invalid = false, ...props }: FormInputProps) {
	const generatedErrorId = useId()
	const generatedHintId = useId()
	const generatedAdornmentId = useId()
	const hasError = error !== undefined
	const isInvalid = invalid || hasError
	const errorId = hasError ? generatedErrorId : undefined
	const hintId = hint === undefined ? undefined : generatedHintId
	const adornmentId = adornment === undefined ? undefined : generatedAdornmentId
	const describedBy = joinIds(typeof ariaDescribedBy === 'string' ? ariaDescribedBy : undefined, errorId, hintId, adornmentId)
	const nextClassName = ['form-input', isInvalid ? 'is-invalid' : '', className].filter(Boolean).join(' ')
	const input = <input {...props} aria-describedby={describedBy} aria-invalid={isInvalid ? 'true' : undefined} className={nextClassName} />
	const control =
		adornment === undefined ? (
			input
		) : (
			<div className='form-input-adorned'>
				{input}
				<span aria-hidden='true' className='form-input-adornment' id={adornmentId}>
					{adornment}
				</span>
			</div>
		)
	if (errorId === undefined && hintId === undefined) return control

	return (
		<>
			{control}
			{errorId === undefined ? undefined : (
				<p className='field-error' id={errorId}>
					{error}
				</p>
			)}
			{hintId === undefined ? undefined : (
				<p className='field-hint' id={hintId}>
					{hint}
				</p>
			)}
		</>
	)
}
