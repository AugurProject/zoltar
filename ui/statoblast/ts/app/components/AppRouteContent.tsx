import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OpenOracleSection } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOracleSection.js'
import { SecurityPoolsSection } from '../../features/security-pools/components/SecurityPoolsSection.js'
import type { Route } from '../../types/app.js'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof OpenOracleSection>
	readBackendMessage: string | undefined
	route: Route
	securityPools: ComponentProps<typeof SecurityPoolsSection>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	if (route !== 'deploy' && readBackendMessage !== undefined) return false
	return true
}

export function AppRouteContent({ deploy, openOracle, readBackendMessage, route, securityPools }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
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
