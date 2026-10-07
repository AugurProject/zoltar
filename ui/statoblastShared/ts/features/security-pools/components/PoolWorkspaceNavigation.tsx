import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { useDisclosurePopover } from '@zoltar/ui-core-shared/hooks/useDisclosurePopover.js'
import { getSelectedPoolViewLabel, type SelectedPoolView } from '../lib/securityPoolWorkflow.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as copy from '../../../copy/poolWorkspace.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'

const primaryViews: readonly SelectedPoolView[] = ['vaults', 'trading', 'reporting']
const moreViews: readonly SelectedPoolView[] = ['price-oracle', 'staged-operations', 'fork-workflow']

/**
 * Splits the pool tabs: Fork & Migration joins the main tabs once the pool has fork activity or is in a fork stage. The tab set
 * never depends on the open view, so opening a tool never adds a tab or lists one view twice.
 */
function getPoolWorkspaceViews(forkWorkflowPrimary: boolean) {
	const mainViews = forkWorkflowPrimary ? [...primaryViews, 'fork-workflow' as const] : primaryViews
	return { mainViews, toolViews: moreViews.filter(candidate => !mainViews.includes(candidate)) }
}

/**
 * Secondary pool tools in a popover anchored to a tab-styled trigger, so opening it never pushes the workspace down. While a tool
 * is open the trigger is the selected tab: it carries the active styling, names the tool, and labels the open panel.
 */
function PoolToolsMenu({ onChange, toolViews, view }: { onChange: (view: SelectedPoolView) => void; toolViews: readonly SelectedPoolView[]; view: SelectedPoolView }) {
	const popover = useDisclosurePopover()
	if (toolViews.length === 0) return undefined
	const activeToolView = toolViews.includes(view) ? view : undefined
	const triggerLabel = activeToolView === undefined ? copy.moreTools : copy.formatMoreToolsActive(getSelectedPoolViewLabel(activeToolView))
	return (
		<div className='pool-tools-menu' ref={popover.containerRef}>
			<button {...popover.triggerProps} id={activeToolView === undefined ? undefined : `selected-pool-view-${activeToolView}`} aria-label={triggerLabel} className={activeToolView === undefined ? 'view-tab pool-tools-trigger' : 'view-tab pool-tools-trigger active'} onClick={popover.toggle}>
				{/* Phones show the short label so the three pool tabs and the trigger fit on one row. */}
				<span className='pool-tools-label-long'>{triggerLabel}</span>
				<span className='pool-tools-label-short'>{copy.moreToolsShort}</span>
				<span className='pool-tools-caret' aria-hidden='true' />
			</button>
			{popover.open ? (
				<ul className='pool-tools-options' id={popover.panelId}>
					{toolViews.map(value => (
						<li key={value}>
							<button
								type='button'
								className={value === view ? 'active' : undefined}
								aria-current={value === view ? 'true' : undefined}
								onClick={() => {
									onChange(value)
									popover.close()
									popover.triggerRef.current?.focus()
								}}
							>
								{getSelectedPoolViewLabel(value)}
							</button>
						</li>
					))}
				</ul>
			) : undefined}
		</div>
	)
}

export function PoolWorkspaceNavigation({ forkWorkflowPrimary = false, view, onChange, panelId }: { forkWorkflowPrimary?: boolean; view: SelectedPoolView; onChange: (view: SelectedPoolView) => void; panelId: string }) {
	const { mainViews, toolViews } = getPoolWorkspaceViews(forkWorkflowPrimary)
	return (
		<div className='pool-workspace-navigation'>
			<ViewTabs ariaLabel={securityPoolCopy.selectedPoolViews} className='selected-pool-workspace-tabs' semantics='tabs' size='compact' value={view} onChange={onChange} options={mainViews.map(value => ({ id: `selected-pool-view-${value}`, label: getSelectedPoolViewLabel(value), panelId, value }))} />
			<PoolToolsMenu onChange={onChange} toolViews={toolViews} view={view} />
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
	/** The wallet prerequisite, when it is the request's disabled reason. */
	requestWalletBlocker?: WalletActionBlocker | undefined
}

/** The pool's OpenOracle price with its validity or pending countdown, and the one action that moves it forward: view the pending report or request a new price. */
export function PoolOracleStatusRow({ needsPrice, oracle, onRequestPrice, onViewReport }: { needsPrice: boolean; oracle: PoolOracleStatus; onRequestPrice: () => void; onViewReport: (id: bigint) => void }) {
	const pendingReportId = oracle.pendingReportId !== undefined && oracle.pendingReportId > 0n ? oracle.pendingReportId : undefined
	let action = undefined
	if (pendingReportId !== undefined)
		action = (
			<button type='button' className='secondary' onClick={() => onViewReport(pendingReportId)}>
				{coreAppCopy.viewReport}
			</button>
		)
	// This opens the request review; the dialog's own button sends the request, so the launcher carries the launch ellipsis.
	else if (needsPrice)
		action = (
			<ActionLauncherButton
				idleLabel={commonCopy.launchAction(securityPoolCopy.requestNewPrice)}
				pendingLabel={securityPoolCopy.requestingNewPrice}
				onClick={onRequestPrice}
				pending={oracle.requestPending}
				tone='secondary'
				availability={withWalletBlocker({ disabled: oracle.requestDisabledReason !== undefined, reason: oracle.requestDisabledReason }, oracle.requestWalletBlocker)}
			/>
		)
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
