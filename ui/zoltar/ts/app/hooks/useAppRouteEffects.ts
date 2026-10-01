import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'

type Props = {
	applicationDeploymentMissing: boolean
	navigate: (route: Exclude<Route, 'not-found'>) => void
	route: Route
}

export function useAppRouteEffects({ applicationDeploymentMissing, navigate, route }: Props) {
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
}
