import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OpenOracleSection } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/OpenOracleSection.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { PortfolioSection } from '@zoltar/ui-statoblast-shared/features/portfolio/components/PortfolioSection.js'
import type { Route } from '@zoltar/ui-statoblast-shared/types/app.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'

const STATOBLAST_NOT_FOUND_LINKS = [
	{ href: '#/portfolio', label: statoblastAppCopy.portfolio },
	{ href: '#/pools', label: statoblastAppCopy.pools },
	{ href: '#/pools/universes', label: commonCopy.universe },
	{ href: '#/open-oracle', label: statoblastAppCopy.openOracle },
	{ href: '#/deploy', label: commonCopy.deploy },
] as const

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof OpenOracleSection>
	portfolio: ComponentProps<typeof PortfolioSection>
	readBackendMessage: string | undefined
	route: Route
	securityPools: ComponentProps<typeof SecurityPoolsSection>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, openOracle, portfolio, readBackendMessage, route, securityPools }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'portfolio':
			return <PortfolioSection {...portfolio} />
		case 'pools':
			return <SecurityPoolsSection {...securityPools} />
		case 'open-oracle':
			return <OpenOracleSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
		default:
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
	}
}
