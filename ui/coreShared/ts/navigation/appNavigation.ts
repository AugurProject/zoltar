import * as appCopy from '../copy/app.js'
import type { RouteTabDefinition, ViewTabOption } from '../types/components.js'

/** Secondary views of one primary route, rendered as the second tab tier under the primary tabs. */
export type SecondaryNavigation = {
	ariaLabel: string
	onChange: (value: string) => void
	options: ViewTabOption<string>[]
	value: string
}

/** Builds a typed secondary navigation whose change handler only forwards values that exist in its options. */
export function createSecondaryNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: { ariaLabel: string; onChange: (value: TValue) => void; options: ViewTabOption<TValue>[]; value: TValue }): SecondaryNavigation {
	return {
		ariaLabel,
		onChange: nextValue => {
			const option = options.find(candidate => candidate.value === nextValue)
			if (option === undefined) return
			onChange(option.value)
		},
		options,
		value,
	}
}

/** Returns the secondary navigation that belongs to the current route, or nothing for unknown routes and routes without views. */
export function resolveSecondaryNavigation({ route, secondaryByRoute }: { route: string; secondaryByRoute: Readonly<Partial<Record<string, SecondaryNavigation>>> }) {
	if (route === 'not-found') return undefined
	return secondaryByRoute[route]
}

/**
 * The deployment tab is a prerequisite flow, not a permanent section: it is listed while deployment is incomplete
 * and while the user is on the deployment route, so the tab strip never loses the current location. While required
 * contracts are missing (`deploymentMissing`), every other section is unavailable, so its tab stays listed but disabled
 * with the reason; a tab already disabled keeps its own reason.
 */
export function withDeploymentTab({ deploymentMissing = false, deploymentTab, deploymentIncomplete, route, tabs }: { deploymentMissing?: boolean; deploymentTab: RouteTabDefinition; deploymentIncomplete: boolean; route: string; tabs: readonly RouteTabDefinition[] }): RouteTabDefinition[] {
	const sectionTabs = deploymentMissing ? tabs.map(tab => (tab.disabled === true ? tab : { ...tab, disabled: true, disabledReason: appCopy.sectionRequiresDeployment })) : [...tabs]
	if (!deploymentIncomplete && !deploymentMissing && route !== deploymentTab.route) return sectionTabs
	return [deploymentTab, ...sectionTabs]
}
