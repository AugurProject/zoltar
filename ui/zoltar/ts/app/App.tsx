import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as marketCopy from '../copy/market.js'
import * as zoltarCopy from '../copy/zoltar.js'
import { useSignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useRef, useState } from 'preact/hooks'
import type { Hash } from '@zoltar/shared/ethereum'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { GlobalTransactionTray } from '@zoltar/ui-core-shared/app/components/GlobalTransactionTray.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { RouteSubNavigation } from '@zoltar/ui-core-shared/app/components/RouteSubNavigation.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useDeploymentFlow } from '../features/deployment/hooks/useDeploymentFlow.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useOnchainState } from '@zoltar/ui-core-shared/app/hooks/useOnchainState.js'
import { useOpenOracleOperations } from '../features/open-oracle/hooks/useOpenOracleOperations.js'
import { useZoltarOperations } from '../features/universes/hooks/useZoltarOperations.js'
import { useRepPrices } from '../features/open-oracle/hooks/useRepPrices.js'
import { useUrlState } from '@zoltar/ui-core-shared/app/hooks/useUrlState.js'
import { getActiveSimulationController, initializeActiveEnvironment, shouldFollowWalletNetwork } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
import { createSupportedNetworkChangeCoordinator } from '@zoltar/ui-core-shared/app/lib/supportedNetworkChange.js'
import { ChainBlockNumberContext, ChainTimestampContext } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '../protocol/index.js'
import { getWethAddress } from '../protocol/uniswapQuoter.js'
import { getDeploymentSections } from '../features/deployment/lib/deployment.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getWalletScopedAccountAddress, isSupportedAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { createInitialTransactionTrayState, getTransactionActionLockReason, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '@zoltar/ui-core-shared/lib/transactionTray.js'
import type { TransactionTrayState } from '@zoltar/ui-core-shared/lib/transactionTray.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import { buildRouteHref, getRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeOpenOracleViewQueryParam, writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../features/universes/lib/universe.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/lib/viewState.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import type { DeploymentRouteContentProps, MarketRouteContentProps, OpenOracleSectionProps, OpenOracleView, ZoltarView } from '../features/types.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '@zoltar/ui-core-shared/types/components.js'

