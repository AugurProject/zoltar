import type { ComponentChildren } from 'preact'
import { useId, useState } from 'preact/hooks'
import * as commonCopy from '../copy/common.js'
import { AMOUNT_INPUT_PATTERN, formatAmountForDisplay, getAmountInputErrorMessage, getAmountPreset, validateAmountInput } from '../forms/amountInput.js'
import { formatCurrencyInputBalance } from '../lib/formatters.js'
import { FormInput } from './FormInput.js'
import { UserMessage } from './UserMessage.js'

type AmountFieldProps = {
	label: ComponentChildren
	value: string
	onChange: (value: string) => void
	/** Token symbol or unit shown inside the input, such as `REP`, `ETH`, or `×`. */
	unit?: string | undefined
	/** Token decimals used to parse, validate, and fill the amount. Defaults to 18. */
	decimals?: number | undefined
	allowZero?: boolean | undefined
	minimum?: bigint | undefined
	/** Largest accepted amount; larger inputs show an above-maximum error. */
	maximum?: bigint | undefined
	/**
	 * Shows a Max button that fills `amount`; while the amount is unknown or not positive it is disabled and `unavailableReason`
	 * is shown below the field and describes the button. Set `showUnavailableReason: false` where the surrounding form already
	 * presents that reason; the button then keeps it only as its tooltip.
	 */
	fillMax?: { amount: bigint | undefined; unavailableReason?: string | undefined; showUnavailableReason?: boolean | undefined } | undefined
	/** Integer percentages of the Max amount offered as quick fills, such as `[25, 50]`. */
	percentPresets?: readonly number[] | undefined
	/** Balance the amount is drawn from. Shown as a hint and checked as an upper bound. */
	balance?: bigint | undefined
	balanceLabel?: string | undefined
	/** Caller-owned validation message. It takes precedence over built-in amount checks. */
	error?: string | undefined
	/** Replaces the balance hint. */
	hint?: ComponentChildren
	/** Controls whether a pending error is shown. The field reveals errors on blur and hides them on input; pass this to own that state, for example to reveal after a submit attempt. */
	errorRevealed?: boolean | undefined
	onErrorRevealedChange?: ((revealed: boolean) => void) | undefined
	/** Fixed error id so a disabled submit button can reference the visible message. */
	errorId?: string | undefined
	id?: string | undefined
	disabled?: boolean | undefined
	placeholder?: string | undefined
}

/** Amount input with a unit, decimal keypad, balance hint, Max button, and errors that appear after blur instead of while typing. */
export function AmountField({ allowZero = false, balance, balanceLabel = commonCopy.balance, decimals = 18, disabled = false, error, errorId, errorRevealed, hint, id, fillMax, label, maximum, minimum, onChange, onErrorRevealedChange, percentPresets = [], placeholder, unit, value }: AmountFieldProps) {
	const generatedId = useId()
	const maxReasonId = useId()
	const hintId = useId()
	const inputId = id ?? generatedId
	const [internalErrorRevealed, setInternalErrorRevealed] = useState(false)
	const revealed = errorRevealed ?? internalErrorRevealed
	const setRevealed = (nextRevealed: boolean) => {
		setInternalErrorRevealed(nextRevealed)
		onErrorRevealedChange?.(nextRevealed)
	}
	const limits = { allowZero, balance, decimals, maximum, minimum, unit }
	const validation = validateAmountInput(value, limits)
	const validationError = error ?? getAmountInputErrorMessage(validation, limits)
	const visibleError = revealed ? validationError : undefined
	// The exceeds-balance error already states the balance, so the hint would repeat it.
	const showsBalanceError = visibleError !== undefined && error === undefined && validation.status === 'invalid' && validation.problem === 'exceedsBalance'
	const fillAmount = (amount: bigint) => {
		onChange(formatCurrencyInputBalance(amount, decimals))
		setRevealed(true)
	}
	const balanceHint = balance === undefined || showsBalanceError ? undefined : commonCopy.formatLabelValue(balanceLabel, formatAmountForDisplay(balance, decimals, unit))
	const fillMaxAmount = fillMax?.amount
	const fillUnavailable = disabled || fillMaxAmount === undefined || fillMaxAmount <= 0n
	// A disabled button cannot be focused and touch devices never show a title, so the reason is visible text that describes the
	// button. A reason the field hint already states is referenced instead of repeated, and a field disabled as a whole, or a
	// form that presents the reason itself, keeps it only as the tooltip.
	const fieldHint = hint ?? balanceHint
	const maxUnavailableReason = fillUnavailable ? fillMax?.unavailableReason : undefined
	const maxReasonIsHint = maxUnavailableReason !== undefined && maxUnavailableReason === fieldHint
	const showsMaxReason = !disabled && maxUnavailableReason !== undefined && fillMax?.showUnavailableReason !== false && !maxReasonIsHint
	let maxReasonDescriptionId: string | undefined
	if (maxReasonIsHint) maxReasonDescriptionId = hintId
	else if (showsMaxReason) maxReasonDescriptionId = maxReasonId
	const maxButton =
		fillMax === undefined ? undefined : (
			<button className='quiet field-inline-action' type='button' disabled={fillUnavailable} aria-describedby={maxReasonDescriptionId} title={maxReasonDescriptionId === undefined ? maxUnavailableReason : undefined} onClick={() => (fillMaxAmount === undefined ? undefined : fillAmount(fillMaxAmount))}>
				{commonCopy.max}
			</button>
		)
	// A lone symbol such as × reads as a speck at label size, so it renders at body size.
	const adornment = unit !== undefined && [...unit].length === 1 ? <span className='form-input-adornment-symbol'>{unit}</span> : unit
	return (
		<div className='field amount-field'>
			<label htmlFor={inputId}>
				<span>{label}</span>
			</label>
			<FormInput
				action={maxButton}
				adornment={adornment}
				autoComplete='off'
				disabled={disabled}
				error={visibleError}
				errorId={errorId}
				hint={fieldHint}
				hintId={hintId}
				id={inputId}
				inputMode='decimal'
				liveError
				onBlur={() => setRevealed(true)}
				onInput={event => {
					setRevealed(false)
					onChange(event.currentTarget.value)
				}}
				pattern={AMOUNT_INPUT_PATTERN}
				placeholder={placeholder}
				spellcheck={false}
				value={value}
			/>
			{showsMaxReason ? <UserMessage placement='field' id={maxReasonId} detail={maxUnavailableReason} /> : undefined}
			{percentPresets.length === 0 ? undefined : (
				<div className='amount-field-presets'>
					{percentPresets.map(percent => (
						<button key={percent} className='quiet' type='button' disabled={fillUnavailable} onClick={() => (fillMaxAmount === undefined ? undefined : fillAmount(getAmountPreset(fillMaxAmount, percent)))}>
							{commonCopy.formatAmountPresetLabel(percent)}
						</button>
					))}
				</div>
			)}
		</div>
	)
}
