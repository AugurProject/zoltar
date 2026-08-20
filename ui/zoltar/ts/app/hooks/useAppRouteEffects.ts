import { useEffect, useRef } from 'preact/hooks'

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

export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: { environmentReady: boolean; route: AppRoute; urlOpenOracleReportId: string }) {
	return environmentReady && route === 'open-oracle' && urlOpenOracleReportId !== ''
}

export function useAppRouteEffects({ applicationDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, navigate, route, setOpenOracleFormReportId, urlOpenOracleReportId }: Props) {
	const loadOracleReportRef = useRef(loadOracleReport)
	const navigateRef = useRef(navigate)
	const lastRequestedOpenOracleReportId = useRef<string | undefined>(undefined)
	const lastSyncedOpenOracleReportId = useRef<string | undefined>(undefined)

	loadOracleReportRef.current = loadOracleReport
	navigateRef.current = navigate

	useEffect(() => {
		if (route !== 'open-oracle') {
			lastSyncedOpenOracleReportId.current = undefined
			return
		}
		const normalizedReportId = urlOpenOracleReportId.trim()
		if (lastSyncedOpenOracleReportId.current === normalizedReportId) return
		lastSyncedOpenOracleReportId.current = normalizedReportId
		setOpenOracleFormReportId(normalizedReportId)
	}, [route, setOpenOracleFormReportId, urlOpenOracleReportId])

	useEffect(() => {
		const shouldLoadReport = shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId })
		if (!shouldLoadReport) {
			lastRequestedOpenOracleReportId.current = undefined
			return
		}
		const requestKey = `${activeEnvironmentNonce}:${urlOpenOracleReportId}`
		if (lastRequestedOpenOracleReportId.current === requestKey) return
		lastRequestedOpenOracleReportId.current = requestKey
		void loadOracleReportRef.current(urlOpenOracleReportId)
	}, [activeEnvironmentNonce, environmentReady, route, urlOpenOracleReportId])

	useEffect(() => {
		if (!applicationDeploymentMissing) return
		if (route === 'deploy') return
		navigateRef.current('deploy')
	}, [applicationDeploymentMissing, route])
}
