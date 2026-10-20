import type { ComponentChildren, JSX } from 'preact'
import { UserMessage } from './UserMessage.js'
import { useId } from 'preact/hooks'

type FormInputProps = JSX.IntrinsicElements['input'] & {
	/** Control placed beside the input, such as a Max button. Errors and hints render below the row. */
	action?: ComponentChildren
	adornment?: ComponentChildren
	error?: string | undefined
	/** Fixed id for the error message so another control, such as a disabled submit button, can reference it. */
	errorId?: string | undefined
	hint?: ComponentChildren
	/** Fixed id for the hint so another control, such as a disabled Max button, can reference it. */
	hintId?: string | undefined
	invalid?: boolean
	/** Keeps a polite live region mounted so an error that appears after blur or submit is announced without interrupting typing. */
	liveError?: boolean
}

function joinIds(...ids: Array<string | undefined>) {
	const joined = ids.filter(id => id !== undefined && id !== '').join(' ')
	return joined === '' ? undefined : joined
}

/** True when a text description already contains the unit as a word, such as `REP` in `Balance: 1 200 REP`. */
function namesUnit(description: ComponentChildren, unit: ComponentChildren) {
	if (typeof description !== 'string' || typeof unit !== 'string' || unit === '') return false
	return description.split(/[\s.,;:()]+/).includes(unit)
}

export function FormInput({ action, adornment, 'aria-describedby': ariaDescribedBy, className = '', error, errorId: fixedErrorId, hint, hintId: fixedHintId, invalid = false, liveError = false, ...props }: FormInputProps) {
	const generatedErrorId = useId()
	const generatedHintId = useId()
	const generatedAdornmentId = useId()
	const hasError = error !== undefined
	const isInvalid = invalid || hasError
	const errorId = hasError ? (fixedErrorId ?? generatedErrorId) : undefined
	const hintId = hint === undefined ? undefined : (fixedHintId ?? generatedHintId)
	// The unit badge is aria-hidden and reaches assistive technology through the description, unless the visible hint or
	// error already names it; otherwise a balance hint would read as "Balance: 1 200 REP REP".
	const adornmentDescribes = adornment !== undefined && !namesUnit(error, adornment) && !namesUnit(hint, adornment)
	const adornmentId = adornment === undefined ? undefined : generatedAdornmentId
	const describedBy = joinIds(typeof ariaDescribedBy === 'string' ? ariaDescribedBy : undefined, errorId, hintId, adornmentDescribes ? adornmentId : undefined)
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
	const errorMessage = errorId === undefined ? undefined : <UserMessage placement='field' tone='error' id={errorId} detail={error} />
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
			{hintId === undefined ? undefined : <UserMessage placement='field' id={hintId} detail={hint} />}
		</>
	)
}
