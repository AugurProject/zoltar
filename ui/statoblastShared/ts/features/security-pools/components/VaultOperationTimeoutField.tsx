import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useId } from 'preact/hooks'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getStagedOperationTimeoutFieldError, getStagedOperationTimeoutSeconds, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'

export function VaultOperationTimeoutField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
	const helpId = useId()
	const errorId = useId()
	const seconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(value))
	const error = getStagedOperationTimeoutFieldError(value)
	const help = seconds === undefined || error !== undefined ? securityPoolCopy.selfServiceExecutionTimeoutHelpText : securityPoolCopy.formatManualExecutionTimeoutResolvedDetail(formatDuration(seconds))
	return (
		<>
			<label className='field'>
				<span>{commonCopy.manualExecutionTimeout}</span>
				<div className='field-inline'>
					<FormInput
						aria-describedby={error === undefined ? helpId : `${errorId} ${helpId}`}
						className='field-inline-input'
						disabled={disabled}
						inputMode='numeric'
						invalid={error !== undefined}
						max={MAX_STAGED_OPERATION_TIMEOUT_MINUTES.toString()}
						min={MIN_STAGED_OPERATION_TIMEOUT_MINUTES.toString()}
						onInput={event => onChange(event.currentTarget.value)}
						pattern='[0-9]*'
						step='1'
						value={value}
					/>
					<span className='field-inline-action'>{commonCopy.minutes}</span>
				</div>
			</label>
			{error === undefined ? undefined : <UserMessage placement='field' tone='error' id={errorId} detail={error} />}
			<UserMessage placement='field' id={helpId} detail={help} />
		</>
	)
}
