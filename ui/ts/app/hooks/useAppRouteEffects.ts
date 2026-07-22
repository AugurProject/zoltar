import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { normalizeAddress } from '../../lib/address.js'

type AppRoute = 'deploy' | 'not-found' | 'open-oracle' | 'security-pools' | 'zoltar'

type Props = {
	accountAddress: Address | undefined
	activeZoltarView: 'create' | 'fork' | 'migrate' | 'questions'
	augurStatoblastDeploymentMissing: boolean
	activeEnvironmentNonce: number
	environmentReady: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	loadSecurityPools: (securityPoolAddress?: string) => Promise<boolean | void>
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools' | 'zoltar') => void
	resetSecurityPoolCreation: () => void
	route: AppRoute
	securityPoolAddress: string
	securityPoolQuestionId: string
	securityPoolResultHash: string | undefined
	selectedPoolSecurityPoolAddress: string | undefined
	setForkAuctionFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setOpenOracleFormReportId: (reportId: string) => void
	setReportingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityVaultFormSelectedVaultAddress: (selectedVaultAddress: string) => void
	setSecurityVaultFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityPoolFormMarketId: (marketId: string) => void
	setTradingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	tradingResultHash: string | undefined
	urlOpenOracleReportId: string
	walletBootstrapComplete: boolean
}

export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: { environmentReady: boolean; route: AppRoute; urlOpenOracleReportId: string }) {
	return environmentReady && route === 'open-oracle' && urlOpenOracleReportId !== ''
}

