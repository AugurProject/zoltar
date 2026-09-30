import { RequestPriceModal } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/RequestPriceModal.js'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useForkAuctionOperations } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionOperations.js'
import type { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import type { useOpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOraclePriceCoordinator.js'
import type { useRepPrices } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useRepPrices.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import { useSecurityVaultOperations } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { applyReportingFormUpdate } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingForm.js'
import { getCurrentPoolOracleManagerDetails } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import { resolveRepPrice, type UiPriceOracle } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { useRememberOpenedEntity } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { securityPoolDownloadStore, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import { getUniverseDirectoryContextKey, isUniverseDirectoryLoadedForContext, shouldAutoLoadUniverseDirectory } from '../lib/universeDirectory.js'
import { createSecurityPoolsRouteFormSync } from '../lib/routeFormSync.js'
import { buildForkAuctionSectionProps, buildLiquidationSectionProps, buildReportingSectionProps, buildSecurityVaultSectionProps, buildTradingSectionProps } from '../lib/securityPoolsRouteSections.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import type { useStatoblastUrlState } from './useStatoblastUrlState.js'
import type { AccountState, ReportingFormState, WriteOperationsParameters } from '@zoltar/ui-statoblast-shared/types/app.js'
import type { RepPerEthPriceProps, SecurityPoolsSectionProps, SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { OpenOracleSectionProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'

/** App-shell values every Security Pools section reads, grouped like the Zoltar workspace. */
type SecurityPoolsRouteContext = {
	accountState: AccountState
	activeEnvironmentNonce: number
	activeUniverseId: bigint
	canReadOnchainData: boolean
	currentTimestamp: bigint | undefined
	deploymentStatuses: Parameters<typeof useSecurityPoolCreation>[0]['deploymentStatuses']
	route: string
	uiPriceOracle: UiPriceOracle
	walletBootstrapComplete: boolean
	walletScopedAccountAddress: Address | undefined
	walletScopedHookConfig: WriteOperationsParameters
}

type SecurityPoolsUrlState = Pick<
	ReturnType<typeof useStatoblastUrlState>,
	'openSecurityPoolInUniverse' | 'poolBrowseState' | 'securityPoolAddress' | 'securityPoolsView' | 'selectedPoolView' | 'setPoolBrowseState' | 'setSecurityPoolAddress' | 'setSecurityPoolQuestionId' | 'setSecurityPoolsView' | 'setSelectedPoolView' | 'setVaultAddress' | 'setVaultView' | 'vaultView'
>

type SecurityPoolsRouteParameters = {
	context: SecurityPoolsRouteContext
	marketCreation: ReturnType<typeof useMarketCreation>
	openOracle: {
		inlineOracle?: OpenOracleSectionProps
		onViewPendingReport: (reportId: bigint) => void
		priceCoordinator: ReturnType<typeof useOpenOraclePriceCoordinator>
	}
	/** The Uniswap-backed REP price; the selected pool's oracle price replaces it when the price setting prefers the pool oracle. */
	repPrices: Pick<ReturnType<typeof useRepPrices>, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl'>
	selectedPoolRefresh: { nonce: number; setNonce: (updateNonce: (currentNonce: number) => number) => void }
	urlState: SecurityPoolsUrlState
}

const SECURITY_POOLS_VIEWS: readonly SecurityPoolsView[] = ['browse', 'create', 'operate', 'universes']

export function useSecurityPoolsRoute({ context, marketCreation, openOracle, repPrices, selectedPoolRefresh, urlState }: SecurityPoolsRouteParameters) {
	const { accountState, activeEnvironmentNonce, activeUniverseId, canReadOnchainData, currentTimestamp, deploymentStatuses, route, uiPriceOracle, walletBootstrapComplete, walletScopedAccountAddress, walletScopedHookConfig } = context
	const { securityPoolAddress, securityPoolsView, setSecurityPoolsView } = urlState
	const { priceCoordinator } = openOracle
	const [questionAndPoolCreating, setQuestionAndPoolCreating] = useState(false)
	const { createMarket, loadZoltarForkAccess, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm, zoltarUniverse } = marketCreation
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
	const poolCreation = useSecurityPoolCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		deploymentStatuses,
		enabled: route === 'pools' && canReadOnchainData,
		newQuestionForm: marketForm,
		zoltarUniverseHasForked,
	})
	const { createPool, marketDetails, securityPoolForm, securityPoolResult, setSecurityPoolForm } = poolCreation
	const vault = useSecurityVaultOperations({ ...walletScopedHookConfig, enabled: route === 'pools' && canReadOnchainData, selectedSecurityPoolAddress: securityPoolAddress })
	const reporting = useReportingOperations({
		...walletScopedHookConfig,
		selectedSecurityPoolAddress: securityPoolAddress,
	})
	const updateReportingForm = (update: Partial<ReportingFormState>) => {
		reporting.setReportingForm((current: ReportingFormState) => applyReportingFormUpdate(current, update))
	}
	const overview = useSecurityPoolsOverview({ ...walletScopedHookConfig, environmentRefreshKey: activeEnvironmentNonce })
	const { checkedSecurityPoolAddress, hasLoadedUniverseDirectoryPools, loadingUniverseDirectoryPools, loadSecurityPools, loadUniverseDirectoryPools, refreshSecurityPools, securityPools, securityPoolUniverseDirectoryError } = overview
	// The open pool's summary re-reads on each new block, so another user's deposit or fork appears without a reload.
	useBlockRefresh(() => void refreshSecurityPools(), route === 'pools' && securityPoolsView === 'operate' && checkedSecurityPoolAddress !== undefined)
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const openedPoolSummary = useMemo(() => (selectedPool === undefined ? undefined : toCachedSecurityPool(selectedPool)), [selectedPool])
	useRememberOpenedEntity('statoblast', 'pool', securityPoolDownloadStore, selectedPool?.securityPoolAddress, openedPoolSummary)
	const trading = useTradingOperations({
		...walletScopedHookConfig,
		deploymentStatuses,
		enabled: route === 'pools' && canReadOnchainData && selectedPool !== undefined,
		selectedSecurityPoolAddress: securityPoolAddress,
	})
	const forkAuction = useForkAuctionOperations({ ...walletScopedHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const lastUniverseDirectoryAutoLoadContextKeyRef = useRef<string | undefined>(undefined)
	const universeDirectoryContextKey = getUniverseDirectoryContextKey({ accountAddress: walletScopedAccountAddress, environmentNonce: activeEnvironmentNonce, universeId: activeUniverseId })
	// The overview hook keys its loaded directory on the environment only; the figures are per account and universe, so the route keys them on the full context.
	const [loadedUniverseDirectoryContextKey, setLoadedUniverseDirectoryContextKey] = useState<string | undefined>(undefined)
	const universeDirectoryLoadedForContext = isUniverseDirectoryLoadedForContext({ currentContextKey: universeDirectoryContextKey, hasLoadedUniverseDirectoryPools, loadedContextKey: loadedUniverseDirectoryContextKey })
	const loadUniverseDirectoryPoolsForContext = async () => {
		const requestedContextKey = universeDirectoryContextKey
		if (await loadUniverseDirectoryPools()) setLoadedUniverseDirectoryContextKey(requestedContextKey)
	}
	const lastSecurityVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const lastStagedVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const selectedPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails: priceCoordinator.poolOracleManagerDetails, selectedPoolManagerAddress: selectedPool?.managerAddress })
	const selectedPoolRepPrice = resolveRepPrice({
		now: currentTimestamp,
		oracleManager: selectedPoolOracleManagerDetails === undefined ? undefined : { isPriceValid: selectedPoolOracleManagerDetails.isPriceValid, price: selectedPoolOracleManagerDetails.lastPrice, settlementTimestamp: selectedPoolOracleManagerDetails.lastSettlementTimestamp },
		poolOracle: selectedPool === undefined ? undefined : { price: selectedPool.lastOraclePrice, settlementTimestamp: selectedPool.lastOracleSettlementTimestamp },
		setting: uiPriceOracle,
		uniswapPrice: repPrices.repPerEthPrice,
	})
	const uiRepPerEthSource = (() => {
		if (selectedPoolRepPrice.price === undefined) return undefined
		if (selectedPoolRepPrice.source === 'open-oracle') return 'open-oracle' as const
		return repPrices.repPerEthSource
	})()
	// One REP price feeds every section, so vault health, withdrawable REP, trading, and liquidation figures agree.
	const uiRepPrice: RepPerEthPriceProps = {
		repPerEthPrice: selectedPoolRepPrice.price,
		repPerEthSource: uiRepPerEthSource,
		repPerEthSourceUrl: uiRepPerEthSource === 'open-oracle' ? undefined : repPrices.repPerEthSourceUrl,
	}
	const derivedSecurityPoolsView = resolveFirstMatchingValue<SecurityPoolsView>(
		[
			[securityPoolAddress !== '', 'operate'],
			[securityPoolForm.marketId !== '' || marketDetails !== undefined || securityPoolResult !== undefined, 'create'],
		],
		'browse',
	)
	const activeSecurityPoolsView = resolveEnumValue<SecurityPoolsView>(securityPoolsView, derivedSecurityPoolsView, SECURITY_POOLS_VIEWS)
	const refreshSelectedPoolData = (requestedSecurityPoolAddress?: string) => {
		const nextSecurityPoolAddress = requestedSecurityPoolAddress ?? securityPoolAddress
		if (!walletBootstrapComplete) return
		if (!isHexAddressInput(nextSecurityPoolAddress)) return
		selectedPoolRefresh.setNonce(currentNonce => currentNonce + 1)
		void loadSecurityPools(nextSecurityPoolAddress)
	}
	const { securityVaultResult } = vault
	useEffect(() => {
		const securityVaultRepRefreshHash =
			securityVaultResult?.action === 'setVaultUnderwritingLimit' || securityVaultResult?.action === 'depositRepToVault' || securityVaultResult?.action === 'redeemRepFromVault' || (securityVaultResult?.action === 'queueWithdrawRep' && securityVaultResult.stagedExecution?.success === true)
				? securityVaultResult.hash
				: undefined
		if (securityVaultRepRefreshHash === undefined) {
			lastSecurityVaultRepRefreshHash.current = undefined
			return
		}
		if (lastSecurityVaultRepRefreshHash.current === securityVaultRepRefreshHash) return
		lastSecurityVaultRepRefreshHash.current = securityVaultRepRefreshHash
		void loadZoltarForkAccess()
	}, [loadZoltarForkAccess, securityVaultResult])
	const { poolPriceOracleResult } = priceCoordinator
	useEffect(() => {
		const stagedVaultRepRefreshHash = poolPriceOracleResult?.action === 'executeStagedOperation' && poolPriceOracleResult.stagedExecution?.success === true && poolPriceOracleResult.stagedExecution.operation === 'withdrawRep' ? poolPriceOracleResult.hash : undefined
		if (stagedVaultRepRefreshHash === undefined) {
			lastStagedVaultRepRefreshHash.current = undefined
			return
		}
		if (lastStagedVaultRepRefreshHash.current === stagedVaultRepRefreshHash) return
		lastStagedVaultRepRefreshHash.current = stagedVaultRepRefreshHash
		void loadZoltarForkAccess()
	}, [loadZoltarForkAccess, poolPriceOracleResult])
	const createQuestionAndSecurityPool = async () => {
		if (questionAndPoolCreating) return
		if (marketForm.marketType !== 'binary') return
		setQuestionAndPoolCreating(true)
		try {
			await createPool(undefined, securityPoolForm, marketForm)
		} finally {
			setQuestionAndPoolCreating(false)
		}
	}
	useEffect(() => {
		if (
			!shouldAutoLoadUniverseDirectory({
				activeSecurityPoolsView,
				canReadOnchainData,
				currentContextKey: universeDirectoryContextKey,
				hasLoadedUniverseDirectoryPools: universeDirectoryLoadedForContext,
				lastAutoLoadContextKey: lastUniverseDirectoryAutoLoadContextKeyRef.current,
				loadingUniverseDirectoryPools,
				securityPoolUniverseDirectoryError,
			})
		)
			return
		lastUniverseDirectoryAutoLoadContextKeyRef.current = universeDirectoryContextKey
		void loadUniverseDirectoryPoolsForContext()
	}, [activeSecurityPoolsView, canReadOnchainData, universeDirectoryLoadedForContext, loadingUniverseDirectoryPools, securityPoolUniverseDirectoryError, universeDirectoryContextKey])
	// One navigation moves both the universe and the pool; the route effect loads a pool that is not listed yet, so only a listed pool is refreshed here.
	const openPoolInUniverse = (universeId: bigint, poolAddress: string) => {
		urlState.openSecurityPoolInUniverse(universeId, poolAddress)
		if (securityPools.some(pool => pool.securityPoolAddress.toLowerCase() === poolAddress.toLowerCase())) refreshSelectedPoolData(poolAddress)
	}
	const pricedSection = { accountState, ...uiRepPrice }
	const securityPoolsRouteContentProps: SecurityPoolsSectionProps = {
		activeView: activeSecurityPoolsView,
		loadingUniverseDirectoryPools,
		createPool: {
			...poolCreation,
			...pricedSection,
			questionAndPoolCreating,
			onRetryExistingQuestionCheck: poolCreation.retryExistingQuestionCheck,
			onCreateQuestionAndSecurityPool: () => void createQuestionAndSecurityPool(),
			onCreateSecurityPool: questionIdOverride => void createPool(questionIdOverride),
			onResetSecurityPoolCreation: poolCreation.resetSecurityPoolCreation,
			onSecurityPoolFormChange: update => {
				setSecurityPoolForm(current => ({ ...current, ...update }))
				if (update.marketId !== undefined) urlState.setSecurityPoolQuestionId(update.marketId)
			},
			zoltarUniverseHasForked,
			securityPools,
			onDismissSecurityPoolReview: poolCreation.dismissSecurityPoolReview,
			marketCreating,
			marketError,
			marketForm,
			marketResult,
			onCreateMarket: () => void createMarket(),
			onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
			onResetMarket: resetMarket,
		},
		onActiveViewChange: setSecurityPoolsView,
		onLoadUniverseDirectoryPools: () => void loadUniverseDirectoryPoolsForContext(),
		onOpenSecurityPool: (poolAddress, universeId) => openPoolInUniverse(universeId, poolAddress),
		overview: {
			browseState: urlState.poolBrowseState,
			onBrowseStateChange: urlState.setPoolBrowseState,
			activeUniverseId,
			currentTimestamp,
			securityPools,
		},
		securityPools,
		securityPoolUniverseDirectoryError,
		selectedPoolRepPrice,
		universeDirectoryPools: universeDirectoryLoadedForContext ? overview.universeDirectoryPools : undefined,
		workflow: {
			...buildLiquidationSectionProps(overview, priceCoordinator),
			...uiRepPrice,
			controlledVaultView: urlState.vaultView,
			onVaultViewChange: urlState.setVaultView,
			accountState,
			activeUniverseId,
			onBrowsePools: () => setSecurityPoolsView('browse'),
			onCreatePool: () => setSecurityPoolsView('create'),
			forkAuction: buildForkAuctionSectionProps(forkAuction, { accountState }),
			onReturnToCurrentUniverse: () => setSecurityPoolsView('browse'),
			onSwitchToPoolUniverse: openPoolInUniverse,
			RequestPriceModal,
			onRefreshSelectedPoolData: refreshSelectedPoolData,
			onSelectedPoolViewChange: urlState.setSelectedPoolView,
			onViewPendingReport: openOracle.onViewPendingReport,
			...(openOracle.inlineOracle === undefined ? {} : { inlineOracle: openOracle.inlineOracle }),
			uiPriceOracle,
			selectedPoolRefreshNonce: selectedPoolRefresh.nonce,
			universeForkTime: zoltarUniverse?.forkTime,
			selectedPoolView: urlState.selectedPoolView,
			onSecurityPoolAddressChange: value => urlState.setSecurityPoolAddress(value),
			reporting: buildReportingSectionProps(reporting, { accountState }, updateReportingForm),
			securityPoolAddress,
			securityPools,
			securityVault: buildSecurityVaultSectionProps(vault, pricedSection, selectedPool, urlState.setVaultAddress),
			trading: buildTradingSectionProps(trading, pricedSection, selectedPool),
		},
		zoltarUniverse,
	}
	const formSync = createSecurityPoolsRouteFormSync({
		setForkAuctionForm: forkAuction.setForkAuctionForm,
		setSecurityPoolForm,
		setSecurityVaultForm: vault.setSecurityVaultForm,
		setTradingForm: trading.setTradingForm,
		updateReportingForm,
	})
	return {
		activeSecurityPoolsView,
		formSync,
		loadSecurityPools,
		resetSecurityPoolCreation: poolCreation.resetSecurityPoolCreation,
		securityPoolResult,
		securityPoolsRouteContentProps,
		selectedPool,
		selectedPoolRepPrice,
		tradingResult: trading.tradingResult,
	}
}
