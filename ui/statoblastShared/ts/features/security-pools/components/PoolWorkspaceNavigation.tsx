import { useRef } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { getSelectedPoolViewLabel, type SelectedPoolView } from '../lib/securityPoolWorkflow.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'

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

export type PoolOracleStatus = {
	currentTimestamp: bigint | undefined
	lastPrice: bigint | undefined
	lastSettlementTimestamp: bigint
	pendingReportId?: bigint | undefined
	pendingReportReadyAtTimestamp?: bigint | undefined
	priceValidUntilTimestamp?: bigint | undefined
	requestDisabledReason: string | undefined
	requestPending: boolean
}

/** The pool's Open Oracle price with its validity or pending countdown, and the one action that moves it forward: view the pending report or request a new price. */
export function PoolOracleStatusRow({ needsPrice, oracle, onRequestPrice, onViewReport }: { needsPrice: boolean; oracle: PoolOracleStatus; onRequestPrice: () => void; onViewReport: (id: bigint) => void }) {
	const pendingReportId = oracle.pendingReportId !== undefined && oracle.pendingReportId > 0n ? oracle.pendingReportId : undefined
	let action = undefined
	if (pendingReportId !== undefined)
		action = (
			<button type='button' className='secondary' onClick={() => onViewReport(pendingReportId)}>
				{copy.viewReport}
			</button>
		)
	else if (needsPrice)
		action = <TransactionActionButton idleLabel={securityPoolCopy.requestNewPrice} pendingLabel={securityPoolCopy.requestingNewPrice} onClick={onRequestPrice} pending={oracle.requestPending} tone='secondary' availability={{ disabled: oracle.requestDisabledReason !== undefined, reason: oracle.requestDisabledReason }} />
	return (
		<div className={`pool-attention-item pool-oracle-status${needsPrice && pendingReportId === undefined ? ' warning' : ''}`}>
			<div className='pool-oracle-status-value'>
				<span className='pool-oracle-status-label'>{statoblastAppCopy.openOraclePrice}</span>
				<OpenOraclePriceValue
					currentTimestamp={oracle.currentTimestamp}
					lastPrice={oracle.lastPrice}
					lastSettlementTimestamp={oracle.lastSettlementTimestamp}
					pendingReportReadyAtTimestamp={pendingReportId === undefined ? undefined : oracle.pendingReportReadyAtTimestamp}
					priceValidUntilTimestamp={oracle.priceValidUntilTimestamp}
				/>
			</div>
			{action}
		</div>
	)
}
