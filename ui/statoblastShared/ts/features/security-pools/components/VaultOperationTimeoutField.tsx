import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getStagedOperationTimeoutSeconds } from '../lib/securityVault.js'

export function VaultOperationTimeoutField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
	const seconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(value))
	const help = seconds === undefined ? securityPoolCopy.selfServiceExecutionTimeoutHelpText : securityPoolCopy.formatManualExecutionTimeoutResolvedDetail(formatDuration(seconds))
	return (
		<>
			<label className='field'>
				<span>{commonCopy.manualExecutionTimeout}</span>
				<div className='field-inline'>
					<FormInput className='field-inline-input' inputMode='numeric' min='1' pattern='[0-9]*' step='1' value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} />
					<span className='field-inline-action'>{commonCopy.minutes}</span>
				</div>
			</label>
			<p className='detail'>{help}</p>
		</>
	)
}
