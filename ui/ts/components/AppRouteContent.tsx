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
	route: AppRoute
	securityPools: ComponentProps<typeof SecurityPoolsSection>
	wrongNetworkMessage: string | undefined
}

export function AppRouteContent({ deploy, market, openOracle, route, securityPools, wrongNetworkMessage }: Props) {
	if (wrongNetworkMessage !== undefined) return null

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
