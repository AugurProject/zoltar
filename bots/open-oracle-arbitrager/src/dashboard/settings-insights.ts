import type { PublicOperatorSnapshot } from '#state/operator-state'
import { exactAmount } from './dashboard-format.js'
import { setText } from './dom.js'
import { setQueuedSections } from './form-state.ts'
import { renderGoLive } from './go-live.ts'
import { goLiveConfiguration, savedSettlementEnabled } from './settings-forms.ts'

/** The running settlement state, or the saved-but-unapplied one while a change waits for the scan boundary. */
function settlementPanelSummary(snapshot: PublicOperatorSnapshot) {
	const awaiting = snapshot.settlements.queue.length
	const queue = `${awaiting.toString()} report${awaiting === 1 ? '' : 's'} awaiting settlement`
	if (snapshot.queuedSettings.includes('settlement')) return `${savedSettlementEnabled ? 'Enabling' : 'Disabling'} at the next scan · ${queue}`
	return `${snapshot.settlements.settings.enabled ? 'Enabled' : 'Disabled'} · ${queue}`
}

/** Settings panels that read the live snapshot: risk usage beside the caps, the settlement queue, and the go-live checklist. */
export function renderSettingsInsights(snapshot: PublicOperatorSnapshot) {
	setText('usage-locked', `${exactAmount(snapshot.risk.usage.lockedWeth, 'WETH')} / ${exactAmount(snapshot.risk.limits.maxTotalLockedWeth, 'WETH')}`)
	setText('usage-positions', `${snapshot.risk.usage.openPositions.toString()} / ${snapshot.risk.limits.maxConcurrentPositions.toString()}`)
	setText('usage-daily-gas', `${exactAmount(snapshot.risk.usage.dailyGasSpentWeth, 'ETH')} / ${exactAmount(snapshot.risk.limits.maxDailyGasSpendWeth, 'ETH')}`)
	setText('settlement-panel-summary', settlementPanelSummary(snapshot))
	setQueuedSections(snapshot.queuedSettings)
	const configuration = goLiveConfiguration()
	if (configuration !== undefined) renderGoLive(snapshot, configuration)
}
