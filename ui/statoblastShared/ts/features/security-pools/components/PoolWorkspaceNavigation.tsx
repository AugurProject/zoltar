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

type PoolOracleStatus = {
	currentTimestamp: bigint | undefined
	lastPrice: bigint | undefined
	lastSettlementTimestamp: bigint
	pendingReportId?: bigint | undefined
	pendingReportReadyAtTimestamp?: bigint | undefined
	priceValidUntilTimestamp?: bigint | undefined
	requestDisabledReason: string | undefined
	requestPending: boolean
}

function PoolOracleStatusRow({ needsPrice, oracle, onRequestPrice, onViewReport }: { needsPrice: boolean; oracle: PoolOracleStatus; onRequestPrice: () => void; onViewReport: (id: bigint) => void }) {
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

export function PoolAttention({
	needsPrice,
	oracle,
	stagedOperationCount,
	forkAvailable,
	onRequestPrice,
	onViewReport,
	onChange,
}: {
	/** True when the pool needs a fresh price that a new request can supply. */
	needsPrice: boolean
	oracle: PoolOracleStatus | undefined
	stagedOperationCount: bigint
	forkAvailable: boolean
	onRequestPrice: () => void
	onViewReport: (id: bigint) => void
	onChange: (view: SelectedPoolView) => void
}) {
	return (
		<div className='pool-attention'>
			{/* The price row ticks down every second, so it stays outside the live region that announces new exceptions. */}
			{oracle === undefined ? undefined : <PoolOracleStatusRow needsPrice={needsPrice} oracle={oracle} onRequestPrice={onRequestPrice} onViewReport={onViewReport} />}
			<div className='pool-attention-alerts' aria-live='polite'>
				{stagedOperationCount > 0n ? (
					<p className='pool-attention-item'>
						<span>{copy.stagedOperationCount(stagedOperationCount)}</span>
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
		</div>
	)
}
