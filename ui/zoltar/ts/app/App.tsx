import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useQuestionCreation } from '@zoltar/ui-zoltar-shared/features/questions/hooks/useQuestionCreation.js'
import { useZoltarUrlState } from './hooks/useZoltarUrlState.js'
import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import { zoltarRouting } from '@zoltar/ui-zoltar-shared/lib/routing.js'
import { ZOLTAR_TAB_VIEWS, ZOLTAR_VIEWS } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/lib/zoltarViewModels.js'
import { ZoltarWorkspaceProvider, type ZoltarWorkspace } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarWorkspace.js'
import { UniverseNamesProvider } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { UniverseSwitcher } from '@zoltar/ui-core-shared/components/UniverseSwitcher.js'
import { hasInvalidZoltarView } from './lib/routeValidation.js'
import { getZoltarTabLabel, getZoltarTabView, getZoltarViewHref, type ZoltarTabView } from './lib/zoltarNavigation.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'

export function App() {
	const { activeUniverseId, setActiveUniverseId, setZoltarView, zoltarView } = useZoltarUrlState()
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'zoltar', 'not-found'])
	const invalidZoltarView = hasInvalidZoltarView({ resolvedRoute, search: parseRouteHash(window.location.hash).search, zoltarView })
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'overview', ZOLTAR_VIEWS)
	const activeRoute = invalidZoltarView ? 'not-found' : resolvedRoute
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
		walletScopedHookConfig,
	} = useProtocolAppShell({
		initializeEnvironment: options => initializeActiveEnvironment(window.location, undefined, options),
		isDeploymentRoute: route === 'deploy',
		onchainStateDependencies,
	})
	const { transactionState } = transactionTray
	const operations = useQuestionCreation({ ...walletScopedHookConfig, activeUniverseId, autoLoadInitialData: walletBootstrapComplete && canReadOnchainData, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce })
	const { loadingZoltarForkAccess, loadingZoltarUniverse, loadZoltarUniverse, zoltarForkRepBalanceAttoRep, zoltarUniverse, zoltarUniverseError, zoltarUniverseMissing } = operations
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = canReadOnchainData && zoltarUniverseState === 'missing'
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const pageTitle = getAppPageTitle({ activeZoltarView, route: activeRoute })
	useAppRouteEffects({
		applicationDeploymentMissing,
		navigate,
		route: activeRoute,
	})
	const zoltarWorkspace: ZoltarWorkspace = {
		accountState,
		activeUniverseId,
		currentTimestamp,
		environmentRefreshKey: activeEnvironmentNonce,
		isConnectingWallet: overviewWalletProps.isConnectingWallet,
		onConnectWallet: overviewWalletProps.onConnect,
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		onRetryUniverse: () => void loadZoltarUniverse({ clearCurrentState: false }),
		onSwitchNetwork: overviewWalletProps.onSwitchNetwork,
		onViewChange: view => setZoltarView(view),
		operations,
		universeError: zoltarUniverseError,
		universeState: zoltarUniverseState,
	}
	const deploymentTab: RouteTabDefinition = { hash: zoltarRouting.getHash('deploy'), label: appCopy.deployContracts, route: 'deploy' }
	const tabNavigationProps = {
		// The not-found page keeps the Zoltar navigation so the user can recover without the browser's back button.
		route: activeRoute === 'not-found' ? 'zoltar' : route,
		tabs: withDeploymentTab({ deploymentTab, deploymentIncomplete: showDeployTab, route, tabs: [{ hash: zoltarRouting.getHash('zoltar'), label: commonCopy.zoltar, route: 'zoltar' }] }),
		onRouteChange: navigate,
	}
	const zoltarViewNavigation = createSecondaryNavigation<ZoltarTabView>({
		ariaLabel: appCopy.zoltarViews,
		value: getZoltarTabView(activeZoltarView),
		onChange: view => setZoltarView(view),
		options: ZOLTAR_TAB_VIEWS.map(view => ({ href: getZoltarViewHref(view), label: getZoltarTabLabel(view), value: view })),
	})
	const secondaryNavigation = activeRoute === 'not-found' ? { ...zoltarViewNavigation, value: '' } : resolveSecondaryNavigation({ route: activeRoute, secondaryByRoute: { zoltar: zoltarViewNavigation } })
	const transactionRouteKey = route === 'zoltar' ? `${route}:${activeZoltarView}` : route

	return (
		<UniverseNamesProvider universe={zoltarUniverse}>
			<ProtocolAppFrame
				currentBlockNumber={currentBlockNumber}
				currentTimestamp={currentTimestamp}
				heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />}
				notices={
					<AppStatusNotices
						errorMessages={errorMessages}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onRetryZoltarUniverse={() => void loadZoltarUniverse({ clearCurrentState: false })}
						readBackendMessage={readBackendMessage}
						readBackendStatus={readBackendStatus}
						simulationBootstrapError={environmentBootstrapError}
						showApplicationDeploymentWarning={applicationDeploymentMissing}
						zoltarUniverseError={zoltarUniverseError}
					/>
				}
				header={
					<AppHeaderShell
						renderOverview={settingsMenu => (
							<OverviewPanels
								{...overviewWalletProps}
								settingsMenu={settingsMenu}
								applicationTitle={zoltarCopy.applicationTitle}
								activeUniverseId={activeUniverseId}
								isLoadingUniverseRepBalance={loadingZoltarForkAccess}
								onGoToGenesisUniverse={() => setActiveUniverseId(0n)}
								universeForkTime={zoltarUniverse?.forkTime}
								universeHasForked={zoltarUniverse?.hasForked}
								universePresentation={universePresentation}
								universeControl={<UniverseSwitcher activeUniverseId={activeUniverseId} browseHref={getZoltarViewHref('universes')} universe={zoltarUniverse} />}
								universeRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
							/>
						)}
						simulationController={simulationController}
						secondaryNavigation={secondaryNavigation}
						tabNavigation={tabNavigationProps}
						onEnvironmentChanged={refreshActiveEnvironment}
						onRefresh={refreshSimulationView}
					/>
				}
				routeContentDisabled={routeContentBlocked}
				transactionRouteKey={transactionRouteKey}
				transactionState={transactionState.value}
			>
				<ZoltarWorkspaceProvider workspace={zoltarWorkspace}>
					<AppRouteContent deploy={deployRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} zoltarView={activeZoltarView} />
				</ZoltarWorkspaceProvider>
			</ProtocolAppFrame>
		</UniverseNamesProvider>
	)
}
