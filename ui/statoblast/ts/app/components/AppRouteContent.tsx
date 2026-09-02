import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar/features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OpenOracleSection } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOracleSection.js'
import { SecurityPoolsSection } from '../../features/security-pools/components/SecurityPoolsSection.js'
import type { Route } from '../../types/app.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../copy/app.js'

export const STATOBLAST_NOT_FOUND_LINKS = [
	{ href: '#/deploy', label: commonCopy.deploy },
	{ href: '#/security-pools', label: commonCopy.securityPools },
	{ href: '#/security-pools?securityPoolsView=universes', label: commonCopy.universe },
	{ href: '#/open-oracle', label: statoblastAppCopy.openOracle },
] as const

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	openOracle: ComponentProps<typeof OpenOracleSection>
	readBackendMessage: string | undefined
	route: Route
	securityPools: ComponentProps<typeof SecurityPoolsSection>
}

function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
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
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
		default:
			return <NotFoundSection links={STATOBLAST_NOT_FOUND_LINKS} />
	}
}
