import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, deployRoute, marketRoute, openOracleRoute, reportingRoute, securityPoolRoute, securityPoolsOverviewRoute, securityVaultRoute, tradingRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav class="tab-nav" aria-label="Application sections">
			<a class={`tab-link ${ route === 'deploy' ? 'active' : '' }`} href={deployRoute} onClick={() => onRouteChange('deploy')}>
				Contract Deployment
			</a>
			<a class={`tab-link ${ route === 'markets' ? 'active' : '' }`} href={marketRoute} onClick={() => onRouteChange('markets')}>
				Market Creation
			</a>
			<a class={`tab-link ${ route === 'security-pools' ? 'active' : '' }`} href={securityPoolRoute} onClick={() => onRouteChange('security-pools')}>
				Security Pool Creation
			</a>
			<a class={`tab-link ${ route === 'security-pools-overview' ? 'active' : '' }`} href={securityPoolsOverviewRoute} onClick={() => onRouteChange('security-pools-overview')}>
				Security Pools Overview
			</a>
			<a class={`tab-link ${ route === 'security-vaults' ? 'active' : '' }`} href={securityVaultRoute} onClick={() => onRouteChange('security-vaults')}>
				Security Vault
			</a>
			<a class={`tab-link ${ route === 'open-oracle' ? 'active' : '' }`} href={openOracleRoute} onClick={() => onRouteChange('open-oracle')}>
				Open Oracle
			</a>
			<a class={`tab-link ${ route === 'reporting' ? 'active' : '' }`} href={reportingRoute} onClick={() => onRouteChange('reporting')}>
				Reporting & Escalation
			</a>
			<a class={`tab-link ${ route === 'trading' ? 'active' : '' }`} href={tradingRoute} onClick={() => onRouteChange('trading')}>
				Trading
			</a>
		</nav>
	)
}
