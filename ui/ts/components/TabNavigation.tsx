import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav className="tab-nav" aria-label="Application sections">
			{showDeployTab ? (
				<a className={`tab-link ${ route === 'deploy' ? 'active' : '' }`} href={deployRoute} onClick={() => onRouteChange('deploy')}>
					Deploy
				</a>
			) : undefined}
			<a className={`tab-link ${ route === 'zoltar' ? 'active' : '' }`} href={marketRoute} onClick={() => onRouteChange('zoltar')}>
				Zoltar
			</a>
			<a className={`tab-link ${ route === 'security-pools' ? 'active' : '' }`} href={securityPoolsRoute} onClick={() => onRouteChange('security-pools')}>
				Security Pools
			</a>
			<a className={`tab-link ${ route === 'open-oracle' ? 'active' : '' }`} href={openOracleRoute} onClick={() => onRouteChange('open-oracle')}>
				Open Oracle
			</a>
		</nav>
	)
}
