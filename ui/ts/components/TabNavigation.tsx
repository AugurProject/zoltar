import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, deployRoute, marketRoute, onRouteChange }: TabNavigationProps) {
	return (
		<nav class="tab-nav" aria-label="Application sections">
			<a class={`tab-link ${ route === 'deploy' ? 'active' : '' }`} href={deployRoute} onClick={() => onRouteChange('deploy')}>
				Contract Deployment
			</a>
			<a class={`tab-link ${ route === 'markets' ? 'active' : '' }`} href={marketRoute} onClick={() => onRouteChange('markets')}>
				Market Creation
			</a>
		</nav>
	)
}
