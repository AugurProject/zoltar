import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
type AppRoute = 'deploy' | 'not-found' | 'zoltar'

type Props = {
	applicationDeploymentMissing: boolean
	navigate: (route: 'deploy' | 'zoltar') => void
	route: AppRoute
}

export function useAppRouteEffects({ applicationDeploymentMissing, navigate, route }: Props) {
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
}
