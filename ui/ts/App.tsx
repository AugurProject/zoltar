import { useSignal } from '@preact/signals'
import type { Hash } from 'viem'
import { useEffect } from 'preact/hooks'
import { DeploymentRouteContent } from './components/DeploymentRouteContent.js'
import { MainnetGateSection } from './components/MainnetGateSection.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { MarketSection } from './components/MarketSection.js'
import { NotFoundSection } from './components/NotFoundSection.js'
import { OpenOracleSection } from './components/OpenOracleSection.js'
import { TabNavigation } from './components/TabNavigation.js'
import { SecurityPoolsSection } from './components/SecurityPoolsSection.js'
import { ErrorNotice } from './components/ErrorNotice.js'
import { useDeploymentFlow } from './hooks/useDeploymentFlow.js'
import { useForkAuctionOperations } from './hooks/useForkAuctionOperations.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useMarketCreation } from './hooks/useMarketCreation.js'
import { useOnchainState } from './hooks/useOnchainState.js'
import { useOpenOracleOperations } from './hooks/useOpenOracleOperations.js'
import { usePriceOracleManager } from './hooks/usePriceOracleManager.js'
import { useReportingOperations } from './hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from './hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from './hooks/useSecurityPoolsOverview.js'
import { useRepPrices } from './hooks/useRepPrices.js'
import { useSecurityVaultOperations } from './hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from './hooks/useTradingOperations.js'
import { useUrlState } from './hooks/useUrlState.js'
import { getDeploymentSections } from './lib/deployment.js'
import { resolveLoadableValueState } from './lib/loadState.js'
import { isMainnetChain } from './lib/network.js'
import { getUseQuestionForPoolState } from './lib/securityPoolNavigation.js'
import { createInitialTransactionState, markTransactionFinished, markTransactionRequested, markTransactionSubmitted } from './lib/transactionState.js'
import type { TransactionState } from './lib/transactionState.js'
import { DEPLOY_ROUTE, OPEN_ORACLE_ROUTE, SECURITY_POOLS_ROUTE, ZOLTAR_ROUTE } from './lib/routing.js'
import { getUniversePresentation, getWalletPresentation } from './lib/userCopy.js'
import { formatUniverseCollectionLabel, formatUniverseLabel } from './lib/universe.js'
import { TransactionHashLink } from './components/TransactionHashLink.js'
import { TimestampValue } from './components/TimestampValue.js'

