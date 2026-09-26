import { toChildArray, type ComponentChildren } from 'preact'

type HeaderMetricGroupProps = {
	/** Optional control that acts on the whole group, such as a refresh button. */
	action?: ComponentChildren
	children: ComponentChildren
	label: string
}

/**
 * One captioned group of metrics, such as balances or REP prices, in the account popover. Every metric keeps a
 * fixed row while values load, fail, or stay disconnected.
 */
export function HeaderMetricGroup({ action, children, label }: HeaderMetricGroupProps) {
	if (toChildArray(children).length < 1) throw new Error(`Header metric group ${label} needs at least one metric cell`)
	return (
		<div role='group' className='overview-metric-group' aria-label={label}>
			<span className='overview-metric-group-caption'>
				<span className='overview-metric-group-label' aria-hidden='true'>
					{label}
				</span>
				{action}
			</span>
			<div className='overview-metric-group-items'>{children}</div>
		</div>
	)
}
