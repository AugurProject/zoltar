import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, deployRoute, forkAuctionRoute, marketRoute, openOracleRoute, reportingRoute, securityPoolRoute, securityPoolsOverviewRoute, securityVaultRoute, tradingRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav className="tab-nav" aria-label="Application sections">
			<a className={`tab-link ${ route === 'deploy' ? 'active' : '' }`} href={deployRoute} onClick={() => onRouteChange('deploy')}>
				Deploy
			</a>
			<a className={`tab-link ${ route === 'markets' ? 'active' : '' }`} href={marketRoute} onClick={() => onRouteChange('markets')}>
				Markets
			</a>
			<a className={`tab-link ${ route === 'security-pools' ? 'active' : '' }`} href={securityPoolRoute} onClick={() => onRouteChange('security-pools')}>
				Pools
			</a>
			<a className={`tab-link ${ route === 'security-pools-overview' ? 'active' : '' }`} href={securityPoolsOverviewRoute} onClick={() => onRouteChange('security-pools-overview')}>
				Pools Overview
			</a>
			<a className={`tab-link ${ route === 'security-vaults' ? 'active' : '' }`} href={securityVaultRoute} onClick={() => onRouteChange('security-vaults')}>
				Vault
			</a>
			<a className={`tab-link ${ route === 'open-oracle' ? 'active' : '' }`} href={openOracleRoute} onClick={() => onRouteChange('open-oracle')}>
				Open Oracle
			</a>
			<a className={`tab-link ${ route === 'reporting' ? 'active' : '' }`} href={reportingRoute} onClick={() => onRouteChange('reporting')}>
				Reporting
			</a>
			<a className={`tab-link ${ route === 'fork-auctions' ? 'active' : '' }`} href={forkAuctionRoute} onClick={() => onRouteChange('fork-auctions')}>
				Fork Auctions
			</a>
			<a className={`tab-link ${ route === 'trading' ? 'active' : '' }`} href={tradingRoute} onClick={() => onRouteChange('trading')}>
				Trading
			</a>
		</nav>
	)
}