export function App() {
	const transactionState = useSignal<TransactionState>(createInitialTransactionState())
	const deployNextMissingPending = useSignal(false)
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, securityPoolAddress, setActiveUniverseId, setOpenOracleReport, setSecurityPoolAddress } = useUrlState()
	const onTransaction = (hash: Hash) => {
		transactionState.value = {
			...transactionState.value,
			lastTransactionHash: hash,
		}
	}
	const onTransactionRequested = () => {
		transactionState.value = markTransactionRequested(transactionState.value)
	}
	const onTransactionSubmitted = (hash: Hash) => {
		transactionState.value = markTransactionSubmitted(transactionState.value, hash)
	}
	const onTransactionFinished = () => {
		transactionState.value = markTransactionFinished(transactionState.value)
	}
	const { navigate, route } = useHashRoute()
	const { accountState, connectWallet, deploymentStatuses, errorMessage: walletErrorMessage, hasInjectedWallet, hasLoadedDeploymentStatuses, isConnectingWallet, isLoadingDeploymentStatuses, isRefreshing, refreshState, setDeploymentStatuses, walletBootstrapComplete, augurPlaceHolderDeployed } = useOnchainState()
	const baseHookConfig = {
		accountAddress: accountState.address,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
	}
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
	const {
		approveZoltarForkRep,
		createChildUniverse: createZoltarChildUniverse,
		createMarket,
		forkZoltar,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		loadingZoltarQuestionCount,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		loadZoltarQuestions,
		marketCreating,
		marketError,
		marketForm,
		marketResult,
		migrateInternalRep,
		prepareRepForMigration,
		resetMarket,
		setMarketForm,
		setZoltarForkQuestionId,
		setZoltarMigrationForm,
		zoltarChildUniverseError,
		zoltarForkApproval,
		zoltarForkActiveAction,
		zoltarForkError,
		zoltarForkPending,
		zoltarForkQuestionId,
		zoltarForkRepBalance,
		zoltarMigrationChildRepBalances,
		zoltarMigrationActiveAction,
		zoltarMigrationError,
		zoltarMigrationForm,
		zoltarMigrationPending,
		zoltarMigrationPreparedRepBalance,
		zoltarMigrationResult,
		zoltarQuestionCount,
		zoltarQuestions,
		zoltarUniverse,
		zoltarUniverseMissing,
	} = useMarketCreation({ ...baseHookConfig, activeUniverseId, autoLoadInitialData: walletBootstrapComplete, deploymentStatuses })
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
	const { checkingDuplicateOriginPool, createPool, duplicateOriginPoolExists, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, poolCreationMarketDetails, resetSecurityPoolCreation, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } =
		useSecurityPoolCreation({
			...baseHookConfig,
			deploymentStatuses,
			zoltarUniverseHasForked,
		})
	const {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault,
		redeemFees,
		securityVaultActiveAction,
		securityVaultDetails,
		securityVaultError,
		securityVaultForm,
		securityVaultMissing,
		securityVaultRepApproval,
		securityVaultRepBalance,
		securityVaultResult,
		setSecurityBondAllowance,
		setSecurityVaultForm,
		withdrawRep,
	} = useSecurityVaultOperations(baseHookConfig)
	const {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		loadingOpenOracleCreate,
		loadingOracleReport,
		openOracleActiveAction,
		openOracleError,
		openOracleCreateForm,
		openOracleForm,
		openOracleInitialReportState,
		openOracleReportDetails,
		openOracleResult,
		refreshPrice,
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		submitInitialReport,
		wrapWethForInitialReport,
	} = useOpenOracleOperations(baseHookConfig)
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations(baseHookConfig)
	const { loadingPoolOracleManager, loadPoolOracleManager, poolOracleManagerDetails, poolOracleManagerError, poolPriceOracleResult, requestPoolPrice } = usePriceOracleManager(baseHookConfig)
	const {
		checkedSecurityPoolAddress,
		closeLiquidationModal,
		hasLoadedSecurityPools,
		liquidationAmount,
		liquidationManagerAddress,
		liquidationModalOpen,
		liquidationSecurityPoolAddress,
		liquidationTargetVault,
		loadingSecurityPools,
		loadSecurityPools,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPools,
		setLiquidationAmount,
		setLiquidationTargetVault,
	} = useSecurityPoolsOverview(baseHookConfig)
	const { createCompleteSet, loadingTradingDetails, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingDetails, tradingError, tradingForm, tradingResult } = useTradingOperations(baseHookConfig)
	const {
		claimAuctionProceeds,
		createChildUniverse,
		finalizeTruthAuction,
		forkAuctionDetails,
		forkAuctionError,
		forkAuctionForm,
		forkAuctionResult,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails,
		migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		startTruthAuction,
		submitBid,
		withdrawBids,
	} = useForkAuctionOperations(baseHookConfig)
	const { repEthPrice, repEthSource, repEthSourceUrl, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices } = useRepPrices()
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const isMainnet = isMainnetChain(accountState.chainId)
	const wrongNetworkMessage = accountState.address !== undefined && accountState.chainId !== undefined && !isMainnet ? 'Switch to Ethereum mainnet.' : undefined
	const augurPlaceHolderDeploymentMissing = augurPlaceHolderDeployed === false
	const showDeployTab = augurPlaceHolderDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const showAugurPlaceHolderDeploymentWarning = augurPlaceHolderDeploymentMissing
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = zoltarUniverseState === 'missing'
	const showZoltarUniverseForkedWarning = zoltarUniverse?.hasForked === true
	const disableRouteContent = route !== 'deploy' && (augurPlaceHolderDeploymentMissing || showZoltarUniverseWarning)
	const isRouteContentDisabled = transactionState.value.transactionInFlightCount > 0 || disableRouteContent
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const walletPresentation = getWalletPresentation({ accountAddress: accountState.address, hasInjectedWallet, isMainnet })
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const refreshSelectedPoolData = () => {
		if (!walletBootstrapComplete) return
		if (!securityPoolAddress.startsWith('0x') || securityPoolAddress.length !== 42) return
		void loadSecurityPools(securityPoolAddress)
		void loadReporting()
		void loadForkAuction()
	}
	const renderRouteContent = () => {
		if (wrongNetworkMessage !== undefined) {
			return <MainnetGateSection message={wrongNetworkMessage} />
		}

		switch (route) {
			case 'deploy':
				return (
					<DeploymentRouteContent
						accountAddress={accountState.address}
						busyStepId={busyStepId}
						deployNextMissingPending={deployNextMissingPending.value}
						deploymentSections={deploymentSections}
						deploymentStatuses={deploymentStatuses}
						isLoadingDeploymentStatuses={isLoadingDeploymentStatuses}
						isMainnet={isMainnet}
						onDeploy={deployStep}
						onDeployNextMissing={() => void onDeployNextMissing()}
					/>
				)
			case 'zoltar':
				return (
					<MarketSection
						accountState={accountState}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						zoltarForkActiveAction={zoltarForkActiveAction}
						loadingZoltarQuestionCount={loadingZoltarQuestionCount}
						loadingZoltarQuestions={loadingZoltarQuestions}
						loadingZoltarUniverse={loadingZoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
						onCreateChildUniverseForOutcomeIndex={outcomeIndex => void createZoltarChildUniverse(outcomeIndex)}
						marketForm={marketForm}
						marketCreating={marketCreating}
						marketError={marketError}
						marketResult={marketResult}
						onApproveZoltarForkRep={amount => void approveZoltarForkRep(amount)}
						onCreateMarket={() => void createMarket()}
						onForkZoltar={() => void forkZoltar()}
						onLoadZoltarQuestions={() => void loadZoltarQuestions()}
						onMigrateInternalRep={() => void migrateInternalRep()}
						onMarketFormChange={update => setMarketForm(current => ({ ...current, ...update }))}
						onPrepareRepForMigration={() => void prepareRepForMigration()}
						onResetMarket={resetMarket}
						onUseQuestionForFork={questionId => setZoltarForkQuestionId(questionId)}
						onUseQuestionForPool={onUseQuestionForPool}
						onZoltarMigrationFormChange={update => setZoltarMigrationForm(current => ({ ...current, ...update }))}
						zoltarQuestionCount={zoltarQuestionCount}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkError={zoltarForkError}
						zoltarChildUniverseError={zoltarChildUniverseError}
						zoltarForkPending={zoltarForkPending}
						zoltarForkQuestionId={zoltarForkQuestionId}
						zoltarForkRepBalance={zoltarForkRepBalance}
						zoltarMigrationError={zoltarMigrationError}
						zoltarMigrationForm={zoltarMigrationForm}
						zoltarMigrationChildRepBalances={zoltarMigrationChildRepBalances}
						zoltarMigrationActiveAction={zoltarMigrationActiveAction}
						zoltarMigrationPending={zoltarMigrationPending}
						zoltarMigrationPreparedRepBalance={zoltarMigrationPreparedRepBalance}
						zoltarMigrationResult={zoltarMigrationResult}
						zoltarQuestions={zoltarQuestions}
						zoltarUniverse={zoltarUniverse}
						onZoltarForkQuestionIdChange={questionId => setZoltarForkQuestionId(questionId)}
					/>
				)
			case 'security-pools':
				return (
					<SecurityPoolsSection
						createPool={{
							accountState,
							checkingDuplicateOriginPool,
							duplicateOriginPoolExists,
							poolCreationMarketDetails,
							onCreateSecurityPool: () => void createPool(),
							onLoadMarket: () => void loadMarket(),
							onLoadMarketById: loadMarketById,
							loadingMarketDetails,
							marketDetails,
							onResetSecurityPoolCreation: resetSecurityPoolCreation,
							onSecurityPoolFormChange: update => setSecurityPoolForm(current => ({ ...current, ...update })),
							zoltarUniverseHasForked,
							securityPools,
							securityPoolCreating,
							securityPoolError,
							securityPoolForm,
							securityPoolResult,
						}}
						overview={{
							accountState,
							checkedSecurityPoolAddress,
							closeLiquidationModal: () => closeLiquidationModal(),
							hasLoadedSecurityPools,
							liquidationAmount,
							liquidationManagerAddress,
							liquidationModalOpen,
							liquidationSecurityPoolAddress,
							liquidationTargetVault,
							loadingSecurityPools,
							onLiquidationAmountChange: setLiquidationAmount,
							onLiquidationTargetVaultChange: setLiquidationTargetVault,
							onOpenLiquidationModal: (managerAddress, securityPoolAddress, vaultAddress) => openLiquidationModal(managerAddress, securityPoolAddress, vaultAddress),
							onLoadSecurityPools: () => void loadSecurityPools(),
							onQueueLiquidation: (managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress),
							securityPoolOverviewError,
							securityPoolOverviewResult,
							securityPools,
						}}
						workflow={{
							accountState,
							activeUniverseId,
							checkedSecurityPoolAddress,
							closeLiquidationModal: () => closeLiquidationModal(),
							forkAuction: {
								accountState,
								forkAuctionDetails,
								forkAuctionError,
								forkAuctionForm,
								forkAuctionResult,
								loadingForkAuctionDetails,
								onClaimAuctionProceeds: () => void claimAuctionProceeds(),
								onCreateChildUniverse: () => void createChildUniverse(forkAuctionForm.selectedOutcome),
								onFinalizeTruthAuction: () => void finalizeTruthAuction(),
								onForkAuctionFormChange: update => setForkAuctionForm(current => ({ ...current, ...update })),
								onForkUniverse: () => void forkUniverse(),
								onForkWithOwnEscalation: () => void forkWithOwnEscalation(),
								onInitiateFork: () => void initiateFork(),
								onLoadForkAuction: () => void loadForkAuction(),
								onMigrateEscalationDeposits: () => void migrateEscalation(),
								onMigrateRepToZoltar: () => void migrateRepToZoltar(),
								onMigrateVault: () => void migrateVault(),
								onRefundLosingBids: () => void refundLosingBids(),
								onStartTruthAuction: () => void startTruthAuction(),
								onSubmitBid: () => void submitBid(),
								onWithdrawBids: () => void withdrawBids(),
							},
							liquidationAmount,
							liquidationManagerAddress,
							liquidationModalOpen,
							liquidationSecurityPoolAddress,
							liquidationTargetVault,
							onLiquidationAmountChange: setLiquidationAmount,
							onLiquidationTargetVaultChange: setLiquidationTargetVault,
							onOpenLiquidationModal: (managerAddress, securityPoolAddress, vaultAddress) => openLiquidationModal(managerAddress, securityPoolAddress, vaultAddress),
							onQueueLiquidation: (managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress),
							loadingPoolOracleManager,
							loadingSecurityPools,
							onLoadPoolOracleManager: managerAddress => void loadPoolOracleManager(managerAddress),
							onRequestPoolPrice: managerAddress => void requestPoolPrice(managerAddress),
							onRefreshSelectedPoolData: refreshSelectedPoolData,
							onViewPendingReport: reportId => {
								setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
								navigate('open-oracle')
								void loadOracleReport(reportId.toString())
							},
							poolOracleManagerDetails,
							poolOracleManagerError,
							poolPriceOracleResult,
							onSecurityPoolAddressChange: value => {
								setSecurityPoolAddress(value)
							},
							reporting: {
								accountState,
								loadingReportingDetails,
								onLoadReporting: () => void loadReporting(),
								onReportOutcome: () => void onReportOutcome(),
								onReportingFormChange: update => setReportingForm(current => ({ ...current, ...update })),
								onWithdrawEscalation: () => void withdrawEscalation(),
								reportingDetails,
								reportingError,
								reportingForm,
								reportingResult,
							},
							securityPoolAddress,
							securityPools,
							securityVault: {
								accountState,
								loadingSecurityVault,
								onApproveRep: amount => void approveRep(amount),
								onDepositRep: () => void depositRep(),
								onLoadSecurityVault: vaultAddress => void loadSecurityVault(vaultAddress),
								onRedeemFees: () => void redeemFees(),
								onSetSecurityBondAllowance: () => void setSecurityBondAllowance(),
								onSecurityVaultFormChange: update => setSecurityVaultForm(current => ({ ...current, ...update })),
								onWithdrawRep: () => void withdrawRep(),
								securityVaultActiveAction,
								securityVaultDetails,
								securityVaultError,
								securityVaultForm,
								securityVaultMissing,
								securityVaultRepApproval,
								securityVaultRepBalance,
								securityVaultResult,
								securityPoolVaults: selectedPool?.vaults,
							},
							trading: {
								accountState,
								loadingTradingDetails,
								onCreateCompleteSet: () => void createCompleteSet(),
								onMigrateShares: () => void migrateShares(),
								onRedeemCompleteSet: () => void redeemCompleteSet(),
								onRedeemShares: () => void redeemShares(),
								onTradingFormChange: update => setTradingForm(current => ({ ...current, ...update })),
								selectedPool,
								tradingDetails,
								tradingError,
								tradingForm,
								tradingResult,
							},
						}}
					/>
				)
			case 'open-oracle':
				return (
					<OpenOracleSection
						accountState={accountState}
						initialView={urlOpenOracleReportId === '' && openOracleForm.reportId === '' ? 'browse' : 'selected-report'}
						loadingOracleReport={loadingOracleReport}
						onApproveToken1={amount => void approveToken1(amount)}
						onApproveToken2={amount => void approveToken2(amount)}
						onCreateOpenOracleGame={() => void createOpenOracleGame()}
						onDisputeReport={() => void disputeReport()}
						onLoadOracleReport={reportId => void loadOracleReport(reportId)}
						onRefreshPrice={refreshPrice}
						onOpenOracleCreateFormChange={update => setOpenOracleCreateForm(current => ({ ...current, ...update }))}
						onOpenOracleFormChange={update => setOpenOracleForm(current => ({ ...current, ...update }))}
						onSettleReport={() => void settleReport()}
						onSubmitInitialReport={() => void submitInitialReport()}
						onWrapWethForInitialReport={() => void wrapWethForInitialReport()}
						loadingOpenOracleCreate={loadingOpenOracleCreate}
						openOracleActiveAction={openOracleActiveAction}
						openOracleError={openOracleError}
						openOracleCreateForm={openOracleCreateForm}
						openOracleForm={openOracleForm}
						openOracleInitialReportState={openOracleInitialReportState}
						openOracleReportDetails={openOracleReportDetails}
						openOracleResult={openOracleResult}
					/>
				)
			case 'not-found':
				return <NotFoundSection />
			default:
				return <NotFoundSection />
		}
	}

	useEffect(() => {
		if (urlOpenOracleReportId === '') return
		void loadOracleReport(urlOpenOracleReportId)
	}, [urlOpenOracleReportId])

	useEffect(() => {
		if (openOracleReportDetails !== undefined) {
			setOpenOracleReport(openOracleReportDetails.reportId.toString())
			return
		}
		if (openOracleForm.reportId.trim() !== '') {
			setOpenOracleReport(openOracleForm.reportId)
			return
		}
		setOpenOracleReport(undefined)
	}, [openOracleForm.reportId, openOracleReportDetails])

	useEffect(() => {
		setSecurityVaultForm(current => (current.securityPoolAddress === securityPoolAddress ? current : { ...current, securityPoolAddress }))
		setTradingForm(current => (current.securityPoolAddress === securityPoolAddress ? current : { ...current, securityPoolAddress }))
		setForkAuctionForm(current => (current.securityPoolAddress === securityPoolAddress ? current : { ...current, securityPoolAddress }))
		setReportingForm(current => (current.securityPoolAddress === securityPoolAddress ? current : { ...current, securityPoolAddress }))
		refreshSelectedPoolData()
	}, [securityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (securityPoolResult === undefined) return
		void loadSecurityPools()
	}, [securityPoolResult?.deployPoolHash])

	useEffect(() => {
		if (tradingResult === undefined) return
		refreshSelectedPoolData()
	}, [tradingResult?.hash])

	useEffect(() => {
		if (!augurPlaceHolderDeploymentMissing) return
		if (route === 'deploy') return
		navigate('deploy')
	}, [navigate, route, augurPlaceHolderDeploymentMissing])

	const onDeployNextMissing = async () => {
		if (deployNextMissingPending.value) return
		deployNextMissingPending.value = true
		try {
			await deployNextMissing()
		} finally {
			deployNextMissingPending.value = false
		}
	}

	const onUseQuestionForPool = (questionId: string) => {
		const { marketId, securityPoolAddress } = getUseQuestionForPoolState(questionId)
		setSecurityPoolForm(current => ({
			...current,
			marketId,
		}))
		setSecurityPoolAddress(securityPoolAddress)
		navigate('security-pools')
	}

	return (
		<main>
			<div className='page-notices'>
				{showZoltarUniverseForkedWarning && zoltarUniverse !== undefined ? (
					<div className='notice error'>
						{formatUniverseLabel(zoltarUniverse.universeId)} has forked on <TimestampValue timestamp={zoltarUniverse.forkTime} />.
					</div>
				) : undefined}
				{showAugurPlaceHolderDeploymentWarning ? <div className='notice error'>Finish setup in Deploy before using the app.</div> : undefined}
				{walletPresentation === undefined || hasInjectedWallet ? undefined : <p className='notice warning'>{walletPresentation.detail}</p>}
				<ErrorNotice message={errorMessage} />
				{transactionState.value.transactionInFlightCount > 0 ? (
					<p className='notice success'>
						<span className='spinner' aria-hidden='true' />
						{transactionState.value.transactionSubmitted ? (
							<>Transaction submitted, waiting for confirmation. {transactionState.value.lastTransactionHash === undefined ? <span>Pending wallet signature</span> : <TransactionHashLink hash={transactionState.value.lastTransactionHash} />}</>
						) : (
							'Awaiting wallet confirmation.'
						)}
					</p>
				) : transactionState.value.lastTransactionHash === undefined ? undefined : (
					<p className='notice success'>
						Last transaction: <TransactionHashLink hash={transactionState.value.lastTransactionHash} />
					</p>
				)}
			</div>
			<div className='top-shell'>
				<div className='top-shell-content'>
					<OverviewPanels
						accountState={accountState}
						isConnectingWallet={isConnectingWallet}
						isLoadingRepPrices={isLoadingRepPrices}
						isLoadingUniverseRepBalance={loadingZoltarForkAccess}
						onConnect={() => void connectWallet()}
						onGoToGenesisUniverse={() => setActiveUniverseId(0n)}
						repEthPrice={repEthPrice}
						repEthSource={repEthSource}
						repEthSourceUrl={repEthSourceUrl}
						repUsdcPrice={repUsdcPrice}
						repUsdcSource={repUsdcSource}
						repUsdcSourceUrl={repUsdcSourceUrl}
						universePresentation={universePresentation}
						universeLabel={universeLabel}
						universeRepBalance={zoltarForkRepBalance}
						isRefreshing={isRefreshing}
						walletBootstrapComplete={walletBootstrapComplete}
					/>
				</div>
				<TabNavigation
					route={route}
					showDeployTab={showDeployTab}
					augurPlaceHolderDeployed={hasLoadedDeploymentStatuses && augurPlaceHolderDeployed === true && !showZoltarUniverseWarning}
					deployRoute={DEPLOY_ROUTE}
					marketRoute={ZOLTAR_ROUTE}
					openOracleRoute={OPEN_ORACLE_ROUTE}
					securityPoolsRoute={SECURITY_POOLS_ROUTE}
					onRouteChange={navigate}
				/>
			</div>

			<fieldset className='route-shell' disabled={isRouteContentDisabled}>
				{renderRouteContent()}
			</fieldset>
		</main>
	)
}
