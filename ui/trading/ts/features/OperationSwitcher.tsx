import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import * as workflowCopy from '../copy/workflows.js'
import type { OperationOption } from './live/operationOption.js'

/** Groups the labels of disabled options by their shared reason, so a reason that blocks several options is stated once. */
function getUnavailableOperationReasons<TValue extends string>(options: readonly OperationOption<TValue>[]) {
	const labelsByReason = new Map<string, string[]>()
	for (const option of options) {
		if (option.disabled !== true || option.reason === undefined) continue
		labelsByReason.set(option.reason, [...(labelsByReason.get(option.reason) ?? []), option.label])
	}
	return [...labelsByReason].map(([reason, labels]) => workflowCopy.unavailableOperationReason(labels, reason))
}

/** A segmented operation switcher that states why its disabled options are unavailable in visible text, not only in a tooltip. */
export function OperationSwitcher<TValue extends string>({ ariaLabel, onChange, options, value }: { ariaLabel: string; onChange: (value: TValue) => void; options: OperationOption<TValue>[]; value: TValue }) {
	const reasons = getUnavailableOperationReasons(options)
	return (
		<div className='operation-switcher'>
			<ViewTabs ariaLabel={ariaLabel} semantics='switcher' variant='segmented' size='compact' value={value} onChange={onChange} options={options} />
			{reasons.length === 0 ? undefined : (
				<ul className='operation-switcher-reasons'>
					{reasons.map(reason => (
						<li key={reason}>{reason}</li>
					))}
				</ul>
			)}
		</div>
	)
}
