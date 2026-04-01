import type { TabNavigationProps } from '../types/components.js'

function renderTabLink(route: Exclude<TabNavigationProps['route'], 'not-found'>, label: string, href: string, activeRoute: TabNavigationProps['route'], disabled: boolean, onRouteChange: TabNavigationProps['onRouteChange']) {
	const isActive = activeRoute === route

	return (
		<a
			className={`tab-link ${ isActive ? 'active' : '' }${ disabled ? ' disabled' : '' }`}
			href={href}
			aria-disabled={disabled ? 'true' : undefined}
			tabIndex={disabled ? -1 : undefined}
			title={disabled ? 'Deploy Augur PLACEHOLDER contracts before using this tab' : undefined}
			onClick={event => {
				event.preventDefault()
				if (disabled) return
				onRouteChange(route)
			}}
		>
			{label}
		</a>
	)
}

export function TabNavigation({ route, showDeployTab = true, augurPlaceHolderDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav className="tab-nav" aria-label="Application sections">
			{showDeployTab ? (
				<a
					className={`tab-link ${ route === 'deploy' ? 'active' : '' }`}
					href={deployRoute}
					onClick={event => {
						event.preventDefault()
						onRouteChange('deploy')
					}}
				>
					Deploy
				</a>
			) : undefined}
			{renderTabLink('zoltar', 'Zoltar', marketRoute, route, !augurPlaceHolderDeployed, onRouteChange)}
			{renderTabLink('security-pools', 'Security Pools', securityPoolsRoute, route, !augurPlaceHolderDeployed, onRouteChange)}
			{renderTabLink('open-oracle', 'Open Oracle', openOracleRoute, route, !augurPlaceHolderDeployed, onRouteChange)}
		</nav>
	)
}
