import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, deployRoute, forkAuctionRoute, marketRoute, openOracleRoute, reportingRoute, securityPoolRoute, securityPoolsOverviewRoute, securityVaultRoute, tradingRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav className="tab-nav" aria-label="Application sections">
			<a className={`tab-link ${ route === 'deploy' ? 'active' : '' }`} href={deployRoute} onClick={() => onRouteChange('deploy')}>
				Contract Deployment
			</a>
			<a className={`tab-link ${ route === 'markets' ? 'active' : '' }`} href={marketRoute} onClick={() => onRouteChange('markets')}>
				Market Creation
			</a>
			<a className={`tab-link ${ route === 'security-pools' ? 'active' : '' }`} href={securityPoolRoute} onClick={() => onRouteChange('security-pools')}>
				Security Pool Creation
			</a>
			<a className={`tab-link ${ route === 'security-pools-overview' ? 'active' : '' }`} href={securityPoolsOverviewRoute} onClick={() => onRouteChange('security-pools-overview')}>
				Security Pools Overview
			</a>
			<a className={`tab-link ${ route === 'security-vaults' ? 'active' : '' }`} href={securityVaultRoute} onClick={() => onRouteChange('security-vaults')}>
				Security Vault
			</a>
			<a className={`tab-link ${ route === 'open-oracle' ? 'active' : '' }`} href={openOracleRoute} onClick={() => onRouteChange('open-oracle')}>
				Open Oracle
			</a>
			<a className={`tab-link ${ route === 'reporting' ? 'active' : '' }`} href={reportingRoute} onClick={() => onRouteChange('reporting')}>
				Reporting & Escalation
			</a>
			<a className={`tab-link ${ route === 'fork-auctions' ? 'active' : '' }`} href={forkAuctionRoute} onClick={() => onRouteChange('fork-auctions')}>
				Fork & Truth Auction
			</a>
			<a className={`tab-link ${ route === 'trading' ? 'active' : '' }`} href={tradingRoute} onClick={() => onRouteChange('trading')}>
				Trading
			</a>
		</nav>
	)
}
