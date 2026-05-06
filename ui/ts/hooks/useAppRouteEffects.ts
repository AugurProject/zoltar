import { useEffect } from 'preact/hooks'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'security-pools' | 'zoltar'

type Props = {
	augurPlaceHolderDeploymentMissing: boolean
	environmentReady: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	loadSecurityPools: (securityPoolAddress?: string) => Promise<void>
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools' | 'zoltar') => void
	openOracleFormReportId: string
	openOracleReportDetailsReportId: bigint | undefined
	refreshSelectedPoolData: () => void
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

export function shouldRefreshSelectedPoolForRoute({ environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete }: { environmentReady: boolean; route: AppRoute; securityPoolAddress: string; selectedPoolSecurityPoolAddress: string | undefined; walletBootstrapComplete: boolean }) {
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
	refreshSelectedPoolData,
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
	useEffect(() => {
		if (!shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId })) return
		void loadOracleReport(urlOpenOracleReportId)
	}, [environmentReady, loadOracleReport, route, urlOpenOracleReportId])

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
			return
		}
		refreshSelectedPoolData()
	}, [environmentReady, refreshSelectedPoolData, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (securityPoolResultHash === undefined) return
		void loadSecurityPools()
	}, [environmentReady, loadSecurityPools, route, securityPoolResultHash])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (tradingResultHash === undefined) return
		refreshSelectedPoolData()
	}, [environmentReady, refreshSelectedPoolData, route, tradingResultHash])

	useEffect(() => {
		if (!augurPlaceHolderDeploymentMissing) return
		if (route === 'deploy') return
		navigate('deploy')
	}, [augurPlaceHolderDeploymentMissing, navigate, route])
}
