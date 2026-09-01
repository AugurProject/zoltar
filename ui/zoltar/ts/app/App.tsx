import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../copy/market.js'
import * as zoltarCopy from '../copy/zoltar.js'
import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { RouteSubNavigation } from '@zoltar/ui-core-shared/app/components/RouteSubNavigation.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useDeploymentFlow } from '../features/deployment/hooks/useDeploymentFlow.js'
import { buildDeploymentRouteContentProps } from '../features/deployment/lib/deploymentRoute.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useProtocolOnchainRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js'
import { useQuestionCreation } from '../features/questions/hooks/useQuestionCreation.js'
import { useZoltarUrlState } from './hooks/useZoltarUrlState.js'
import { getActiveSimulationController, initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../features/universes/lib/universe.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/lib/viewState.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import type { MarketRouteContentProps, ZoltarView } from '../features/types.js'
import type { Route } from '../types/app.js'
import { isUniverseIndependentZoltarView, zoltarRouting } from '../lib/routing.js'
import { hasInvalidZoltarView } from './lib/routeValidation.js'

export function App() {
	const { activeUniverseId, replaceZoltarView, setActiveUniverseId, setZoltarView, zoltarView } = useZoltarUrlState()
	const zoltarViews: readonly ZoltarView[] = ['questions', 'create', 'fork', 'migrate', 'universes']
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'zoltar', 'not-found'])
	const invalidZoltarView = hasInvalidZoltarView({ resolvedRoute, search: parseRouteHash(window.location.hash).search, zoltarView })
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', zoltarViews)
	const questionCreationView = activeZoltarView === 'universes' ? 'questions' : activeZoltarView
	const activeRoute = resolvedRoute === 'zoltar' && invalidZoltarView ? 'not-found' : resolvedRoute
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
		walletScopedHookConfig,
	} = useProtocolOnchainRuntime({
		enableChainClock: route !== 'deploy',
		onchainStateDependencies,
		replaceEnvironment: async canCommit => {
			let commitAllowed = false
			await initializeActiveEnvironment(window.location, undefined, {
				shouldCommit: () => {
					commitAllowed = canCommit()
					return commitAllowed
				},
			})
			return commitAllowed
		},
	})
	const { transactionState } = transactionTray
	const deploymentFlow = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce, setDeploymentStatuses })
	const { errorMessage: deploymentErrorMessage } = deploymentFlow
	const {
		approveZoltarForkRep,
		createChildUniverse,
		forkZoltar,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		loadingZoltarQuestionCount,
		loadingZoltarQuestion,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		loadZoltarQuestionPage,
		loadZoltarQuestion,
		loadZoltarQuestions,
		loadZoltarUniverse,
		migrateInternalRep,
		prepareRepForMigration,
		createQuestion,
		questionCreating,
		questionError,
		questionForm,
		questionResult,
		resetQuestion,
		setQuestionForm,
		setZoltarForkQuestionId,
		setZoltarMigrationForm,
		zoltarChildUniverseError,
		zoltarChildUniversePendingOutcomeIndex,
		zoltarForkApproval,
		zoltarForkActiveAction,
		zoltarForkError,
		zoltarForkPending,
		zoltarForkQuestionId,
		zoltarForkRepBalanceAttoRep,
		zoltarMigrationChildRepBalancesAttoRep,
		zoltarMigrationActiveAction,
		zoltarMigrationError,
		zoltarMigrationForm,
		zoltarMigrationPending,
		zoltarMigrationPreparedRepBalanceAttoRep,
		zoltarQuestionCount,
		zoltarQuestionLookupError,
		zoltarQuestionLookupId,
		zoltarQuestionPage,
		zoltarQuestions,
		zoltarQuestionsError,
		zoltarUniverse,
		zoltarUniverseError,
		zoltarUniverseMissing,
	} = useQuestionCreation({ ...walletScopedHookConfig, activeUniverseId, activeZoltarView: questionCreationView, autoLoadInitialData: walletBootstrapComplete && canReadOnchainData, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce })
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
	}
	const refreshActiveEnvironment = async () => {
		await initializeActiveEnvironment()
		setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
		await refreshSimulationView()
	}
	const errorMessages = [deploymentErrorMessage, ...onchainErrorMessages.filter(message => message !== deploymentStatusError), chainClockError].filter((message): message is string => message !== undefined)
	const applicationDeploymentMissing = canReadOnchainData && applicationDeploymentComplete === false
	const showDeployTab = deploymentStatusError !== undefined || applicationDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const showApplicationDeploymentWarning = applicationDeploymentMissing
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = canReadOnchainData && zoltarUniverseState === 'missing'
	const activeViewRequiresUniverse = !isUniverseIndependentZoltarView(activeZoltarView)
	const isRouteContentDisabled = route !== 'deploy' && (!readBackendReady || applicationDeploymentMissing || (activeViewRequiresUniverse && showZoltarUniverseWarning))
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const pageTitle = getAppPageTitle({ activeZoltarView, route: activeRoute })
	useAppRouteEffects({
		applicationDeploymentMissing,
		navigate,
		route: activeRoute,
	})
	useEffect(() => {
		if (activeRoute !== 'zoltar' || !showZoltarUniverseWarning || !activeViewRequiresUniverse) return
		replaceZoltarView('questions')
	}, [activeRoute, activeViewRequiresUniverse, replaceZoltarView, showZoltarUniverseWarning])
	const deployRouteContentProps = buildDeploymentRouteContentProps({
		accountAddress: accountState.address,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deploymentStatuses,
		flow: deploymentFlow,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
	})
	const zoltarRouteContentProps: MarketRouteContentProps = {
		accountState,
		activeUniverseId,
		activeView: activeZoltarView,
		environmentRefreshKey: activeEnvironmentNonce,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		loadingZoltarQuestion,
		loadingZoltarQuestionCount,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		onActiveViewChange: view => setZoltarView(view),
		onApproveZoltarForkRep: amount => void approveZoltarForkRep(amount),
		onCreateChildUniverseForOutcomeIndex: outcomeIndex => void createChildUniverse(outcomeIndex),
		onCreateQuestion: () => void createQuestion(),
		onForkZoltar: () => void forkZoltar(),
		onLoadZoltarQuestion: async questionId => await loadZoltarQuestion(questionId),
		onLoadZoltarQuestionPage: async (pageIndex, pageSize) => await loadZoltarQuestionPage(pageIndex, pageSize),
		onLoadZoltarQuestions: async () => await loadZoltarQuestions(),
		onMigrateInternalRep: () => void migrateInternalRep(),
		onPrepareRepForMigration: () => void prepareRepForMigration(),
		onQuestionFormChange: update => setQuestionForm(current => ({ ...current, ...update })),
		onResetQuestion: resetQuestion,
		onZoltarForkQuestionIdChange: questionId => setZoltarForkQuestionId(questionId),
		onZoltarMigrationFormChange: update => setZoltarMigrationForm(current => ({ ...current, ...update })),
		zoltarChildUniverseError,
		zoltarChildUniversePendingOutcomeIndex,
		zoltarForkActiveAction,
		zoltarForkApproval,
		zoltarForkError,
		zoltarForkPending,
		zoltarForkQuestionId,
		zoltarForkRepBalanceAttoRep,
		zoltarMigrationActiveAction,
		zoltarMigrationChildRepBalancesAttoRep,
		zoltarMigrationError,
		zoltarMigrationForm,
		zoltarMigrationPending,
		zoltarMigrationPreparedRepBalanceAttoRep,
		zoltarQuestionCount,
		zoltarQuestionLookupError,
		zoltarQuestionLookupId,
		zoltarQuestionPage,
		zoltarQuestions,
		zoltarQuestionsError,
		zoltarUniverse,
		zoltarUniverseState,
		questionCreating,
		questionError,
		questionForm,
		questionResult,
	}
	const tabNavigationTabs: RouteTabDefinition[] = [...(showDeployTab ? [{ hash: zoltarRouting.getHash('deploy'), label: appCopy.deployContracts, route: 'deploy' }] : []), { hash: zoltarRouting.getHash('zoltar'), label: commonCopy.zoltar, route: 'zoltar' }]
	const tabNavigationProps = {
		route,
		tabs: tabNavigationTabs,
		onRouteChange: navigate,
		showProtocolGuide: false,
	}
	let routeSubNavigation: ComponentChildren = undefined
	if (route === 'deploy' || route === 'zoltar') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.zoltarViews}
				value={activeZoltarView}
				onChange={view => setZoltarView(view)}
				options={[
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'questions')), label: marketCopy.browseQuestions, value: 'questions' },
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'create')), label: commonCopy.createQuestion, value: 'create' },
					...(showZoltarUniverseWarning ? [] : [{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'fork')), label: marketCopy.forkUniverse, value: 'fork' as const }]),
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'migrate')), label: marketCopy.repMigration, value: 'migrate' as const },
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'universes')), label: commonCopy.universe, value: 'universes' as const },
				]}
			/>
		)
	}
	const transactionRouteKey = route === 'zoltar' ? `${route}:${activeZoltarView}` : route

	return (
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
					showApplicationDeploymentWarning={showApplicationDeploymentWarning}
					zoltarUniverseError={zoltarUniverseError}
				/>
			}
			header={
				<AppHeaderShell
					overview={
						<OverviewPanels
							applicationTitle={zoltarCopy.applicationTitle}
							activeUniverseId={activeUniverseId}
							accountState={accountState}
							isConnectingWallet={isConnectingWallet}
							isManagingWallet={isManagingWallet}
							isLoadingRepPrices={false}
							isRefreshingRepPrices={false}
							isLoadingUniverseRepBalance={loadingZoltarForkAccess}
							onConnect={() => void connectWallet()}
							onChangeWallet={() => void changeWallet()}
							onDisconnectWallet={() => void disconnectWallet()}
							onGoToGenesisUniverse={() => setActiveUniverseId(0n)}
							onRefreshRepPrices={() => undefined}
							onSwitchNetwork={() => void switchNetwork()}
							parentUniverseId={zoltarUniverse?.parentUniverseId}
							repPerEthFailure={undefined}
							repPerEthPrice={undefined}
							repPerEthSource={undefined}
							repPerEthSourceUrl={undefined}
							repUsdcFailure={undefined}
							repUsdcPrice={undefined}
							repUsdcSource={undefined}
							repUsdcSourceUrl={undefined}
							showRepPrices={false}
							readBackendStatus={readBackendStatus}
							universeForkTime={zoltarUniverse?.forkTime}
							universeHasForked={zoltarUniverse?.hasForked}
							universePresentation={universePresentation}
							universeLabel={universeLabel}
							universeRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
							isRefreshing={isRefreshing}
							walletBootstrapComplete={walletBootstrapComplete}
						/>
					}
					simulationController={simulationController}
					subNavigation={routeSubNavigation}
					tabNavigation={tabNavigationProps}
					onEnvironmentChanged={refreshActiveEnvironment}
					onRefresh={refreshSimulationView}
				/>
			}
			routeContentDisabled={isRouteContentDisabled}
			transactionRouteKey={transactionRouteKey}
			transactionState={transactionState.value}
		>
			<AppRouteContent deploy={deployRouteContentProps} zoltar={zoltarRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} />
		</ProtocolAppFrame>
	)
}
