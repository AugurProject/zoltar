import { useRef } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { getSelectedPoolViewLabel, type SelectedPoolView } from '../lib/securityPoolWorkflow.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as copy from '../../../copy/poolWorkspace.js'

const primaryViews: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting']
const moreViews: readonly SelectedPoolView[] = ['price-oracle', 'staged-operations', 'fork-workflow']

/** Splits the pool tabs: Fork & Migration joins the main tabs once the pool has fork activity or is in a fork stage. */
function getPoolWorkspaceViews(view: SelectedPoolView, forkWorkflowPrimary: boolean) {
	const mainViews = forkWorkflowPrimary ? [...primaryViews, 'fork-workflow' as const] : primaryViews
	return {
		mainViews: mainViews.includes(view) ? mainViews : [...mainViews, view],
		toolViews: moreViews.filter(candidate => !mainViews.includes(candidate)),
	}
}

export function PoolWorkspaceNavigation({ forkWorkflowPrimary = false, view, onChange, panelId }: { forkWorkflowPrimary?: boolean; view: SelectedPoolView; onChange: (view: SelectedPoolView) => void; panelId: string }) {
	const menu = useRef<HTMLDetailsElement>(null)
	const { mainViews, toolViews } = getPoolWorkspaceViews(view, forkWorkflowPrimary)
	return (
		<div className='pool-workspace-navigation'>
			<ViewTabs ariaLabel={securityPoolCopy.selectedPoolViews} className='selected-pool-workspace-tabs' semantics='tabs' size='compact' value={view} onChange={onChange} options={mainViews.map(value => ({ id: `selected-pool-view-${value}`, label: getSelectedPoolViewLabel(value), panelId, value }))} />
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
					{toolViews.map(value => (
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
