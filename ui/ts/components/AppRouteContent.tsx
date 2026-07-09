import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from './DeploymentRouteContent.js'
import { MarketSection } from './MarketSection.js'
import { NotFoundSection } from './NotFoundSection.js'
import { OpenOracleSection } from './OpenOracleSection.js'
import { SecurityPoolsSection } from './SecurityPoolsSection.js'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'security-pools' | 'zoltar'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	market: ComponentProps<typeof MarketSection>
	openOracle: ComponentProps<typeof OpenOracleSection>
	readBackendMessage: string | undefined
	route: AppRoute
	securityPools: ComponentProps<typeof SecurityPoolsSection>
}

export function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	if (route !== 'deploy' && readBackendMessage !== undefined) return false
	return true
}

export function AppRouteContent({ deploy, market, openOracle, readBackendMessage, route, securityPools }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'zoltar':
			return <MarketSection {...market} />
		case 'security-pools':
			return <SecurityPoolsSection {...securityPools} />
		case 'open-oracle':
			return <OpenOracleSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection />
		default:
			return <NotFoundSection />
	}
}
