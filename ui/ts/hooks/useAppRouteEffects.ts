import { useEffect, useRef } from 'preact/hooks'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'security-pools' | 'zoltar'

type Props = {
	augurPlaceHolderDeploymentMissing: boolean
	environmentReady: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	loadSecurityPools: (securityPoolAddress?: string) => Promise<void>
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools' | 'zoltar') => void
	openOracleFormReportId: string
	openOracleReportDetailsReportId: bigint | undefined
	route: AppRoute
	securityPoolAddress: string
	securityPoolResultHash: string | undefined
	selectedPoolSecurityPoolAddress: string | undefined
	setForkAuctionFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setOpenOracleReport: (reportId: string | undefined) => void
	setReportingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityVaultFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setTradingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	tradingResultHash: string | undefined
	urlOpenOracleReportId: string
	walletBootstrapComplete: boolean
}

export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: { environmentReady: boolean; route: AppRoute; urlOpenOracleReportId: string }) {
	return environmentReady && route === 'open-oracle' && urlOpenOracleReportId !== ''
}

export function shouldRefreshSelectedPoolForRoute({
	environmentReady,
	route,
	securityPoolAddress,
	selectedPoolSecurityPoolAddress,
	walletBootstrapComplete,
}: {
	environmentReady: boolean
	route: AppRoute
	securityPoolAddress: string
	selectedPoolSecurityPoolAddress: string | undefined
	walletBootstrapComplete: boolean
}) {
	return environmentReady && route === 'security-pools' && walletBootstrapComplete && securityPoolAddress !== '' && selectedPoolSecurityPoolAddress === undefined
}

export function shouldSyncSecurityPoolAddressToRouteForms({ route, securityPoolAddress }: { route: AppRoute; securityPoolAddress: string }) {
	return route === 'security-pools' && securityPoolAddress !== ''
}

export function useAppRouteEffects({
	augurPlaceHolderDeploymentMissing,
	environmentReady,
	loadOracleReport,
	loadSecurityPools,
	navigate,
	openOracleFormReportId,
	openOracleReportDetailsReportId,
	route,
	securityPoolAddress,
	securityPoolResultHash,
	selectedPoolSecurityPoolAddress,
	setForkAuctionFormSecurityPoolAddress,
	setOpenOracleReport,
	setReportingFormSecurityPoolAddress,
	setSecurityVaultFormSecurityPoolAddress,
	setTradingFormSecurityPoolAddress,
	tradingResultHash,
	urlOpenOracleReportId,
	walletBootstrapComplete,
}: Props) {
	const loadOracleReportRef = useRef(loadOracleReport)
	const loadSecurityPoolsRef = useRef(loadSecurityPools)
	const navigateRef = useRef(navigate)
	const lastRequestedOpenOracleReportId = useRef<string | undefined>(undefined)
	const lastRequestedSecurityPoolAddress = useRef<string | undefined>(undefined)

	loadOracleReportRef.current = loadOracleReport
	loadSecurityPoolsRef.current = loadSecurityPools
	navigateRef.current = navigate

	useEffect(() => {
		const shouldLoadReport = shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId })
		if (!shouldLoadReport) {
			lastRequestedOpenOracleReportId.current = undefined
			return
		}
		if (lastRequestedOpenOracleReportId.current === urlOpenOracleReportId) return
		lastRequestedOpenOracleReportId.current = urlOpenOracleReportId
		void loadOracleReportRef.current(urlOpenOracleReportId)
	}, [environmentReady, route, urlOpenOracleReportId])

	useEffect(() => {
		if (openOracleReportDetailsReportId !== undefined) {
			setOpenOracleReport(openOracleReportDetailsReportId.toString())
			return
		}
		if (openOracleFormReportId.trim() !== '') {
			setOpenOracleReport(openOracleFormReportId)
			return
		}
		setOpenOracleReport(undefined)
	}, [openOracleFormReportId, openOracleReportDetailsReportId, setOpenOracleReport])

	useEffect(() => {
		if (!shouldSyncSecurityPoolAddressToRouteForms({ route, securityPoolAddress })) return
		setSecurityVaultFormSecurityPoolAddress(securityPoolAddress)
		setTradingFormSecurityPoolAddress(securityPoolAddress)
		setForkAuctionFormSecurityPoolAddress(securityPoolAddress)
		setReportingFormSecurityPoolAddress(securityPoolAddress)
	}, [route, securityPoolAddress, setForkAuctionFormSecurityPoolAddress, setReportingFormSecurityPoolAddress, setSecurityVaultFormSecurityPoolAddress, setTradingFormSecurityPoolAddress])

	useEffect(() => {
		if (
			!shouldRefreshSelectedPoolForRoute({
				environmentReady,
				route,
				securityPoolAddress,
				selectedPoolSecurityPoolAddress,
				walletBootstrapComplete,
			})
		) {
			if (route !== 'security-pools' || securityPoolAddress === '' || selectedPoolSecurityPoolAddress !== undefined || !environmentReady || !walletBootstrapComplete) {
				lastRequestedSecurityPoolAddress.current = undefined
			}
			return
		}
		if (lastRequestedSecurityPoolAddress.current === securityPoolAddress) return
		lastRequestedSecurityPoolAddress.current = securityPoolAddress
		void loadSecurityPoolsRef.current(securityPoolAddress)
	}, [environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (securityPoolResultHash === undefined) return
		void loadSecurityPoolsRef.current()
	}, [environmentReady, route, securityPoolResultHash])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (tradingResultHash === undefined) return
		void loadSecurityPoolsRef.current(securityPoolAddress)
	}, [environmentReady, route, securityPoolAddress, tradingResultHash])

	useEffect(() => {
		if (!augurPlaceHolderDeploymentMissing) return
		if (route === 'deploy') return
		navigateRef.current('deploy')
	}, [augurPlaceHolderDeploymentMissing, route])
}
