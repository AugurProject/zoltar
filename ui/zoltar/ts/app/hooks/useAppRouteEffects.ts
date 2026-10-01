import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import type { ZoltarRoute } from '@zoltar/ui-zoltar-shared/types/app.js'

type Props = {
	applicationDeploymentMissing: boolean
	navigate: (route: Exclude<ZoltarRoute, 'not-found'>) => void
	route: ZoltarRoute
}

export function useAppRouteEffects({ applicationDeploymentMissing, navigate, route }: Props) {
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
}
