import { useEffect } from 'preact/hooks'

type Props = {
	augurPlaceHolderDeploymentMissing: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	loadSecurityPools: (securityPoolAddress?: string) => Promise<void>
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools' | 'zoltar') => void
	openOracleFormReportId: string
	openOracleReportDetailsReportId: bigint | undefined
	refreshSelectedPoolData: () => void
	route: 'deploy' | 'not-found' | 'open-oracle' | 'security-pools' | 'zoltar'
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

export function useAppRouteEffects({
	augurPlaceHolderDeploymentMissing,
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
		if (urlOpenOracleReportId === '') return
		void loadOracleReport(urlOpenOracleReportId)
	}, [loadOracleReport, urlOpenOracleReportId])

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
		setSecurityVaultFormSecurityPoolAddress(securityPoolAddress)
		setTradingFormSecurityPoolAddress(securityPoolAddress)
		setForkAuctionFormSecurityPoolAddress(securityPoolAddress)
		setReportingFormSecurityPoolAddress(securityPoolAddress)
	}, [securityPoolAddress, setForkAuctionFormSecurityPoolAddress, setReportingFormSecurityPoolAddress, setSecurityVaultFormSecurityPoolAddress, setTradingFormSecurityPoolAddress])

	useEffect(() => {
		if (selectedPoolSecurityPoolAddress !== undefined) return
		refreshSelectedPoolData()
	}, [refreshSelectedPoolData, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (securityPoolResultHash === undefined) return
		void loadSecurityPools()
	}, [loadSecurityPools, securityPoolResultHash])

	useEffect(() => {
		if (tradingResultHash === undefined) return
		refreshSelectedPoolData()
	}, [refreshSelectedPoolData, tradingResultHash])

	useEffect(() => {
		if (!augurPlaceHolderDeploymentMissing) return
		if (route === 'deploy') return
		navigate('deploy')
	}, [augurPlaceHolderDeploymentMissing, navigate, route])
}
