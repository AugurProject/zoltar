import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as marketCopy from '../copy/market.js'
import * as zoltarCopy from '../copy/zoltar.js'
import { useSignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { RouteSubNavigation } from '@zoltar/ui-core-shared/app/components/RouteSubNavigation.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useDeploymentFlow } from '../features/deployment/hooks/useDeploymentFlow.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useOnchainState } from '@zoltar/ui-core-shared/app/hooks/useOnchainState.js'
import { buildProtocolHookConfigs, useProtocolAppRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolAppRuntime.js'
import { useOpenOracleOperations } from '../features/open-oracle/hooks/useOpenOracleOperations.js'
import { getOpenOracleViewOptions } from '../features/open-oracle/lib/openOracleNavigation.js'
import { useZoltarOperations } from '../features/universes/hooks/useZoltarOperations.js'
import { useRepPrices } from '../features/open-oracle/hooks/useRepPrices.js'
import { useUrlState } from '@zoltar/ui-core-shared/app/hooks/useUrlState.js'
import { getActiveSimulationController, initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { getDeploymentSections } from '../features/deployment/lib/deployment.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getWalletScopedAccountAddress, isSupportedAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../features/universes/lib/universe.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/lib/viewState.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import type { DeploymentRouteContentProps, MarketRouteContentProps, OpenOracleSectionProps, OpenOracleView, ZoltarView } from '../features/types.js'
import type { Route } from '../types/app.js'
import { zoltarRouting } from '../lib/routing.js'

export function App() {
	const deployNextMissingPending = useSignal(false)
	const { activeEnvironmentNonce, followSupportedWalletNetwork, setActiveEnvironmentNonce, supportedNetworkChangeCoordinator, transactionTray } = useProtocolAppRuntime({
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
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, openOracleView, setActiveUniverseId, setOpenOracleReport, setOpenOracleView, setZoltarView, zoltarView } = useUrlState()
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', ['questions', 'create', 'fork', 'migrate'])
	const { navigate, route } = useHashRoute()
	const activeRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'zoltar', 'open-oracle', 'not-found'])
	const {
		accountState,
		applicationDeploymentComplete,
		changeWallet,
		chainClockError,
		connectWallet,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatusError,
		deploymentStatuses,
		environmentBootstrapError,
		environmentReady,
		errorMessages: onchainErrorMessages,
		readBackendMessage,
		readBackendValidated,
		readBackendStatus,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isManagingWallet,
		isLoadingDeploymentStatuses,
		isRefreshing,
		refreshState,
		setDeploymentStatuses,
		disconnectWallet,
		switchNetwork,
		walletBootstrapComplete,
	} = useOnchainState(
		{
			activeEnvironmentNonce,
			enableChainClock: route !== 'deploy',
			...(followSupportedWalletNetwork ? { onSupportedNetworkChange: () => void supportedNetworkChangeCoordinator.handleSupportedNetworkChange() } : {}),
		},
		onchainStateDependencies,
	)
	const readBackendReady = readBackendValidated && readBackendMessage === undefined
	const canReadOnchainData = environmentReady && readBackendReady && hasLoadedDeploymentStatuses
	const isOnActiveAppChain = isSupportedAppChain(accountState.chainId)
	const walletScopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const { baseHookConfig, walletScopedHookConfig } = buildProtocolHookConfigs({ accountAddress: accountState.address, walletScopedAccountAddress, refreshState, transactionTray })
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
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
	} = useZoltarOperations({ ...walletScopedHookConfig, activeUniverseId, activeZoltarView, autoLoadInitialData: walletBootstrapComplete && canReadOnchainData, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce })
	const {
		approveToken1,
		approveToken2,
		cancelWithdrawalBalanceCheck,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		loadingOpenOracleCreate,
		openOracleActiveAction,
		openOracleActiveWithdrawalBalance,
		openOracleCreateForm,
		openOracleCreateFieldErrors,
		openOracleDisputeSubmission,
		openOracleError,
		openOracleForm,
		openOracleReportLookupState,
		openOracleTokenAccessState,
		openOracleReportDetails,
		openOracleResult,
		openOracleWithdrawalBalanceChecking,
		openOracleWithdrawalReviewMessage,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		openOracleWithdrawableBalancesLoading,
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		withdrawBalance,
	} = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: route === 'open-oracle' && canReadOnchainData,
	})
	const { repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, isRefreshingRepPrices, refreshRepPrices } = useRepPrices()
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
		refreshRepPrices()
	}
	const refreshActiveEnvironment = async () => {
		await initializeActiveEnvironment()
		setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
		await refreshSimulationView()
	}
	const deploymentSections = getDeploymentSections(deploymentStatuses)
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
	const isRouteContentDisabled = route !== 'deploy' && (!readBackendReady || applicationDeploymentMissing || showZoltarUniverseWarning)
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, ['browse', 'create', 'selected-report'])
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeZoltarView, route: activeRoute })
	useAppRouteEffects({
		applicationDeploymentMissing,
		environmentReady: canReadOnchainData,
		activeEnvironmentNonce,
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		navigate,
		route: activeRoute,
		setOpenOracleFormReportId: reportId => setOpenOracleForm(current => ({ ...current, reportId })),
		urlOpenOracleReportId,
	})
	const onDeployNextMissing = async () => {
		if (deployNextMissingPending.value) return
		deployNextMissingPending.value = true
		try {
			await deployNextMissing()
		} finally {
			deployNextMissingPending.value = false
		}
	}
	const deployRouteContentProps: DeploymentRouteContentProps = {
		accountAddress: accountState.address,
		busyStepId,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deployNextMissingPending: deployNextMissingPending.value,
		deploymentSections,
		deploymentStatuses,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		onDeploy: deployStep,
		onDeployNextMissing: () => void onDeployNextMissing(),
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
	}
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
		onForkZoltar: () => void forkZoltar(),
		onLoadZoltarQuestion: async questionId => await loadZoltarQuestion(questionId),
		onLoadZoltarQuestionPage: async (pageIndex, pageSize) => await loadZoltarQuestionPage(pageIndex, pageSize),
		onLoadZoltarQuestions: async () => await loadZoltarQuestions(),
		onMigrateInternalRep: () => void migrateInternalRep(),
		onPrepareRepForMigration: () => void prepareRepForMigration(),
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
	}
	const openOracleRouteContentProps: OpenOracleSectionProps = {
		activeView: activeOpenOracleView,
		accountState,
		environmentReady: canReadOnchainData,
		environmentRefreshKey: activeEnvironmentNonce,
		onApproveToken1: amount => void approveToken1(amount),
		onApproveToken2: amount => void approveToken2(amount),
		onCancelOpenOracleWithdrawalBalanceCheck: cancelWithdrawalBalanceCheck,
		onCreateOpenOracleGame: () => void createOpenOracleGame(),
		onDisputeReport: () => void disputeReport(),
		onLoadOracleReport: reportId => {
			if (reportId === undefined) return
			void loadOracleReport(reportId)
		},
		onActiveViewChange: view => setOpenOracleView(view),
		onOpenOracleCreateFormChange: update => setOpenOracleCreateForm(current => ({ ...current, ...update })),
		onOpenOracleFormChange: update => {
			setOpenOracleForm(current => ({ ...current, ...update }))
			if (update.reportId !== undefined) setOpenOracleReport(update.reportId)
		},
		onSettleReport: () => void settleReport(),
		onWithdrawOpenOracleBalance: (balance, reviewedAmount) => void withdrawBalance(balance, reviewedAmount),
		loadingOpenOracleCreate,
		openOracleActiveAction,
		openOracleActiveWithdrawalBalance,
		openOracleError,
		openOracleCreateForm,
		openOracleCreateFieldErrors,
		openOracleDisputeSubmission,
		openOracleForm,
		openOracleReportLookupState,
		openOracleTokenAccessState,
		openOracleReportDetails,
		openOracleResult,
		openOracleWithdrawalBalanceChecking,
		openOracleWithdrawalReviewMessage,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		openOracleWithdrawableBalancesLoading,
	}
	const tabNavigationTabs: RouteTabDefinition[] = [
		...(showDeployTab ? [{ hash: zoltarRouting.getHash('deploy'), label: appCopy.deployContracts, route: 'deploy' }] : []),
		{ hash: zoltarRouting.getHash('zoltar'), label: marketCopy.questions, route: 'zoltar' },
		{ hash: zoltarRouting.getHash('open-oracle'), label: appCopy.oracleReports, route: 'open-oracle' },
	]
	const tabNavigationProps = {
		route,
		tabs: tabNavigationTabs,
		onRouteChange: navigate,
	}
	let routeSubNavigation: ComponentChildren = undefined
	if (route === 'zoltar') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.zoltarViews}
				value={activeZoltarView}
				onChange={view => setZoltarView(view)}
				options={[
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'questions')), label: marketCopy.browseQuestions, value: 'questions' },
					{ href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'fork')), label: marketCopy.forkUniverse, value: 'fork' },
					{
						label: marketCopy.repMigration,
						value: 'migrate',
						disabled: zoltarUniverse?.hasForked !== true,
						...(zoltarUniverse?.hasForked === true ? { href: buildRouteHref(zoltarRouting.getHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'migrate')) } : { reason: zoltarCopy.migrationNotForkedReason }),
					},
				]}
			/>
		)
	} else if (route === 'open-oracle') {
		routeSubNavigation = <RouteSubNavigation ariaLabel={appCopy.oracleReportViews} value={activeOpenOracleView} onChange={view => setOpenOracleView(view)} options={getOpenOracleViewOptions(zoltarRouting.getHash('open-oracle'), getRouteHashSearch())} />
	}
	const transactionRouteKey = (() => {
		if (route === 'zoltar') return `${route}:${activeZoltarView}`
		if (route === 'open-oracle') return `${route}:${activeOpenOracleView}`
		return route
	})()

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
							isLoadingRepPrices={isLoadingRepPrices}
							isRefreshingRepPrices={isRefreshingRepPrices}
							isLoadingUniverseRepBalance={loadingZoltarForkAccess}
							onConnect={() => void connectWallet()}
							onChangeWallet={() => void changeWallet()}
							onDisconnectWallet={() => void disconnectWallet()}
							onGoToGenesisUniverse={() => setActiveUniverseId(0n)}
							onRefreshRepPrices={refreshRepPrices}
							onSwitchNetwork={() => void switchNetwork()}
							parentUniverseId={zoltarUniverse?.parentUniverseId}
							repPerEthFailure={repPerEthFailure}
							repPerEthPrice={repPerEthPrice}
							repPerEthSource={repPerEthSource}
							repPerEthSourceUrl={repPerEthSourceUrl}
							repUsdcFailure={repUsdcFailure}
							repUsdcPrice={repUsdcPrice}
							repUsdcSource={repUsdcSource}
							repUsdcSourceUrl={repUsdcSourceUrl}
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
			<AppRouteContent deploy={deployRouteContentProps} zoltar={zoltarRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} />
		</ProtocolAppFrame>
	)
}