export function App() {
	const transactionState = useSignal<TransactionTrayState>(createInitialTransactionTrayState())
	const deployNextMissingPending = useSignal(false)
	const [activeEnvironmentNonce, setActiveEnvironmentNonce] = useState(0)
	const followSupportedWalletNetwork = shouldFollowWalletNetwork()
	const supportedNetworkChangeCoordinatorRef = useRef<ReturnType<typeof createSupportedNetworkChangeCoordinator>>()
	const supportedNetworkChangeCoordinator =
		supportedNetworkChangeCoordinatorRef.current ??
		createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => transactionState.value.inFlightCount,
			replaceEnvironment: async canCommit => {
				let commitAllowed = false
				await initializeActiveEnvironment(window.location, undefined, {
					shouldCommit: () => {
						commitAllowed = canCommit()
						return commitAllowed
					},
				})
				if (!commitAllowed) return false
				setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
				return true
			},
		})
	supportedNetworkChangeCoordinatorRef.current = supportedNetworkChangeCoordinator
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, openOracleView, setActiveUniverseId, setOpenOracleReport, setOpenOracleView, setZoltarView, zoltarView } = useUrlState()
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', ['questions', 'create', 'fork', 'migrate'])
	const onTransactionRequested = (intent: TransactionIntent) => {
		transactionState.value = markTransactionRequested(transactionState.value, intent)
	}
	const onTransactionPrepared = (preview: TransactionRequestPreview) => {
		transactionState.value = markTransactionPrepared(transactionState.value, preview)
	}
	const onTransactionSubmitted = (hash: Hash) => {
		transactionState.value = markTransactionSubmitted(transactionState.value, hash)
	}
	const onTransactionFailed = (message: string) => {
		transactionState.value = markTransactionFailed(transactionState.value, message)
	}
	const onTransactionCanceled = () => {
		transactionState.value = markTransactionCanceled(transactionState.value)
	}
	const onTransactionPresented = (presentation: GlobalTransactionPresentation) => {
		transactionState.value = markTransactionPresented(transactionState.value, presentation)
	}
	const onTransactionFinished = () => {
		transactionState.value = markTransactionFinished(transactionState.value)
		void supportedNetworkChangeCoordinator.handleTransactionFinished()
	}
	const { navigate, route } = useHashRoute()
	const {
		accountState,
		augurStatoblastDeployed,
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
		{ getDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot, loadErc20Balance },
	)
	const readBackendReady = readBackendValidated && readBackendMessage === undefined
	const canReadOnchainData = environmentReady && readBackendReady && hasLoadedDeploymentStatuses
	const isOnActiveAppChain = isSupportedAppChain(accountState.chainId)
	const walletScopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const baseHookConfig = {
		accountAddress: accountState.address,
		onTransactionCanceled,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
	}
	const walletScopedHookConfig = {
		...baseHookConfig,
		accountAddress: walletScopedAccountAddress,
	}
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
	const {
		approveZoltarForkRep,
		createChildUniverse,
		forkZoltar,
		hasLoadedZoltarQuestions,
		loadZoltarForkAccess,
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
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
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
	const augurStatoblastDeploymentMissing = canReadOnchainData && augurStatoblastDeployed === false
	const showDeployTab = deploymentStatusError !== undefined || augurStatoblastDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const showAugurStatoblastDeploymentWarning = augurStatoblastDeploymentMissing
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = canReadOnchainData && zoltarUniverseState === 'missing'
	const isRouteContentDisabled = route !== 'deploy' && (!readBackendReady || augurStatoblastDeploymentMissing || showZoltarUniverseWarning)
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, ['browse', 'create', 'selected-report'])
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeZoltarView, route })
	useAppRouteEffects({
		augurStatoblastDeploymentMissing,
		environmentReady: canReadOnchainData,
		activeEnvironmentNonce,
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		navigate,
		route,
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
		...(showDeployTab ? [{ hash: getRouteHash('deploy'), label: appCopy.deployContracts, route: 'deploy' }] : []),
		{ hash: getRouteHash('zoltar'), label: marketCopy.questions, route: 'zoltar' },
		{ hash: getRouteHash('open-oracle'), label: appCopy.oracleReports, route: 'open-oracle' },
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
					{ href: buildRouteHref(getRouteHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'questions')), label: marketCopy.browseQuestions, value: 'questions' },
					{ href: buildRouteHref(getRouteHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'fork')), label: marketCopy.forkUniverse, value: 'fork' },
					{
						label: marketCopy.repMigration,
						value: 'migrate',
						disabled: zoltarUniverse?.hasForked !== true,
						...(zoltarUniverse?.hasForked === true ? { href: buildRouteHref(getRouteHash('zoltar'), writeZoltarViewQueryParam(getRouteHashSearch(), 'migrate')) } : { reason: zoltarCopy.migrationNotForkedReason }),
					},
				]}
			/>
		)
	} else if (route === 'open-oracle') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.oracleReportViews}
				value={activeOpenOracleView}
				onChange={view => setOpenOracleView(view)}
				options={[
					{ href: buildRouteHref(getRouteHash('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'browse')), label: appCopy.browseReports, value: 'browse' },
					{ href: buildRouteHref(getRouteHash('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'create')), label: appCopy.createReport, value: 'create' },
					{ href: buildRouteHref(getRouteHash('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'selected-report')), label: appCopy.viewReport, value: 'selected-report' },
				]}
			/>
		)
	}
	const transactionRouteKey = (() => {
		if (route === 'zoltar') return `${route}:${activeZoltarView}`
		if (route === 'open-oracle') return `${route}:${activeOpenOracleView}`
		return route
	})()

	return (
		<ChainBlockNumberContext.Provider value={currentBlockNumber}>
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<main>
					<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />
					<AppStatusNotices
						errorMessages={errorMessages}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onRetryZoltarUniverse={() => void loadZoltarUniverse({ clearCurrentState: false })}
						readBackendMessage={readBackendMessage}
						readBackendStatus={readBackendStatus}
						simulationBootstrapError={environmentBootstrapError}
						showAugurStatoblastDeploymentWarning={showAugurStatoblastDeploymentWarning}
						zoltarUniverseError={zoltarUniverseError}
					/>
					<AppHeaderShell
						overview={
							<OverviewPanels
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
					<GlobalTransactionPresentationProvider transaction={transactionState.value.active}>
						<GlobalTransactionTray routeKey={transactionRouteKey} transaction={transactionState.value.active} />

						<div id='app-content' tabIndex={-1}>
							<TransactionActionButtonLockProvider disabledReason={getTransactionActionLockReason(transactionState.value)}>
								<fieldset className='route-shell' disabled={isRouteContentDisabled}>
									<AppRouteContent deploy={deployRouteContentProps} zoltar={zoltarRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={route} />
								</fieldset>
							</TransactionActionButtonLockProvider>
						</div>
					</GlobalTransactionPresentationProvider>
				</main>
			</ChainTimestampContext.Provider>
		</ChainBlockNumberContext.Provider>
	)
}
