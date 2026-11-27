import { useId } from 'preact/hooks'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as copy from '../../../copy/securityPool.js'
import type { useSecurityPoolActions } from '../hooks/useSecurityPoolActions.js'

export type SecurityPoolActions = ReturnType<typeof useSecurityPoolActions>

export function SecurityPoolInput({
	label,
	value,
	onChange,
	disabled = false,
	hint,
	numeric = false,
	describedBy,
	error,
	liveError = false,
}: {
	label: string
	value: string
	onChange: (value: string) => void
	disabled?: boolean
	hint?: string | undefined
	numeric?: boolean
	describedBy?: string | undefined
	error?: string | undefined
	/** Announces an error that arrives after the field is shown, such as one from a chain read. */
	liveError?: boolean
}) {
	const id = useId()
	return (
		<div className='field'>
			<label htmlFor={id}>{label}</label>
			<FormInput id={id} value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} hint={hint} inputMode={numeric ? 'decimal' : 'text'} autoComplete='off' aria-describedby={describedBy} error={error} liveError={liveError} />
		</div>
	)
}

export function SecurityPoolButton({
	model,
	action,
	label,
	pendingLabel,
	reason,
	sharedReasonId,
	hint,
	onClick,
}: {
	model: Pick<SecurityPoolActions, 'scope' | 'busy'>
	action: string
	label: string
	pendingLabel: string
	reason?: string | undefined
	/** Element that already states this button's disabled reason, so the button references it instead of repeating it. */
	sharedReasonId?: string | undefined
	/** Shown under an enabled button in the slot its disabled reason uses. */
	hint?: string | undefined
	onClick: () => Promise<void>
}) {
	const disabledReason = model.busy !== undefined && model.busy !== action ? copy.busy : reason
	return (
		<TransactionActionButton
			scope={model.scope}
			idleLabel={label}
			pendingLabel={pendingLabel}
			pending={model.busy === action}
			availability={{ disabled: disabledReason !== undefined, reason: disabledReason }}
			disabledReasonElementId={sharedReasonId}
			showDisabledReason={sharedReasonId === undefined}
			inlineHint={hint}
			onClick={() => void onClick()}
		/>
	)
}
