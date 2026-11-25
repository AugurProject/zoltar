import { openHistory } from './lib/watchlistHistory.js'
import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/statoblastShell.js'
import type { RegisterStatoblastPageRefresh, ReportStatoblastReadStatus } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import { createActiveEnvironmentGuard, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { localEntityScopeForNetwork, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { hasInvalidUniverseQueryParam, readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { getCurrentRouteHash, getRouteHashSearch, getTopLevelRouteSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { useUrlSearchState } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { UniverseNamesProvider } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { getStatoblastDeploymentSections } from '@zoltar/ui-statoblast-shared/features/deployment/deploymentSections.js'
import { parseStatoblastPage, statoblastPageHref } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { initializeStatoblastActiveEnvironment } from './activeEnvironment.js'
import { applicationTitle, formatAppDocumentTitle, getAppPageTitle } from './lib/appPageTitle.js'
import { getStatoblastUniversePresentation } from './lib/overviewUniverse.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { StatoblastUniverseMenu } from './components/StatoblastUniverseMenu.js'
import { StatoblastReadFailure } from './components/StatoblastReadFailure.js'

const autoRefreshKey = 'zoltar-ui:statoblast:auto-refresh'

function readPreference(key: string) {
	try {
		return getBrowserStorage('localStorage')?.getItem(key) ?? undefined
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		return undefined
	}
}

function savePreference(key: string, value: string) {
	try {
		getBrowserStorage('localStorage')?.setItem(key, value)
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
	}
}

function readPage(search: string, routeHash: string) {
	const pageSearch = window.location.search
	const malformedUniverse = hasInvalidUniverseQueryParam(search) || hasInvalidUniverseQueryParam(pageSearch)
	const parsed = parseStatoblastPage(`${routeHash}${search}`)
	let page = parsed
	if (malformedUniverse) page = { kind: 'not-found' }
	else if (parsed.kind === 'choose-universe') page = { kind: 'watchlist' }
	return { page, openDepositSearch: new URLSearchParams(search).get('locate') === '1', activeUniverseId: readUniverseQueryParam(search) ?? readUniverseQueryParam(pageSearch) ?? 0n }
}

export function App() {
	const {
		state: { page, activeUniverseId, openDepositSearch },
		navigate,
	} = useUrlSearchState(readPage)
	const [autoRefresh, setAutoRefresh] = useState(() => readPreference(autoRefreshKey) === 'on')
	const [universeMenuOpen, setUniverseMenuOpen] = useState(false)
	const [committedBranch, setCommittedBranch] = useState<string>()
	const [refreshingPage, setRefreshingPage] = useState(false)
	const [readStatus, setReadStatus] = useState<{ scope: string; readAt: number | undefined; progress: string | undefined }>()
	const settingsTriggerId = useId()
	const pageRefreshInFlight = useRef(false)
	const currentPageRefresh = useRef(new Set<() => Promise<unknown>>())
	const registerPageRefresh = useCallback<RegisterStatoblastPageRefresh>(refresh => {
		currentPageRefresh.current.add(refresh)
		return () => {
			currentPageRefresh.current.delete(refresh)
		}
	}, [])
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
		refreshCurrentBlock,
		simulationController,
		transactionTray,
		walletBootstrapComplete,
		walletScopedAccountAddress,
		walletScopedHookConfig,
	} = useProtocolAppShell({
		deploymentRoute: {
			deploymentCompleteHref: statoblastPageHref({ kind: 'watchlist' }),
			deploymentCompleteLabel: pageCopy.openWatchlist,
			getSections: getStatoblastDeploymentSections,
		},
		initializeEnvironment: options => initializeStatoblastActiveEnvironment(window.location, options),
		isDeploymentRoute: false,
		autoRefreshChainClock: autoRefresh,
		onchainStateDependencies,
	})
	const repPrices = useRepPrices({ enabled: canReadOnchainData, headerOnly: true })
	const includeRelatedUniverses = universeMenuOpen || page.kind === 'migrate-rep' || (page.kind === 'pool' && page.tab === 'fork')
	const operations = useMarketCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		autoLoadInitialData: walletBootstrapComplete && canReadOnchainData && page.kind !== 'choose-universe',
		includeRelatedUniverses,
		deploymentStatuses,
		environmentRefreshKey: activeEnvironmentNonce,
	})
	const profile = getActiveNetworkProfile()
	const transactionEnvironment = createActiveEnvironmentGuard()
	const saveTouchedItem = {
		...walletScopedHookConfig,
		refreshState: async () => {
			await refreshWalletStateOnly(walletScopedHookConfig.refreshState)
			invalidateAppData()
		},
		onTransactionSubmitted: (...submission: Parameters<typeof walletScopedHookConfig.onTransactionSubmitted>) => {
			if (transactionEnvironment.isCurrent()) {
				if (page.kind === 'pool') setEntityFavorite(localEntityScopeForNetwork(profile, 'statoblast', 'pool'), page.pool, true)
				if (page.kind === 'question') setEntityFavorite(localEntityScopeForNetwork(profile, 'statoblast', 'question'), `${page.pool}:${formatQuestionIdHex(page.questionId)}`, true)
			}
			walletScopedHookConfig.onTransactionSubmitted(...submission)
		},
	}
	const { zoltarUniverse, zoltarUniverseError } = operations
	const enabled = canReadOnchainData && walletBootstrapComplete
	useBlockRefresh(() => void repPrices.refreshRepPrices(), enabled)
	const selectedUniverse = zoltarUniverse?.universeId === activeUniverseId ? zoltarUniverse : undefined
	const watchlistHref = statoblastPageHref({ kind: 'watchlist' })
	const forked = selectedUniverse?.hasForked === true
	const refreshPage = async () => {
		if (pageRefreshInFlight.current || !enabled) return
		pageRefreshInFlight.current = true
		setRefreshingPage(true)
		try {
			const refreshPrice = repPrices.refreshRepPrices()
			if (currentPageRefresh.current.size > 0) await Promise.all([...currentPageRefresh.current].map(refresh => refresh()))
			else {
				await refreshCurrentBlock()
				if (page.kind === 'migrate-rep') await operations.loadZoltarUniverse({ clearCurrentState: false })
			}
			await refreshPrice
		} finally {
			pageRefreshInFlight.current = false
			setRefreshingPage(false)
		}
	}
	const refreshVisiblePage = useRef(refreshPage)
	refreshVisiblePage.current = refreshPage
	useEffect(() => {
		const refreshWhenVisible = () => {
			if (!document.hidden) void refreshVisiblePage.current()
		}
		document.addEventListener('visibilitychange', refreshWhenVisible)
		return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
	}, [])
	const setUniverse = (universeId: bigint) => navigate(getCurrentRouteHash(), writeUniverseQueryParam(getRouteHashSearch(), universeId))
	useEffect(() => {
		const hash = getCurrentRouteHash()
		if (hash === '#/' || hash === '') navigate('#/watchlist', getTopLevelRouteSearch('watchlist'), 'replace')
	}, [navigate])
	const autoRefreshToggle = (className: string) => (
		<label className={className}>
			<input
				type='checkbox'
				checked={autoRefresh}
				onChange={event => {
					const checked = event.currentTarget.checked
					setAutoRefresh(checked)
					savePreference(autoRefreshKey, checked ? 'on' : 'off')
				}}
			/>
			{pageCopy.autoRefresh}
		</label>
	)
	const overview = getStatoblastUniversePresentation({ canReadOnchainData, ...operations })
	const branchScope = page.kind === 'pool' && walletScopedAccountAddress !== undefined ? `statoblast:branch:v2:${profile.id}:${profile.chainIdHex}:${profile.genesisRepTokenAddress}:${page.pool}:${activeUniverseId}:${walletScopedAccountAddress}` : undefined
	const onBranchCommitted = useCallback(
		(committed: boolean) => {
			if (branchScope === undefined) return
			savePreference(branchScope, committed ? 'committed' : '')
			setCommittedBranch(committed ? branchScope : undefined)
		},
		[branchScope],
	)
	const branchAlreadyCommitted = branchScope !== undefined && (branchScope === committedBranch || readPreference(branchScope) === 'committed')
	const forkAction = page.kind === 'pool' && !branchAlreadyCommitted ? statoblastPageHref({ ...page, tab: 'fork' }) : undefined
	const showMigrationActions = page.kind !== 'pool' && page.kind !== 'migrate-rep'
	const repToEth = repPrices.repPerEthPrice
	const repPrice = repToEth === undefined || repToEth === 0n ? undefined : formatUnits(10n ** 36n / repToEth, 18)
	const routeKey = parseRouteHash(window.location.hash).routeHash
	const readScope = `${activeEnvironmentNonce}:${activeUniverseId}:${walletScopedAccountAddress ?? ''}:${routeKey}`
	const reportReadStatus = useCallback<ReportStatoblastReadStatus>((readAt, progress) => setReadStatus({ scope: readScope, readAt, progress }), [readScope])
	const currentReadStatus = readStatus?.scope === readScope ? readStatus : undefined
	const readUnavailable = readBackendStatus.issue === 'unreachable' && readBackendMessage !== undefined
	const openRpcSettings = () => {
		const trigger = document.getElementById(settingsTriggerId)
		if (trigger instanceof HTMLButtonElement && trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
	}
	useEffect(() => {
		const history = openHistory(profile)
		if (page.kind === 'pool') history.add(page, page.pool, activeUniverseId)
		if (page.kind === 'question') history.add({ ...page, tab: 'shares', sharesAction: undefined }, formatQuestionIdHex(page.questionId), activeUniverseId)
	}, [profile, activeUniverseId, page.kind === 'pool' || page.kind === 'question' ? page.pool : undefined, page.kind === 'question' ? page.questionId : undefined, page.kind === 'pool' && page.tab === 'fork'])
	const oracleApp = new URL('../openoracle/#/open-oracle', window.location.href)
	if (window.location.port === '12347') {
		oracleApp.port = '4143'
		oracleApp.pathname = '/'
	}
	oracleApp.hash = `#/open-oracle${getTopLevelRouteSearch('watchlist')}`
	const title = applicationDeploymentMissing && page.kind !== 'choose-universe' ? pageCopy.deployContracts : getAppPageTitle(page)

	return (
		<UniverseNamesProvider includeRelatedUniverses={includeRelatedUniverses} universe={zoltarUniverse}>
			<ProtocolAppFrame
				accountAddress={walletScopedAccountAddress}
				activeUniverseId={activeUniverseId}
				currentBlockNumber={currentBlockNumber}
				currentTimestamp={currentTimestamp}
				header={
					<AppHeaderShell
						showWalletSpeedUp
						renderOverview={({ settingsMenu }) => (
							<OverviewPanels
								{...overviewWalletProps}
								applicationTitle={applicationTitle}
								brandHref={watchlistHref}
								settingsMenu={settingsMenu}
								activeUniverseId={page.kind === 'choose-universe' ? undefined : activeUniverseId}
								universePresentation={overview}
								universeRepBalanceAttoRep={operations.zoltarForkRepBalanceAttoRep}
								isLoadingUniverseRepBalance={operations.loadingZoltarForkAccess}
								onGoToGenesisUniverse={() => setUniverse(0n)}
								longWalletAbbreviation
								showWethBalance
								universeControl={
									<div className='statoblast-header-controls'>
										{repPrice !== undefined && (
											<span className='statoblast-rep-chip'>
												{pageCopy.repLead}
												{Number(repPrice).toLocaleString('en-US', { maximumSignificantDigits: 3 })}
												{pageCopy.ethTail}
											</span>
										)}
										<button className='secondary statoblast-refresh' type='button' aria-label={pageCopy.refresh} disabled={!enabled || refreshingPage} onClick={() => void refreshPage()}>
											↻
											<span className='statoblast-refresh-status'>
												{currentReadStatus?.progress ?? (refreshingPage ? pageCopy.refreshing : <UpdatedAgo updatedAt={currentReadStatus?.readAt} />)}
												<span className='statoblast-auto-state'>
													{pageCopy.autoLead}
													{autoRefresh ? pageCopy.on : pageCopy.off}
												</span>
											</span>
										</button>
										{autoRefreshToggle('statoblast-auto-desktop')}
										<StatoblastUniverseMenu activeUniverse={activeUniverseId} environmentKey={activeEnvironmentNonce} universe={selectedUniverse} wallet={walletScopedAccountAddress} onSelect={setUniverse} onOpenChange={setUniverseMenuOpen} />
									</div>
								}
							/>
						)}
						simulationController={simulationController}
						onEnvironmentChanged={refreshActiveEnvironment}
						onRefresh={refreshSimulationView}
						settingsContent={autoRefreshToggle('statoblast-auto-mobile')}
						settingsTriggerId={settingsTriggerId}
					/>
				}
				heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={title} />}
				notices={
					<>
						<AppStatusNotices
							errorMessages={errorMessages}
							isDeploymentRoute={applicationDeploymentMissing}
							onRetryReadBackend={() => void retryReadBackend()}
							readBackendMessage={readUnavailable ? undefined : readBackendMessage}
							readBackendStatus={readBackendStatus}
							simulationBootstrapError={environmentBootstrapError}
							showApplicationDeploymentWarning={false}
							zoltarUniverseError={zoltarUniverseError}
						/>
						{readUnavailable && <StatoblastReadFailure reason={readBackendMessage} readAt={currentReadStatus?.readAt} onRetry={() => void retryReadBackend()} onOpenSettings={openRpcSettings} />}
						{forked && (
							<div className='statoblast-fork-banner'>
								<strong>{pageCopy.universeForked}</strong>
								{showMigrationActions && <a href='../docs/explanation/statoblast.html#forks-migration'>{pageCopy.forkHelp}</a>}
								{forkAction !== undefined && <a href={forkAction}>{pageCopy.chooseBranchAction}</a>}
								{showMigrationActions && <a href={statoblastPageHref({ kind: 'migrate-rep' })}>{pageCopy.migrateRepAction}</a>}
							</div>
						)}
					</>
				}
				routeContentDisabled={false}
				transactionRouteKey={routeKey}
				transactionState={transactionTray.transactionState.value}
				walletActions={overviewWalletProps}
			>
				<AppRouteContent
					page={page}
					registerPageRefresh={registerPageRefresh}
					contractsMissing={applicationDeploymentMissing}
					deploy={deployRouteContentProps}
					securityPools={{
						cacheReads: true,
						autoRefresh,
						onReadStatus: reportReadStatus,
						parameters: saveTouchedItem,
						walletConnected: accountState.address !== undefined,
						walletAddress: accountState.address,
						enabled,
						environmentKey: activeEnvironmentNonce,
						activeUniverseId,
						forkQuestion: selectedUniverse?.forkQuestionDetails,
						forkChildren: selectedUniverse?.childUniverses,
						forkRecapitalizationDeadline: selectedUniverse?.forkRecapitalizationDeadline,
						forkQuestionRead: { loading: operations.loadingZoltarUniverse, error: zoltarUniverseError, retry: () => void operations.loadZoltarUniverse({ clearCurrentState: false }) },
						onBranchCommitted,
						openOracleHref: oracleApp.href,
					}}
					questions={{ onReadStatus: reportReadStatus, autoRefresh, openDepositSearch, accountState, parameters: saveTouchedItem, deploymentStatuses, enabled, environmentKey: activeEnvironmentNonce, universeId: activeUniverseId, currentTimestamp, readUnavailable }}
					migration={{
						accountState,
						activeUniverseId,
						operations,
						universeState: resolveLoadableValueState({ isLoading: operations.loadingZoltarUniverse, isMissing: operations.zoltarUniverseMissing, value: zoltarUniverse }),
					}}
				/>
				<TransactionStepsModal contextKey={`${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}`} finalActionLabel={pageCopy.continueInWallet} keepConfirmed />
			</ProtocolAppFrame>
		</UniverseNamesProvider>
	)
}
