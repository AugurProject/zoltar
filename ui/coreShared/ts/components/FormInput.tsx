import type { ComponentChildren, JSX } from 'preact'
import { useId } from 'preact/hooks'

type FormInputProps = JSX.IntrinsicElements['input'] & {
	/** Control placed beside the input, such as a Max button. Errors and hints render below the row. */
	action?: ComponentChildren
	adornment?: ComponentChildren
	error?: string | undefined
	/** Fixed id for the error message so another control, such as a disabled submit button, can reference it. */
	errorId?: string | undefined
	hint?: ComponentChildren
	invalid?: boolean
	/** Keeps a polite live region mounted so an error that appears after blur or submit is announced without interrupting typing. */
	liveError?: boolean
}

function joinIds(...ids: Array<string | undefined>) {
	const joined = ids.filter(id => id !== undefined && id !== '').join(' ')
	return joined === '' ? undefined : joined
}

export function FormInput({ action, adornment, 'aria-describedby': ariaDescribedBy, className = '', error, errorId: fixedErrorId, hint, invalid = false, liveError = false, ...props }: FormInputProps) {
	const generatedErrorId = useId()
	const generatedHintId = useId()
	const generatedAdornmentId = useId()
	const hasError = error !== undefined
	const isInvalid = invalid || hasError
	const errorId = hasError ? (fixedErrorId ?? generatedErrorId) : undefined
	const hintId = hint === undefined ? undefined : generatedHintId
	const adornmentId = adornment === undefined ? undefined : generatedAdornmentId
	const describedBy = joinIds(typeof ariaDescribedBy === 'string' ? ariaDescribedBy : undefined, errorId, hintId, adornmentId)
	const nextClassName = ['form-input', isInvalid ? 'is-invalid' : '', className].filter(Boolean).join(' ')
	const input = <input {...props} aria-describedby={describedBy} aria-invalid={isInvalid ? 'true' : undefined} className={nextClassName} />
	const adornedInput =
		adornment === undefined ? (
			input
		) : (
			<div className={isInvalid ? 'form-input-adorned is-invalid' : 'form-input-adorned'}>
				{input}
				<span aria-hidden='true' className='form-input-adornment' id={adornmentId}>
					{adornment}
				</span>
			</div>
		)
	const control =
		action === undefined ? (
			adornedInput
		) : (
			<div className='field-inline'>
				{adornedInput}
				{action}
			</div>
		)
	const errorMessage =
		errorId === undefined ? undefined : (
			<p className='field-error' id={errorId}>
				{error}
			</p>
		)
	if (errorId === undefined && hintId === undefined && !liveError) return control

	return (
		<>
			{control}
			{liveError ? (
				<div aria-live='polite' className='field-error-live-region'>
					{errorMessage}
				</div>
			) : (
				errorMessage
			)}
			{hintId === undefined ? undefined : (
				<p className='field-hint' id={hintId}>
					{hint}
				</p>
			)}
		</>
	)
}
