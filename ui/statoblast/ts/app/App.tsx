import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { RepPriceRefreshContext } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { useCallback, useState } from 'preact/hooks'
import { UniverseNamesProvider } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { UniverseSwitcher } from '@zoltar/ui-core-shared/components/UniverseSwitcher.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { useStatoblastUrlState } from './hooks/useStatoblastUrlState.js'
import { initializeStatoblastActiveEnvironment } from './activeEnvironment.js'
import { applicationTitle, formatAppDocumentTitle, getAppPageTitle, getPoolDocumentTitleDetail } from './lib/appPageTitle.js'
import { buildRouteHref, getTopLevelRouteSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { STATOBLAST_ROUTES, type StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getStatoblastDeploymentSections } from '@zoltar/ui-statoblast-shared/features/deployment/deploymentSections.js'
import { getInvalidStatoblastRouteState, isInvalidStatoblastRouteState } from './lib/routeValidation.js'
import { readUiPriceOracle, UiPriceOracleSettings } from './UiPriceOracleSettings.js'
import { getHeaderRepPerEthPrice } from './lib/headerRepPrice.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from './lib/appNavigation.js'
import { getStatoblastOverviewUniverse } from './lib/overviewUniverse.js'
import { useOpenOracleRoute } from './hooks/useOpenOracleRoute.js'
import { useSecurityPoolsRoute } from './hooks/useSecurityPoolsRoute.js'

export function App() {
	const [uiPriceOracle, setUiPriceOracle] = useState(readUiPriceOracle)
	const [selectedPoolRefreshNonce, setSelectedPoolRefreshNonce] = useState(0)
	const urlState = useStatoblastUrlState()
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, openOracleView, securityPoolAddress, securityPoolQuestionId, selectedPoolView, setActiveUniverseId, setOpenOracleReport, setOpenOracleView, setSecurityPoolsView, vaultAddress } = urlState
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<StatoblastRoute>(route, 'not-found', STATOBLAST_ROUTES)
	const repPrices = useRepPrices()
	const { repPerEthFailure, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, isRefreshingRepPrices, refreshRepPrices } = repPrices
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
			deploymentCompleteLabel: commonCopy.browsePools,
			deploymentCompleteHref: buildRouteHref(statoblastRouting.getHash('pools'), getTopLevelRouteSearch('pools')),
			deploymentCompleteLabel: commonCopy.browsePools,
			getSections: getStatoblastDeploymentSections,
		},
		initializeEnvironment: options => initializeStatoblastActiveEnvironment(window.location, options),
		isDeploymentRoute: route === 'deploy',
		onchainStateDependencies,
		onEnvironmentCommitted: () => setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1),
		onRefresh: refreshRepPrices,
	})
	const { transactionState } = transactionTray
	const includeRelatedUniverses = route === 'pools' && urlState.securityPoolsView === 'migrate'
	const marketCreation = useMarketCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		autoLoadInitialData: walletBootstrapComplete && canReadOnchainData,
		includeRelatedUniverses,
		deploymentStatuses,
		environmentRefreshKey: activeEnvironmentNonce,
	})
	const { zoltarUniverse, zoltarUniverseError } = marketCreation
	const { activeOpenOracleView, loadOracleReport, onViewPendingReport, openOracleRouteContentProps, openOraclePriceCoordinator, setOpenOracleReportId } = useOpenOracleRoute({
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
	const { activeSecurityPoolsView, formSync, loadSecurityPools, resetSecurityPoolCreation, securityPoolResult, securityPoolsRouteContentProps, selectedPool, selectedPoolRepPrice, tradingResult } = useSecurityPoolsRoute({
		context: { accountState, activeEnvironmentNonce, activeUniverseId, canReadOnchainData, currentTimestamp, deploymentStatuses, route, uiPriceOracle, walletBootstrapComplete, walletScopedAccountAddress, walletScopedHookConfig },
		marketCreation,
		openOracle: { inlineOracle: openOracleRouteContentProps, onViewPendingReport, priceCoordinator: openOraclePriceCoordinator },
		repPrices,
		selectedPoolRefresh: { nonce: selectedPoolRefreshNonce, setNonce: setSelectedPoolRefreshNonce },
		urlState,
	})
	const overviewProps = {
		...overviewWalletProps,
		activeUniverseId,
		...getStatoblastOverviewUniverse({ ...marketCreation, migrationActive: route === 'pools' && activeSecurityPoolsView === 'migrate' }),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		repPrices: {
			isLoading: isLoadingRepPrices,
			isRefreshing: isRefreshingRepPrices,
			onRefresh: refreshRepPrices,
			...getHeaderRepPerEthPrice({ currentTimestamp, hasSelectedPool: selectedPool !== undefined, repPerEthFailure, repPerEthSource, repPerEthSourceUrl, repPrice: selectedPoolRepPrice }),
			repUsdcFailure,
			repUsdcPrice,
			repUsdcSource,
			repUsdcSourceUrl,
		},
		universeControl: <UniverseSwitcher includeRelatedUniverses={includeRelatedUniverses} activeUniverseId={activeUniverseId} browseHref={buildRouteHref('#/pools/universes', getTopLevelRouteSearch('pools'))} universe={zoltarUniverse} />,
		universePresentation: undefined,
		showWethBalance: true,
	}
	const invalidRouteState = getInvalidStatoblastRouteState({
		openOracleView,
		pageSearch: window.location.search,
		resolvedRoute,
		search: parseRouteHash(window.location.hash).search,
		selectedPoolView,
	})
	const activeRoute = isInvalidStatoblastRouteState(invalidRouteState) ? 'not-found' : resolvedRoute
	const tabNavigationProps = {
		route,
		tabs: getStatoblastRouteTabs({ route, showDeployTab }),
		onRouteChange: navigate,
	}
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute })
	// Only the document title names the pool, so the pool loading in does not move focus to the page heading again.
	const documentTitleDetail = activeRoute === 'pools' && activeSecurityPoolsView === 'operate' ? getPoolDocumentTitleDetail({ requestedPoolAddress: securityPoolAddress, selectedPool }) : undefined
	const formatDocumentTitle = useCallback((title: string) => formatAppDocumentTitle(title, documentTitleDetail), [documentTitleDetail])
	useAppRouteEffects({
		accountAddress: walletScopedAccountAddress,
		applicationDeploymentMissing,
		environmentReady: canReadOnchainData,
		activeEnvironmentNonce,
		formSync: { ...formSync, setOpenOracleReportId },
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		loadSecurityPools: async requestedSecurityPoolAddress => await loadSecurityPools(requestedSecurityPoolAddress),
		navigate,
		resetSecurityPoolCreation,
		route: activeRoute,
		securityPoolAddress,
		securityPoolQuestionId,
		securityPoolResultHash: securityPoolResult?.deployPoolHash,
		selectedPoolSecurityPoolAddress: selectedPool?.securityPoolAddress,
		tradingResultHash: tradingResult?.hash,
		urlOpenOracleReportId,
		urlVaultAddress: vaultAddress,
		walletBootstrapComplete,
	})
	const secondaryNavigation = getRouteSecondaryNavigation({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute, setOpenOracleView, setSecurityPoolsView })
	const transactionRouteKey = getTransactionRouteKey({ activeOpenOracleView, activeSecurityPoolsView, route })

	return (
		<UniverseNamesProvider includeRelatedUniverses={includeRelatedUniverses} universe={zoltarUniverse}>
			<ProtocolAppFrame
				accountAddress={walletScopedAccountAddress}
				activeUniverseId={activeUniverseId}
				currentBlockNumber={currentBlockNumber}
				currentTimestamp={currentTimestamp}
				header={
					<AppHeaderShell
						renderOverview={({ navigation, settingsMenu }) => <OverviewPanels {...overviewProps} applicationTitle={applicationTitle} navigation={navigation} settingsMenu={settingsMenu} />}
						simulationController={simulationController}
						secondaryNavigation={secondaryNavigation}
						tabNavigation={tabNavigationProps}
						onEnvironmentChanged={refreshActiveEnvironment}
						onRefresh={refreshSimulationView}
						settingsContent={<UiPriceOracleSettings priceOracle={uiPriceOracle} onPriceOracleChange={setUiPriceOracle} />}
					/>
				}
				heading={<AppPageHeading formatDocumentTitle={formatDocumentTitle} pageTitle={pageTitle} />}
				notices={<AppStatusNotices errorMessages={errorMessages} readBackendMessage={readBackendMessage} readBackendStatus={readBackendStatus} simulationBootstrapError={environmentBootstrapError} showApplicationDeploymentWarning={applicationDeploymentMissing} zoltarUniverseError={zoltarUniverseError} />}
				routeContentDisabled={routeContentBlocked}
				transactionRouteKey={transactionRouteKey}
				transactionState={transactionState.value}
				walletActions={overviewWalletProps}
			>
				<RepPriceRefreshContext.Provider value={{ onRefresh: refreshRepPrices, busy: isLoadingRepPrices || isRefreshingRepPrices }}>
					<AppRouteContent deploy={deployRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} securityPools={securityPoolsRouteContentProps} />
				</RepPriceRefreshContext.Provider>
				<TransactionStepsModal contextKey={`${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}`} />
			</ProtocolAppFrame>
		</UniverseNamesProvider>
	)
}
