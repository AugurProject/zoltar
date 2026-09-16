import { useRef } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { getSelectedPoolViewLabel, type SelectedPoolView } from '../lib/securityPoolWorkflow.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as copy from '../../../copy/poolWorkspace.js'

const primaryViews: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting']
const moreViews: readonly SelectedPoolView[] = ['price-oracle', 'staged-operations', 'fork-workflow']

export function PoolWorkspaceNavigation({ view, onChange, panelId }: { view: SelectedPoolView; onChange: (view: SelectedPoolView) => void; panelId: string }) {
	const menu = useRef<HTMLDetailsElement>(null)
	const visibleViews = primaryViews.includes(view) ? primaryViews : [...primaryViews, view]
	return (
		<div className='pool-workspace-navigation'>
			<ViewTabs ariaLabel={securityPoolCopy.selectedPoolViews} className='selected-pool-workspace-tabs' semantics='tabs' size='compact' value={view} onChange={onChange} options={visibleViews.map(value => ({ id: `selected-pool-view-${value}`, label: getSelectedPoolViewLabel(value), panelId, value }))} />
			<details
				className='pool-tools-disclosure'
				ref={menu}
				onKeyDown={event => {
					if (event.key === 'Escape' && menu.current !== null) {
						menu.current.open = false
						menu.current.querySelector('summary')?.focus()
					}
				}}
			>
				<summary>{copy.moreTools}</summary>
				<div className='pool-tools-options'>
					{moreViews.map(value => (
						<button
							key={value}
							type='button'
							className='quiet'
							aria-pressed={value === view}
							onClick={() => {
								onChange(value)
								if (menu.current !== null) {
									menu.current.open = false
									menu.current.querySelector('summary')?.focus()
								}
							}}
						>
							{getSelectedPoolViewLabel(value)}
						</button>
					))}
				</div>
			</details>
		</div>
	)
}

export function PoolAttention({
	oracleUnavailable,
	pendingReportId,
	stagedOperationCount,
	forkAvailable,
	onViewReport,
	onChange,
}: {
	oracleUnavailable: boolean
	pendingReportId: bigint | undefined
	stagedOperationCount: bigint
	forkAvailable: boolean
	onViewReport: (id: bigint) => void
	onChange: (view: SelectedPoolView) => void
}) {
	const hasPendingReport = pendingReportId !== undefined && pendingReportId > 0n
	return (
		<div className='pool-attention' aria-live='polite'>
			{oracleUnavailable ? (
				<p className='pool-attention-item warning'>
					<span>{copy.oracleUnavailable}</span>
					<button type='button' className='link' onClick={() => onChange('price-oracle')}>
						{copy.reviewOracle}
					</button>
				</p>
			) : undefined}
			{hasPendingReport ? (
				<p className='pool-attention-item'>
					<span>{copy.pendingReport}</span>
					<button type='button' className='link' onClick={() => onViewReport(pendingReportId)}>
						{copy.viewReport}
					</button>
				</p>
			) : undefined}
			{stagedOperationCount > 0n ? (
				<p className='pool-attention-item'>
					<span>{copy.stagedOperations(stagedOperationCount)}</span>
					<button type='button' className='link' onClick={() => onChange('staged-operations')}>
						{copy.reviewOperations}
					</button>
				</p>
			) : undefined}
			{forkAvailable ? (
				<p className='pool-attention-item warning'>
					<span>{copy.forkAvailable}</span>
					<button type='button' className='link' onClick={() => onChange('fork-workflow')}>
						{copy.reviewFork}
					</button>
				</p>
			) : undefined}
		</div>
	)
}
