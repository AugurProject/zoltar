import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import { resolveRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { RepPriceRefreshContext } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { useState } from 'preact/hooks'
import { UniverseNamesProvider } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { UniverseSwitcher } from '@zoltar/ui-core-shared/components/UniverseSwitcher.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { useOpenOracleRouteSync } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleRouteSync.js'
import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { useStatoblastUrlState } from './hooks/useStatoblastUrlState.js'
import { initializeStatoblastActiveEnvironment } from './activeEnvironment.js'
import { applicationTitle, formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
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
import { getStatoblastOverviewUniverse, getStatoblastUniversePresentation } from './lib/overviewUniverse.js'
import { useOpenOracleRoute } from './hooks/useOpenOracleRoute.js'

export function App() {
	const [uiPriceOracle, setUiPriceOracle] = useState(readUiPriceOracle)
	const urlState = useStatoblastUrlState()
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, securityPoolAddress, selectedPoolView, setActiveUniverseId, setOpenOracleReport, setSecurityPoolsView } = urlState
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
		retryReadBackend,
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
			deploymentCompleteHref: buildRouteHref(statoblastRouting.getHash('pools'), getTopLevelRouteSearch('pools')),
			deploymentCompleteLabel: commonCopy.browsePools,
			getSections: getStatoblastDeploymentSections,
		},
		initializeEnvironment: options => initializeStatoblastActiveEnvironment(window.location, options),
		isDeploymentRoute: route === 'deploy',
		onchainStateDependencies,
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
	const { loadOracleReport, openOracleRouteContentProps, setOpenOracleReportId } = useOpenOracleRoute({
		accountState,
		canReadOnchainData,
		navigate,
		route,
		setOpenOracleReport,
		urlOpenOracleReportId,
		walletScopedHookConfig,
	})
	const activeSecurityPoolsView = resolveEnumValue<SecurityPoolsView>(urlState.securityPoolsView, securityPoolAddress === '' ? 'browse' : 'operate', ['browse', 'operate', 'universes', 'migrate'])
	const overviewProps = {
		...overviewWalletProps,
		activeUniverseId,
		...getStatoblastOverviewUniverse({ ...marketCreation, migrationActive: route === 'pools' && activeSecurityPoolsView === 'migrate' }),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		repPrices: {
			isLoading: isLoadingRepPrices,
			isRefreshing: isRefreshingRepPrices,
			onRefresh: refreshRepPrices,
			...getHeaderRepPerEthPrice({ currentTimestamp, hasSelectedPool: false, repPerEthFailure, repPerEthSource, repPerEthSourceUrl, repPrice: resolveRepPrice({ now: currentTimestamp, setting: uiPriceOracle, uniswapPrice: repPrices.repPerEthPrice }) }),
			repUsdcFailure,
			repUsdcPrice,
			repUsdcSource,
			repUsdcSourceUrl,
		},
		universeControl: <UniverseSwitcher activeUniverseId={activeUniverseId} browseHref={buildRouteHref('#/pools/universes', getTopLevelRouteSearch('pools'))} universe={zoltarUniverse} />,
		universePresentation: getStatoblastUniversePresentation({ canReadOnchainData, ...marketCreation }),
		showWethBalance: true,
	}
	const invalidRouteState = getInvalidStatoblastRouteState({
		pageSearch: window.location.search,
		resolvedRoute,
		search: parseRouteHash(window.location.hash).search,
		selectedPoolView,
	})
	const activeRoute = isInvalidStatoblastRouteState(invalidRouteState) ? 'not-found' : resolvedRoute
	const tabNavigationProps = {
		// A page that does not exist belongs to no section, so no tab is marked current.
		route: activeRoute,
		tabs: getStatoblastRouteTabs({ applicationDeploymentMissing, route, showDeployTab }),
		onRouteChange: navigate,
	}
	const pageTitle = getAppPageTitle({ activeSecurityPoolsView, route: activeRoute })
	useOpenOracleRouteSync({ activeEnvironmentNonce, environmentReady: canReadOnchainData, isOpenOracleRoute: activeRoute === 'open-oracle', loadOracleReport, reportId: urlOpenOracleReportId, setOpenOracleFormReportId: setOpenOracleReportId })
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
	const secondaryNavigation = getRouteSecondaryNavigation({ activeSecurityPoolsView, route: activeRoute, setSecurityPoolsView })
	const transactionRouteKey = getTransactionRouteKey({ activeSecurityPoolsView, route })

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
				heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />}
				notices={
					<AppStatusNotices
						errorMessages={errorMessages}
						isDeploymentRoute={activeRoute === 'deploy'}
						onRetryReadBackend={() => void retryReadBackend()}
						readBackendMessage={readBackendMessage}
						readBackendStatus={readBackendStatus}
						simulationBootstrapError={environmentBootstrapError}
						showApplicationDeploymentWarning={applicationDeploymentMissing}
						zoltarUniverseError={zoltarUniverseError}
					/>
				}
				routeContentDisabled={routeContentBlocked}
				transactionRouteKey={transactionRouteKey}
				transactionState={transactionState.value}
				walletActions={overviewWalletProps}
			>
				<RepPriceRefreshContext.Provider value={{ onRefresh: refreshRepPrices, busy: isLoadingRepPrices || isRefreshingRepPrices }}>
					<AppRouteContent
						deploy={deployRouteContentProps}
						openOracle={openOracleRouteContentProps}
						portfolios={{ parameters: walletScopedHookConfig, walletConnected: accountState.address !== undefined, enabled: canReadOnchainData && walletBootstrapComplete, environmentKey: activeEnvironmentNonce, activeUniverseId }}
						readBackendMessage={readBackendMessage}
						route={activeRoute}
						questions={{
							accountState,
							parameters: walletScopedHookConfig,
							deploymentStatuses,
							enabled: canReadOnchainData && walletBootstrapComplete,
							environmentKey: activeEnvironmentNonce,
							universeId: activeUniverseId,
							currentTimestamp,
							selectedAddress: securityPoolAddress,
							onSelect: urlState.openSecurityPoolInUniverse,
						}}
						questionView={activeSecurityPoolsView}
						universeDirectory={{ activeUniverseId, zoltarUniverse, universeMissing: marketCreation.zoltarUniverseMissing, universeError: marketCreation.zoltarUniverseError, onRetryUniverse: () => void marketCreation.loadZoltarUniverse(), onMigrateRep: () => setSecurityPoolsView('migrate') }}
						migration={{ accountState, activeUniverseId, operations: marketCreation, universeState: resolveLoadableValueState({ isLoading: marketCreation.loadingZoltarUniverse, isMissing: marketCreation.zoltarUniverseMissing, value: zoltarUniverse }), universeBrowserHref: '#/pools/universes' }}
					/>
				</RepPriceRefreshContext.Provider>
				<TransactionStepsModal contextKey={`${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}`} />
			</ProtocolAppFrame>
		</UniverseNamesProvider>
	)
}
