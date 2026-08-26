import { useEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { shouldLoadOpenOracleReportFromUrl as shouldLoadOpenOracleReport, useOpenOracleRouteSync } from '@zoltar/ui-zoltar/features/open-oracle/hooks/useOpenOracleRouteSync.js'
import type { Route } from '../types/app.js'

type Props = {
	accountAddress: Address | undefined
	applicationDeploymentMissing: boolean
	activeEnvironmentNonce: number
	environmentReady: boolean
	loadOracleReport: (reportId: string) => Promise<void>
	loadSecurityPools: (securityPoolAddress?: string) => Promise<boolean | void>
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools') => void
	resetSecurityPoolCreation: () => void
	route: Route
	securityPoolAddress: string
	securityPoolQuestionId: string
	securityPoolResultHash: string | undefined
	selectedPoolSecurityPoolAddress: string | undefined
	setForkAuctionFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setOpenOracleFormReportId: (reportId: string) => void
	setReportingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityVaultFormSelectedVaultOwner: (selectedVaultOwner: string) => void
	setSecurityVaultFormSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityPoolFormMarketId: (marketId: string) => void
	setTradingFormSecurityPoolAddress: (securityPoolAddress: string) => void
	tradingResultHash: string | undefined
	urlOpenOracleReportId: string
	walletBootstrapComplete: boolean
}

export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }: { environmentReady: boolean; route: Route; urlOpenOracleReportId: string }) {
	return shouldLoadOpenOracleReport({ environmentReady, isOpenOracleRoute: route === 'open-oracle', reportId: urlOpenOracleReportId })
}

export function shouldRefreshSelectedPoolForRoute({ environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete }: { environmentReady: boolean; route: Route; securityPoolAddress: string; selectedPoolSecurityPoolAddress: string | undefined; walletBootstrapComplete: boolean }) {
	return environmentReady && route === 'security-pools' && walletBootstrapComplete && securityPoolAddress !== '' && selectedPoolSecurityPoolAddress === undefined
}

export function shouldSyncSecurityPoolAddressToRouteForms({ route }: { route: Route; securityPoolAddress: string }) {
	return route === 'security-pools'
}

export function getSelectedVaultOwnerForRoutePoolChange({ accountAddress, lastSecurityPoolAddress, route, securityPoolAddress }: { accountAddress: Address | undefined; lastSecurityPoolAddress: string | undefined; route: Route; securityPoolAddress: string }) {
	if (route !== 'security-pools') return undefined
	const normalizedSecurityPoolAddress = normalizeAddress(securityPoolAddress) ?? ''
	const normalizedLastSecurityPoolAddress = normalizeAddress(lastSecurityPoolAddress)
	if (normalizedSecurityPoolAddress === normalizedLastSecurityPoolAddress) return undefined
	if (normalizedSecurityPoolAddress === '') return ''
	return accountAddress?.toString() ?? ''
}

export function useAppRouteEffects({
	accountAddress,
	applicationDeploymentMissing,
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
	setSecurityVaultFormSelectedVaultOwner,
	setSecurityVaultFormSecurityPoolAddress,
	setSecurityPoolFormMarketId,
	setTradingFormSecurityPoolAddress,
	tradingResultHash,
	urlOpenOracleReportId,
	walletBootstrapComplete,
}: Props) {
	const loadSecurityPoolsRef = useRef(loadSecurityPools)
	const lastRequestedSecurityPoolAddress = useRef<string | undefined>(undefined)
	const lastSelectedPoolEnvironmentNonce = useRef<number | undefined>(undefined)
	const lastSelectedSecurityPoolAddress = useRef<string | undefined>(undefined)
	const lastSyncedSecurityPoolQuestionId = useRef<string | undefined>(undefined)

	loadSecurityPoolsRef.current = loadSecurityPools
	useOpenOracleRouteSync({ activeEnvironmentNonce, environmentReady, isOpenOracleRoute: route === 'open-oracle', loadOracleReport, reportId: urlOpenOracleReportId, setOpenOracleFormReportId })
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })

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
		const nextSelectedVaultOwner = getSelectedVaultOwnerForRoutePoolChange({
			accountAddress,
			lastSecurityPoolAddress: lastSelectedSecurityPoolAddress.current,
			route,
			securityPoolAddress,
		})
		if (nextSelectedVaultOwner !== undefined) setSecurityVaultFormSelectedVaultOwner(nextSelectedVaultOwner)
		if (route !== 'security-pools') {
			lastSelectedSecurityPoolAddress.current = undefined
			return
		}
		lastSelectedSecurityPoolAddress.current = normalizeAddress(securityPoolAddress) ?? ''
	}, [accountAddress, route, securityPoolAddress, setSecurityVaultFormSelectedVaultOwner])

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
}
