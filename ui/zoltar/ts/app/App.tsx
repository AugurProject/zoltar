import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar-shared/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { useEffect } from 'preact/hooks'
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
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import type { MarketRouteContentProps, ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { Route } from '@zoltar/ui-zoltar-shared/types/app.js'
import { isUniverseIndependentZoltarView, zoltarRouting } from '@zoltar/ui-zoltar-shared/lib/routing.js'
import { hasInvalidZoltarView, ZOLTAR_VIEWS } from './lib/routeValidation.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'

export function App() {
	const { activeUniverseId, replaceZoltarView, setActiveUniverseId, setZoltarView, zoltarView } = useZoltarUrlState()
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'zoltar', 'not-found'])
	const invalidZoltarView = hasInvalidZoltarView({ resolvedRoute, search: parseRouteHash(window.location.hash).search, zoltarView })
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', ZOLTAR_VIEWS)
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
	const {
		approveZoltarForkRep,
		createChildUniverse,
		forkZoltar,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		loadZoltarForkAccess,
		loadingZoltarQuestionCount,
		loadingZoltarQuestion,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		loadZoltarQuestionPage,
		loadZoltarQuestion,
		loadZoltarQuestions,
		loadZoltarUniverse,
		migrateInternalRep,
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
		zoltarMigrationChildSplitAmountsAttoRep,
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
	} = useQuestionCreation({ ...walletScopedHookConfig, activeUniverseId, autoLoadInitialData: walletBootstrapComplete && canReadOnchainData, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce })
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = canReadOnchainData && zoltarUniverseState === 'missing'
	const activeViewRequiresUniverse = !isUniverseIndependentZoltarView(activeZoltarView)
	const isRouteContentDisabled = routeContentBlocked || (route !== 'deploy' && activeViewRequiresUniverse && showZoltarUniverseWarning)
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
		onRetryMigrationBalances: () => void loadZoltarForkAccess(),
		onMigrateInternalRep: maxPreparationAttoRep => void migrateInternalRep(maxPreparationAttoRep),
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
		zoltarMigrationChildSplitAmountsAttoRep,
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
	const deploymentTab: RouteTabDefinition = { hash: zoltarRouting.getHash('deploy'), label: appCopy.deployContracts, route: 'deploy' }
	const tabNavigationProps = {
		route,
		tabs: withDeploymentTab({ deploymentTab, deploymentIncomplete: showDeployTab, route, tabs: [{ hash: zoltarRouting.getHash('zoltar'), label: commonCopy.zoltar, route: 'zoltar' }] }),
		onRouteChange: navigate,
		showProtocolGuide: false,
	}
	const zoltarViewNavigation = createSecondaryNavigation<ZoltarView>({
		ariaLabel: appCopy.zoltarViews,
		value: activeZoltarView,
		onChange: view => setZoltarView(view),
		options: [
			{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'questions')), label: marketCopy.browseQuestions, value: 'questions' },
			{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'create')), label: commonCopy.createQuestion, value: 'create' },
			{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'universes')), label: commonCopy.universe, value: 'universes' },
		],
	})
	const secondaryNavigation = resolveSecondaryNavigation({ route: activeRoute, secondaryByRoute: { zoltar: zoltarViewNavigation } })
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
			routeContentDisabled={isRouteContentDisabled}
			transactionRouteKey={transactionRouteKey}
			transactionState={transactionState.value}
		>
			<AppRouteContent deploy={deployRouteContentProps} zoltar={zoltarRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} />
		</ProtocolAppFrame>
	)
}