export function shouldLoadMarketSecurityPools({ activeZoltarView, environmentReady, route, walletBootstrapComplete }: { activeZoltarView: Props['activeZoltarView']; environmentReady: boolean; route: AppRoute; walletBootstrapComplete: boolean }) {
	return environmentReady && walletBootstrapComplete && route === 'zoltar' && activeZoltarView === 'questions'
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

export function shouldSyncSecurityPoolAddressToRouteForms({ route }: { route: AppRoute; securityPoolAddress: string }) {
	return route === 'security-pools'
}

export function getSelectedVaultAddressForRoutePoolChange({ accountAddress, lastSecurityPoolAddress, route, securityPoolAddress }: { accountAddress: Address | undefined; lastSecurityPoolAddress: string | undefined; route: AppRoute; securityPoolAddress: string }) {
	if (route !== 'security-pools') return undefined
	const normalizedSecurityPoolAddress = normalizeAddress(securityPoolAddress) ?? ''
	const normalizedLastSecurityPoolAddress = normalizeAddress(lastSecurityPoolAddress)
	if (normalizedSecurityPoolAddress === normalizedLastSecurityPoolAddress) return undefined
	if (normalizedSecurityPoolAddress === '') return ''
	return accountAddress?.toString() ?? ''
}

export function useAppRouteEffects({
	accountAddress,
	activeZoltarView,
	augurStatoblastDeploymentMissing,
	activeEnvironmentNonce,
	environmentReady,
	loadOracleReport,
	loadSecurityPools,
	navigate,
	resetSecurityPoolCreation,
	route,
	securityPoolAddress,
	securityPoolQuestionId,
	securityPoolResultHash,
	selectedPoolSecurityPoolAddress,
	setForkAuctionFormSecurityPoolAddress,
	setOpenOracleFormReportId,
	setReportingFormSecurityPoolAddress,
	setSecurityVaultFormSelectedVaultAddress,
	setSecurityVaultFormSecurityPoolAddress,
	setSecurityPoolFormMarketId,
	setTradingFormSecurityPoolAddress,
	tradingResultHash,
	urlOpenOracleReportId,
	walletBootstrapComplete,
}: Props) {
	const loadOracleReportRef = useRef(loadOracleReport)
	const loadSecurityPoolsRef = useRef(loadSecurityPools)
	const navigateRef = useRef(navigate)
	const lastRequestedOpenOracleReportId = useRef<string | undefined>(undefined)
	const lastRequestedMarketSecurityPools = useRef<string | undefined>(undefined)
	const lastRequestedSecurityPoolAddress = useRef<string | undefined>(undefined)
	const lastSelectedPoolEnvironmentNonce = useRef<number | undefined>(undefined)
	const lastSelectedSecurityPoolAddress = useRef<string | undefined>(undefined)
	const lastSyncedOpenOracleReportId = useRef<string | undefined>(undefined)
	const lastSyncedSecurityPoolQuestionId = useRef<string | undefined>(undefined)

	loadOracleReportRef.current = loadOracleReport
	loadSecurityPoolsRef.current = loadSecurityPools
	navigateRef.current = navigate

	useEffect(() => {
		if (!shouldLoadMarketSecurityPools({ activeZoltarView, environmentReady, route, walletBootstrapComplete })) {
			lastRequestedMarketSecurityPools.current = undefined
			return
		}
		const requestKey = `${activeEnvironmentNonce}:${accountAddress ?? ''}`
		if (lastRequestedMarketSecurityPools.current === requestKey) return
		lastRequestedMarketSecurityPools.current = requestKey
		void loadSecurityPoolsRef.current().then(loaded => {
			if (loaded === false && lastRequestedMarketSecurityPools.current === requestKey) lastRequestedMarketSecurityPools.current = undefined
		})
	}, [accountAddress, activeEnvironmentNonce, activeZoltarView, environmentReady, route, walletBootstrapComplete])

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
		if (route !== 'security-pools') {
			lastSyncedSecurityPoolQuestionId.current = undefined
			return
		}
		if (lastSyncedSecurityPoolQuestionId.current === securityPoolQuestionId) return
		lastSyncedSecurityPoolQuestionId.current = securityPoolQuestionId
		resetSecurityPoolCreation()
		setSecurityPoolFormMarketId(securityPoolQuestionId)
	}, [resetSecurityPoolCreation, route, securityPoolQuestionId, setSecurityPoolFormMarketId])

	useEffect(() => {
		if (!shouldSyncSecurityPoolAddressToRouteForms({ route, securityPoolAddress })) return
		setSecurityVaultFormSecurityPoolAddress(securityPoolAddress)
		setTradingFormSecurityPoolAddress(securityPoolAddress)
		setForkAuctionFormSecurityPoolAddress(securityPoolAddress)
		setReportingFormSecurityPoolAddress(securityPoolAddress)
	}, [route, securityPoolAddress, setForkAuctionFormSecurityPoolAddress, setReportingFormSecurityPoolAddress, setSecurityVaultFormSecurityPoolAddress, setTradingFormSecurityPoolAddress])

	useEffect(() => {
		const nextSelectedVaultAddress = getSelectedVaultAddressForRoutePoolChange({
			accountAddress,
			lastSecurityPoolAddress: lastSelectedSecurityPoolAddress.current,
			route,
			securityPoolAddress,
		})
		if (nextSelectedVaultAddress !== undefined) setSecurityVaultFormSelectedVaultAddress(nextSelectedVaultAddress)
		if (route !== 'security-pools') {
			lastSelectedSecurityPoolAddress.current = undefined
			return
		}
		lastSelectedSecurityPoolAddress.current = normalizeAddress(securityPoolAddress) ?? ''
	}, [accountAddress, route, securityPoolAddress, setSecurityVaultFormSelectedVaultAddress])

	useEffect(() => {
		const previousEnvironmentNonce = lastSelectedPoolEnvironmentNonce.current
		if (previousEnvironmentNonce === undefined) lastSelectedPoolEnvironmentNonce.current = activeEnvironmentNonce
		const selectedPoolEnvironmentChanged = previousEnvironmentNonce !== undefined && previousEnvironmentNonce !== activeEnvironmentNonce
		if (
			!selectedPoolEnvironmentChanged &&
			!shouldRefreshSelectedPoolForRoute({
				environmentReady,
				route,
				securityPoolAddress,
				selectedPoolSecurityPoolAddress,
				walletBootstrapComplete,
			})
		) {
			if (route !== 'security-pools' || securityPoolAddress === '' || selectedPoolSecurityPoolAddress !== undefined || !environmentReady || !walletBootstrapComplete) lastRequestedSecurityPoolAddress.current = undefined
			return
		}
		if (!environmentReady || route !== 'security-pools' || securityPoolAddress === '' || !walletBootstrapComplete) return
		const requestKey = `${activeEnvironmentNonce}:${securityPoolAddress}`
		if (lastRequestedSecurityPoolAddress.current === requestKey) return
		lastRequestedSecurityPoolAddress.current = requestKey
		lastSelectedPoolEnvironmentNonce.current = activeEnvironmentNonce
		void loadSecurityPoolsRef.current(securityPoolAddress)
	}, [activeEnvironmentNonce, environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (securityPoolResultHash === undefined) return
		void loadSecurityPoolsRef.current(securityPoolAddress === '' ? undefined : securityPoolAddress)
	}, [environmentReady, route, securityPoolAddress, securityPoolResultHash])

	useEffect(() => {
		if (!environmentReady) return
		if (route !== 'security-pools') return
		if (tradingResultHash === undefined) return
		void loadSecurityPoolsRef.current(securityPoolAddress)
	}, [environmentReady, route, securityPoolAddress, tradingResultHash])

	useEffect(() => {
		if (!augurStatoblastDeploymentMissing) return
		if (route === 'deploy') return
		navigateRef.current('deploy')
	}, [augurStatoblastDeploymentMissing, route])
}
