import { trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import { createSectionNavigation } from '@zoltar/bot-shared/dashboard/section-navigation'
import { createSettingsNavigation } from '@zoltar/bot-shared/dashboard/settings-navigation'
import { createConfigurationLoader } from './dashboard-configuration.ts'
import { createActivityNavigation } from './activity-navigation.ts'
import { createDashboardControls } from './dashboard-controls.ts'
import { createDashboardElements } from './dashboard-elements.ts'
import { createStateRefresh } from './dashboard-refresh.ts'
import { api } from './dashboard-requests.ts'
import { createSnapshotView } from './dashboard-snapshot-view.ts'
import { createDashboardState } from './dashboard-state.ts'
import { registerConnectivityForm, registerProfileControls } from './network-settings.ts'
import { registerExecutorDeploymentForm, registerPauseControls, registerSignerControls, registerUniverseForm } from './operator-actions.ts'
import { registerFocusedSettingsForms } from './settings-forms.ts'

const stateRefreshMilliseconds = 2_000
const dashboardPaths = new Set(['/overview', '/operations', '/games', '/markets', '/settings'])

const elements = createDashboardElements()
const state = createDashboardState()
const controls = createDashboardControls(state, elements)
const activityNavigation = createActivityNavigation()
// The first snapshot renders only after the state request resolves, by which time this module has created the section navigation.
const view = createSnapshotView({
	state,
	elements,
	controls,
	applyInitialFragment: fragment => {
		activityNavigation.revealFragment(fragment)
		sectionNavigation.syncSectionNavigation()
		sectionNavigation.scrollToSection(fragment)
	},
})
const refresh = createStateRefresh({ state, controls, view })
const configuration = createConfigurationLoader({ state, elements, controls, refresh })
const context = { state, elements, controls, view, configuration, refresh }

view.registerFilters()
registerProfileControls(context)
registerUniverseForm(context)
registerPauseControls(context)
const sectionNavigation = createSectionNavigation(link => dashboardPaths.has(new URL(link.href).pathname))
registerFocusedSettingsForms({ api, refresh, syncControls: controls.syncControls })
// The universe explorer keeps its selection outside form controls, so its signature is the sorted selection.
trackForm('tokens-form', { extra: () => [...state.approvedUniverseIds].sort().join(','), section: 'universes' })
registerConnectivityForm(context)
registerExecutorDeploymentForm(context)
registerSignerControls(context)

createSettingsNavigation()
void refresh()
void configuration.loadCompleteConfiguration()
window.setInterval(() => void refresh(), stateRefreshMilliseconds)
window.setInterval(() => {
	if (state.connected && state.latestSnapshot !== undefined) view.renderPollRetry(state.latestSnapshot)
}, 1_000)
window.setInterval(() => view.renderBlockStatus(), 1_000)
