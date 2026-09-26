import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { useState } from 'preact/hooks'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { useAppRouteEffects } from './useAppRouteEffects.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { useStatoblastUrlState } from './hooks/useStatoblastUrlState.js'
import { initializeStatoblastActiveEnvironment } from './activeEnvironment.js'
import { applicationTitle, formatAppDocumentTitle, getAppPageTitle } from './appPageTitle.js'
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeSecurityPoolsViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import type { Route } from '@zoltar/ui-statoblast-shared/types/app.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getStatoblastDeploymentSections } from '@zoltar/ui-statoblast-shared/features/deployment/deploymentSections.js'
import { getInvalidStatoblastRouteState } from './lib/routeValidation.js'
import { readUiPriceOracle, UiPriceOracleSettings } from './UiPriceOracleSettings.js'
import { renderRepPriceSourceLabel } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/repPriceSource.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from './lib/appNavigation.js'
import { useOpenOracleRoute } from './hooks/useOpenOracleRoute.js'
import { useSecurityPoolsRoute } from './hooks/useSecurityPoolsRoute.js'

export function App() {
	const [uiPriceOracle, setUiPriceOracle] = useState(readUiPriceOracle)
	const [selectedPoolRefreshNonce, setSelectedPoolRefreshNonce] = useState(0)
	const {
		activeUniverseId,
		openOracleReportId: urlOpenOracleReportId,
		openOracleView,
		securityPoolsView,
		securityPoolAddress,
		securityPoolQuestionId,
		selectedPoolView,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
		setSelectedPoolView,
	} = useStatoblastUrlState()
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'security-pools', 'open-oracle', 'not-found'])
	const { repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, isRefreshingRepPrices, refreshRepPrices } = useRepPrices()
	const {
		accountState,
		activeEnvironmentNonce,
		applicationDeploymentMissing,
		canReadOnchainData,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatuses,
		deployRouteContentProps,
		environmentBootstrapError,
		errorMessages,
		overviewWalletProps,
		readBackendMessage,
		readBackendStatus,
		refreshActiveEnvironment,
		refreshSimulationView,
		routeContentBlocked,
		showDeployTab,
		simulationController,
		transactionTray,
		walletBootstrapComplete,
		walletScopedAccountAddress,
		walletScopedHookConfig,
	} = useProtocolAppShell({
		deploymentRoute: {
			deploymentCompleteHref: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')),
			getSections: getStatoblastDeploymentSections,
		},
		initializeEnvironment: options => initializeStatoblastActiveEnvironment(window.location, options),
		isDeploymentRoute: route === 'deploy',
		onchainStateDependencies,
		onEnvironmentCommitted: () => setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1),
		onRefresh: refreshRepPrices,
	})
	const { transactionState } = transactionTray
	const marketCreation = useMarketCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		autoLoadInitialData: walletBootstrapComplete && canReadOnchainData,
		deploymentStatuses,
		environmentRefreshKey: activeEnvironmentNonce,
	})
	const { loadingZoltarForkAccess, zoltarUniverse, zoltarUniverseError } = marketCreation
	const { activeOpenOracleView, loadOracleReport, onViewPendingReport, openOracleRouteContentProps, priceOracleManager, setOpenOracleForm } = useOpenOracleRoute({
		accountState,
		activeEnvironmentNonce,
		canReadOnchainData,
		navigate,
		openOracleView,
		route,
		setOpenOracleReport,
		setOpenOracleView,
		urlOpenOracleReportId,
		walletScopedHookConfig,
	})
	const {
		activeSecurityPoolsView,
		loadSecurityPools,
		resetSecurityPoolCreation,
		securityPoolResult,
		securityPoolsRouteContentProps,
		selectedPool,
		setForkAuctionForm,
		setSecurityPoolForm,
		setSecurityVaultForm,
		setTradingForm,
		tradingResult,
		uiRepPerEthPrice,
		uiRepPerEthSource,
		uiRepPerEthSourceUrl,
		uiUsesOpenOraclePrice,
		updateReportingForm,
	} = useSecurityPoolsRoute({
		inlineOracle: openOracleRouteContentProps,
		accountState,
		activeEnvironmentNonce,
		activeUniverseId,
		canReadOnchainData,
		currentTimestamp,
		deploymentStatuses,
		marketCreation,
		onViewPendingReport,
		priceOracleManager,
		repPerEthPrice,
		repPerEthSource,
		repPerEthSourceUrl,
		route,
		securityPoolAddress,
		securityPoolsView,
		selectedPoolRefreshNonce,
		selectedPoolView,
		setActiveUniverseId,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
		setSecurityPoolsView,
		setSelectedPoolRefreshNonce,
		setSelectedPoolView,
		uiPriceOracle,
		walletBootstrapComplete,
		walletScopedAccountAddress,
		walletScopedHookConfig,
	})
	const overviewProps = {
		...overviewWalletProps,
		activeUniverseId,
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		repPrices: {
			isLoading: isLoadingRepPrices,
			isRefreshing: isRefreshingRepPrices,
			onRefresh: refreshRepPrices,
			repPerEthFailure,
			repPerEthPrice: uiRepPerEthPrice,
			repPerEthSource: uiUsesOpenOraclePrice ? undefined : repPerEthSource,
			repPerEthSourceLabel: renderRepPriceSourceLabel(uiRepPerEthSource, uiRepPerEthSourceUrl),
			repPerEthSourceUrl: uiRepPerEthSourceUrl,
			repUsdcFailure,
			repUsdcPrice,
			repUsdcSource,
			repUsdcSourceUrl,
		},
		universeForkTime: zoltarUniverse?.forkTime,
		universeHasForked: zoltarUniverse?.hasForked,
		universePresentation: undefined,
		universeRepBalanceAttoRep: zoltarUniverse?.totalTheoreticalSupplyAttoRep,
	}
	const invalidRouteState = getInvalidStatoblastRouteState({
		activeSecurityPoolsView,
		openOracleView,
		resolvedRoute,
		search: parseRouteHash(window.location.hash).search,
		securityPoolsView,
		selectedPoolView,
	})
	const activeRoute = invalidRouteState.hasInvalidSecurityPoolsView || invalidRouteState.hasInvalidSelectedPoolView || invalidRouteState.hasInvalidOpenOracleView ? 'not-found' : resolvedRoute
	const tabNavigationProps = {
		route,
		tabs: getStatoblastRouteTabs({ route, showDeployTab }),
		onRouteChange: navigate,
	}
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute })
	useAppRouteEffects({
		accountAddress: walletScopedAccountAddress,
		applicationDeploymentMissing,
		environmentReady: canReadOnchainData,
		activeEnvironmentNonce,
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		loadSecurityPools: async requestedSecurityPoolAddress => await loadSecurityPools(requestedSecurityPoolAddress),
		navigate,
		resetSecurityPoolCreation,
		route: activeRoute,
		securityPoolAddress,
		securityPoolQuestionId,
		securityPoolResultHash: securityPoolResult?.deployPoolHash,
		selectedPoolSecurityPoolAddress: selectedPool?.securityPoolAddress,
		setForkAuctionFormSecurityPoolAddress: nextSecurityPoolAddress => setForkAuctionForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setOpenOracleFormReportId: reportId => setOpenOracleForm(current => ({ ...current, reportId })),
		setReportingFormSecurityPoolAddress: nextSecurityPoolAddress => updateReportingForm({ securityPoolAddress: nextSecurityPoolAddress }),
		setSecurityVaultFormSelectedVaultOwner: nextSelectedVaultOwner => setSecurityVaultForm(current => (current.selectedVaultOwner === nextSelectedVaultOwner ? current : { ...current, selectedVaultOwner: nextSelectedVaultOwner })),
		setSecurityVaultFormSecurityPoolAddress: nextSecurityPoolAddress => setSecurityVaultForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setSecurityPoolFormMarketId: marketId => setSecurityPoolForm(current => (current.marketId === marketId ? current : { ...current, marketId })),
		setTradingFormSecurityPoolAddress: nextSecurityPoolAddress => setTradingForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		tradingResultHash: tradingResult?.hash,
		urlOpenOracleReportId,
		walletBootstrapComplete,
	})
	const secondaryNavigation = getRouteSecondaryNavigation({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute, setOpenOracleView, setSecurityPoolsView })
	const transactionRouteKey = getTransactionRouteKey({ activeOpenOracleView, activeSecurityPoolsView, route })

	return (
		<ProtocolAppFrame
			activeUniverseId={activeUniverseId}
			currentBlockNumber={currentBlockNumber}
			currentTimestamp={currentTimestamp}
			header={
				<AppHeaderShell
					renderOverview={settingsMenu => <OverviewPanels {...overviewProps} applicationTitle={applicationTitle} settingsMenu={settingsMenu} />}
					simulationController={simulationController}
					secondaryNavigation={secondaryNavigation}
					tabNavigation={tabNavigationProps}
					onEnvironmentChanged={refreshActiveEnvironment}
					onRefresh={refreshSimulationView}
					settingsContent={<UiPriceOracleSettings priceOracle={uiPriceOracle} onPriceOracleChange={setUiPriceOracle} />}
				/>
			}
			heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />}
			notices={<AppStatusNotices errorMessages={errorMessages} readBackendMessage={readBackendMessage} readBackendStatus={readBackendStatus} simulationBootstrapError={environmentBootstrapError} showApplicationDeploymentWarning={applicationDeploymentMissing} zoltarUniverseError={zoltarUniverseError} />}
			routeContentDisabled={routeContentBlocked}
			transactionRouteKey={transactionRouteKey}
			transactionState={transactionState.value}
			walletActions={overviewWalletProps}
		>
			<AppRouteContent deploy={deployRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} securityPools={securityPoolsRouteContentProps} />
			<TransactionStepsModal contextKey={`${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}`} />
		</ProtocolAppFrame>
	)
}
