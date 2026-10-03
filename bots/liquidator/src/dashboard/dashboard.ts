import { trackForm } from '@zoltar/bot-shared/dashboard/form-state'
import { createSectionNavigation } from '@zoltar/bot-shared/dashboard/section-navigation'
import { createSettingsNavigation } from '@zoltar/bot-shared/dashboard/settings-navigation'
import { createConfigurationLoader, TRACKED_FORMS } from './dashboard-configuration.ts'
import { createMutationControls } from './dashboard-controls.ts'
import { createDashboardElements } from './dashboard-elements.ts'
import { createHeaderView } from './dashboard-header-view.ts'
import { createStateRefresh } from './dashboard-refresh.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import { createSnapshotView } from './dashboard-snapshot-view.ts'
import { createDashboardState } from './dashboard-state.ts'
import { registerGoLiveForms } from './go-live-forms.ts'
import { clearMarketSourceProbe, registerMarketSettings } from './market-settings.ts'
import { registerNetworkSettings } from './network-settings.ts'
import { registerPauseControls } from './pause-controls.ts'
import { createPoolSelection } from './pool-selection.ts'
import { registerRecoveryRecheck } from './recovery-panel.ts'
import { registerStrategyForm, registerStrategyPreview } from './strategy-form.ts'

const stateRefreshMilliseconds = 3_000

const elements = createDashboardElements()
const state = createDashboardState()

// The collaborators below call back into `configuration`, `controls`, `refresh`, `sectionNavigation`, `networkSettings`, and `goLiveForms` only from
// user events, timers, and request completions, which cannot run before this module finishes wiring the page.
const pools = createPoolSelection({
	state,
	elements,
	populateConfiguration: value => configuration.populateConfiguration(value),
	syncControls: () => controls.syncControls(),
})
const controls = createMutationControls({ state, elements, pools, goLiveForms: () => goLiveForms })
const header = createHeaderView(state, elements)
const view = createSnapshotView({
	state,
	elements,
	controls,
	header,
	refresh: () => refresh(),
	applyInitialFragment: fragment => {
		sectionNavigation.syncSectionNavigation()
		sectionNavigation.scrollToSection(fragment)
	},
})
const configuration = createConfigurationLoader({
	state,
	elements,
	controls,
	header,
	view,
	goLiveForms: () => goLiveForms,
	syncSectionNavigation: scrollToTarget => sectionNavigation.syncSectionNavigation(scrollToTarget),
})
const { populateConfiguration, loadConfiguration } = configuration
const refresh = createStateRefresh({ state, view, loadConfiguration, settleStalledProfileSwitch: () => networkSettings.settleStalledProfileSwitch() })

view.registerActivityFilter()
const networkSettings = registerNetworkSettings({ state, elements, controls, configuration, refresh, clearMarketSourceProbe: () => clearMarketSourceProbe(state, elements) })
registerMarketSettings({ state, elements, controls, populateConfiguration })
registerRecoveryRecheck({ elements, controls, refresh })
registerPauseControls({ state, elements, controls, refresh })
registerStrategyPreview(elements)

const sectionNavigation = createSectionNavigation()
for (const formId of TRACKED_FORMS) trackForm(formId)
createSettingsNavigation()
const goLiveForms = registerGoLiveForms({ actionStatus, configuration: () => state.configuration, populateConfiguration, put, refresh: () => refresh(), reloadConfiguration: () => loadConfiguration(), syncControls: controls.syncControls })
registerStrategyForm({ state, elements, populateConfiguration, syncControls: controls.syncControls })

void loadConfiguration()
void refresh()
setInterval(refresh, stateRefreshMilliseconds)
setInterval(() => view.renderBlockStatus(), 1_000)
