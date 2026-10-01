import { useId } from 'preact/hooks'
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
	return [...labelsByReason].map(([reason, labels]) => ({ reason, text: workflowCopy.unavailableOperationReason(labels, reason) }))
}

/** A segmented operation switcher that states why its disabled options are unavailable in visible text, not only in a tooltip. */
export function OperationSwitcher<TValue extends string>({ ariaLabel, onChange, options, value }: { ariaLabel: string; onChange: (value: TValue) => void; options: OperationOption<TValue>[]; value: TValue }) {
	const reasonIdPrefix = useId()
	const reasons = getUnavailableOperationReasons(options).map((reason, index) => ({ ...reason, id: `${reasonIdPrefix}-reason-${index.toString()}` }))
	// Each disabled option points at the visible sentence that explains it, so assistive technology announces the same reason sighted users read.
	const describedOptions = options.map(option => {
		const reasonId = option.disabled === true ? reasons.find(reason => reason.reason === option.reason)?.id : undefined
		return reasonId === undefined ? option : { ...option, describedById: reasonId }
	})
	return (
		<div className='operation-switcher'>
			<ViewTabs ariaLabel={ariaLabel} semantics='switcher' variant='segmented' size='compact' value={value} onChange={onChange} options={describedOptions} />
			{reasons.length === 0 ? undefined : (
				<ul className='operation-switcher-reasons'>
					{reasons.map(reason => (
						<li id={reason.id} key={reason.id}>
							{reason.text}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
