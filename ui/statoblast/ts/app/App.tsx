import { useState } from 'preact/hooks'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-zoltar-shared/features/overview/OverviewPanels.js'
import { useAppRouteEffects } from './useAppRouteEffects.js'
import { useDeploymentFlow } from '@zoltar/ui-zoltar-shared/features/deployment/hooks/useDeploymentFlow.js'
import { buildDeploymentRouteContentProps } from '@zoltar/ui-zoltar-shared/features/deployment/lib/deploymentRoute.js'
import { formatUniverseCollectionLabel } from '@zoltar/ui-zoltar-shared/features/universes/lib/universe.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { useProtocolOnchainRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js'
import { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { useUrlState } from '@zoltar/ui-core-shared/app/hooks/useUrlState.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
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
import { getRouteSubNavigation, getShowDeployTab, getStatoblastRouteTabs, getTransactionRouteKey } from './lib/appNavigation.js'
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
	} = useUrlState()
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'security-pools', 'open-oracle', 'not-found'])
	const {
		accountState,
		activeEnvironmentNonce,
		applicationDeploymentComplete,
		baseHookConfig,
		canReadOnchainData,
		changeWallet,
		chainClockError,
		connectWallet,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatusError,
		deploymentStatuses,
		disconnectWallet,
		environmentBootstrapError,
		environmentReady,
		errorMessages: onchainErrorMessages,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isLoadingDeploymentStatuses,
		isManagingWallet,
		isOnActiveAppChain,
		isRefreshing,
		readBackendMessage,
		readBackendReady,
		readBackendStatus,
		refreshState,
		setActiveEnvironmentNonce,
		setDeploymentStatuses,
		switchNetwork,
		transactionTray,
		walletBootstrapComplete,
		walletScopedAccountAddress,
		walletScopedHookConfig,
	} = useProtocolOnchainRuntime({
		enableChainClock: route !== 'deploy',
		onchainStateDependencies,
		replaceEnvironment: async canCommit => {
			let commitAllowed = false
			await initializeStatoblastActiveEnvironment(window.location, {
				shouldCommit: () => {
					commitAllowed = canCommit()
					return commitAllowed
				},
			})
			return commitAllowed
		},
		onEnvironmentCommitted: () => setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1),
	})
	const { transactionState } = transactionTray
	const deploymentFlow = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce, setDeploymentStatuses })
	const { errorMessage: deploymentErrorMessage } = deploymentFlow
	const marketCreation = useMarketCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		activeZoltarView: 'questions',
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
	const { repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, isRefreshingRepPrices, refreshRepPrices } = useRepPrices()
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
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
		refreshRepPrices()
	}
	const refreshActiveEnvironment = async () => {
		await initializeStatoblastActiveEnvironment()
		setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
		setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1)
		await refreshSimulationView()
	}
	const errorMessages = [deploymentErrorMessage, ...onchainErrorMessages.filter(message => message !== deploymentStatusError), chainClockError].filter((message): message is string => message !== undefined)
	const applicationDeploymentMissing = canReadOnchainData && applicationDeploymentComplete === false
	const showApplicationDeploymentWarning = applicationDeploymentMissing
	const disableRouteContent = route !== 'deploy' && (!readBackendReady || applicationDeploymentMissing)
	const isRouteContentDisabled = disableRouteContent
	const overviewProps = {
		activeUniverseId,
		accountState,
		isConnectingWallet,
		isManagingWallet,
		isLoadingRepPrices,
		isRefreshingRepPrices,
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		onConnect: () => void connectWallet(),
		onChangeWallet: () => void changeWallet(),
		onDisconnectWallet: () => void disconnectWallet(),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		onRefreshRepPrices: refreshRepPrices,
		onSwitchNetwork: () => void switchNetwork(),
		parentUniverseId: zoltarUniverse?.parentUniverseId,
		repPerEthFailure,
		repPerEthPrice: uiRepPerEthPrice,
		repPerEthSource: uiUsesOpenOraclePrice ? undefined : repPerEthSource,
		repPerEthSourceLabel: renderRepPriceSourceLabel(uiRepPerEthSource, uiRepPerEthSourceUrl),
		repPerEthSourceUrl: uiRepPerEthSourceUrl,
		repUsdcFailure,
		repUsdcPrice,
		repUsdcSource,
		repUsdcSourceUrl,
		readBackendStatus,
		universeForkTime: zoltarUniverse?.forkTime,
		universeHasForked: zoltarUniverse?.hasForked,
		universePresentation: undefined,
		universeLabel: formatUniverseCollectionLabel([activeUniverseId]),
		universeRepBalanceAttoRep: zoltarUniverse?.totalTheoreticalSupplyAttoRep,
		isRefreshing,
		walletBootstrapComplete,
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
	const showDeployTab = getShowDeployTab({ applicationDeploymentMissing, deploymentStatusError, deploymentStatuses, hasLoadedDeploymentStatuses })
	const tabNavigationProps = {
		route,
		tabs: getStatoblastRouteTabs(showDeployTab),
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
	const deployRouteContentProps = buildDeploymentRouteContentProps({
		accountAddress: accountState.address,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deploymentStatuses,
		flow: deploymentFlow,
		getSections: getStatoblastDeploymentSections,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		deploymentCompleteHref: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')),
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
	})
	const routeSubNavigation = getRouteSubNavigation({ activeOpenOracleView, activeSecurityPoolsView, route, setOpenOracleView, setSecurityPoolsView })
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
					subNavigation={routeSubNavigation}
					tabNavigation={tabNavigationProps}
					onEnvironmentChanged={refreshActiveEnvironment}
					onRefresh={refreshSimulationView}
					settingsContent={<UiPriceOracleSettings priceOracle={uiPriceOracle} onPriceOracleChange={setUiPriceOracle} />}
				/>
			}
			heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />}
			notices={<AppStatusNotices errorMessages={errorMessages} readBackendMessage={readBackendMessage} readBackendStatus={readBackendStatus} simulationBootstrapError={environmentBootstrapError} showApplicationDeploymentWarning={showApplicationDeploymentWarning} zoltarUniverseError={zoltarUniverseError} />}
			routeContentDisabled={isRouteContentDisabled}
			transactionRouteKey={transactionRouteKey}
			transactionState={transactionState.value}
		>
			<AppRouteContent deploy={deployRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} securityPools={securityPoolsRouteContentProps} />
		</ProtocolAppFrame>
	)
}
