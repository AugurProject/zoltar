import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import { useOpenOracleRouteSync } from '../../features/open-oracle/hooks/useOpenOracleRouteSync.js'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'zoltar'

type Props = {
	applicationDeploymentMissing: boolean
	activeEnvironmentNonce: number
	environmentReady: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	navigate: (route: 'deploy' | 'open-oracle' | 'zoltar') => void
	route: AppRoute
	setOpenOracleFormReportId: (reportId: string) => void
	urlOpenOracleReportId: string
}

export function useAppRouteEffects({ applicationDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, navigate, route, setOpenOracleFormReportId, urlOpenOracleReportId }: Props) {
	useOpenOracleRouteSync({ activeEnvironmentNonce, environmentReady, isOpenOracleRoute: route === 'open-oracle', loadOracleReport, reportId: urlOpenOracleReportId, setOpenOracleFormReportId })
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
}
