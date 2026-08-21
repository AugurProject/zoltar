import type { ComponentProps } from 'preact'
import { DeploymentRouteContent } from '../../features/deployment/components/DeploymentRouteContent.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OpenOracleSection } from '../../features/open-oracle/components/OpenOracleSection.js'
import { ZoltarSection } from '../../features/zoltarSurface/components/ZoltarSection.js'
import { shouldRenderAppRouteContent } from '@zoltar/ui-core-shared/app/lib/appRouteGate.js'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'zoltar'

type Props = {
	deploy: ComponentProps<typeof DeploymentRouteContent>
	zoltar: ComponentProps<typeof ZoltarSection>
	openOracle: ComponentProps<typeof OpenOracleSection>
	readBackendMessage: string | undefined
	route: AppRoute
}

export function shouldRenderRouteContent({ readBackendMessage, route }: Pick<Props, 'readBackendMessage' | 'route'>) {
	return shouldRenderAppRouteContent(route, readBackendMessage)
}

export function AppRouteContent({ deploy, zoltar, openOracle, readBackendMessage, route }: Props) {
	if (!shouldRenderRouteContent({ readBackendMessage, route })) return null

	switch (route) {
		case 'deploy':
			return <DeploymentRouteContent {...deploy} />
		case 'zoltar':
			return <ZoltarSection {...zoltar} />
		case 'open-oracle':
			return <OpenOracleSection {...openOracle} />
		case 'not-found':
			return <NotFoundSection />
		default:
			return <NotFoundSection />
	}
}
