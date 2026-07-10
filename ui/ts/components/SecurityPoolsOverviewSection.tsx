import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { PaginationControls } from './PaginationControls.js'
import { ProgressMeter } from './ProgressMeter.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { Question, getQuestionTitle } from './Question.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { UniverseLink } from './UniverseLink.js'
import { sameAddress } from '../lib/address.js'
import { getWalletScopedAccountAddress, isMainnetChain } from '../lib/network.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex, SECURITY_POOL_PAGE_SIZE } from '../lib/pagination.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getPoolCollateralizationPercent, getVaultCollateralizationPercent } from '../lib/trading.js'
import {
	UI_STRING_ACTIVE_VAULTS_IN_THIS_PREVIEW_NEWEST_ACTIVITY_FIRST,
	UI_STRING_ALL_POOLS,
	UI_STRING_ALL_STATES,
	UI_STRING_ANNUAL_FEE,
	UI_STRING_CREATE_SECURITY_POOL,
	UI_STRING_ENDED,
	UI_STRING_ETH,
	UI_STRING_FILTER_THIS_PAGE_BY_POOL_ADDRESS_QUESTION_ID_OR_QUESTION_TEXT,
	UI_STRING_FORK_MIGRATION,
	UI_STRING_HAS_VAULTS,
	UI_STRING_LOAD_SECURITY_POOLS,
	UI_STRING_MANAGER_ADDRESS,
	UI_STRING_MAX_PREFIX,
	UI_STRING_MULTIPLIER,
	UI_STRING_NONE,
	UI_STRING_NO_MATCHES,
	UI_STRING_NO_POOLS_MATCH_THE_CURRENT_SEARCH_AND_FILTER_SETTINGS,
	UI_STRING_NO_SECURITY_POOLS,
	UI_STRING_NO_VAULTS_IN_THIS_POOL,
	UI_STRING_NO_VAULTS,
	UI_STRING_OF_PREFIX,
	UI_STRING_OPEN_INTEREST_MINTED,
	UI_STRING_OPEN_ORACLE_PRICE,
	UI_STRING_OPEN_POOL,
	UI_STRING_OPERATIONAL,
	UI_STRING_PERCENT,
	UI_STRING_POOLS_SHOWN_ON_THIS_PAGE,
	UI_STRING_POOL_ADDRESS,
	UI_STRING_POOL_COLLATERALIZATION,
	UI_STRING_POOL_FORKED,
	UI_STRING_QUESTION_ID,
	UI_STRING_REP,
	UI_STRING_REP_COLLATERAL,
	UI_STRING_RETRYING_SECURITY_POOLS_TRUNCATED,
	UI_STRING_RETRY_LOADING_POOLS,
	UI_STRING_REVIEW_LIQUIDATION,
	UI_STRING_REVIEW_LIQUIDATION_DETAILS_FOR_THIS_VAULT_BEFORE_QUEUEING_THE_ACTION,
	UI_STRING_SEARCH_LOADED_PAGE,
	UI_STRING_SECURITY_BOND_ALLOWANCE,
	UI_STRING_SECURITY_POOLS,
	UI_STRING_SHOWING_PREFIX,
	UI_STRING_SYSTEM_STATE,
	UI_STRING_TRUTH_AUCTION,
	UI_STRING_UNAVAILABLE,
	UI_STRING_UNIVERSE,
	UI_STRING_VAULTS,
	UI_STRING_VAULT_COVERAGE,
	UI_STRING_VAULT_PREVIEW_UNAVAILABLE,
	UI_TEMPLATE_VAULT_COUNT_LABEL,
} from '../lib/uiStrings.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import { getToneRatioThreshold, getVisualRatio } from '../lib/visualMetrics.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'

export function SecurityPoolsOverviewSection({
	accountState,
	closeLiquidationModal,
	environmentRefreshKey,
	hasLoadedSecurityPoolPage,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingSecurityPoolPage,
	onCreateSecurityPool,
	onLiquidationAmountChange,
	onLiquidationTimeoutMinutesChange,
	onLoadPoolOracleManager,
	onLoadSecurityPoolPage,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onSelectSecurityPool,
	poolOracleManagerDetails,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	securityPoolBrowseCount,
	securityPoolPage,
	securityPoolOverviewActiveAction,
	securityPoolOverviewError,
	securityPoolLiquidationError,
	securityPoolOverviewResult,
}: SecurityPoolsOverviewSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [searchText, setSearchText] = useState('')
	const [systemStateFilter, setSystemStateFilter] = useState<'all' | SecurityPoolLifecycleState>('all')
	const [vaultFilter, setVaultFilter] = useState<'all' | 'has-vaults' | 'empty'>('all')
	const loadSecurityPoolPageRef = useRef(onLoadSecurityPoolPage)
	loadSecurityPoolPageRef.current = onLoadSecurityPoolPage
	const requestedPoolCount = securityPoolPage?.poolCount ?? securityPoolBrowseCount
	const requestedPoolPageCount = getPaginationPageCount(requestedPoolCount, SECURITY_POOL_PAGE_SIZE)
	const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, requestedPoolPageCount)
	const scopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const accountRequestKey = scopedAccountAddress?.toLowerCase() ?? 'no-account'
	const currentPageRequestKey = `${environmentRefreshKey}:${resolvedPageIndex}:${SECURITY_POOL_PAGE_SIZE}:${accountRequestKey}`
	const hasCurrentPageData = securityPoolPage?.requestKey === currentPageRequestKey && securityPoolPage.pageIndex === resolvedPageIndex && securityPoolPage.pageSize === SECURITY_POOL_PAGE_SIZE
	const currentPoolCount = hasCurrentPageData ? securityPoolPage.poolCount : undefined
	const poolPageCount = getPaginationPageCount(currentPoolCount, SECURITY_POOL_PAGE_SIZE)
	const pagedSecurityPools = hasCurrentPageData ? securityPoolPage.pools : []
	const isWaitingForPageData = activePageRequestKey === currentPageRequestKey
	const loadingCurrentPage = loadingSecurityPoolPage || isWaitingForPageData
	const hasLoadedCurrentPage = hasLoadedSecurityPoolPage && hasCurrentPageData
	const registryPresentation = getPoolRegistryPresentation({
		hasLoaded: hasLoadedCurrentPage,
		isLoading: loadingCurrentPage && !hasLoadedCurrentPage,
		mode: 'collection',
		poolCount: pagedSecurityPools.length,
	})
	const securityPoolsWithState = pagedSecurityPools.map(pool => ({
		pool,
		hasKnownForkActivity: pool.hasForkActivity,
		poolState: evaluateSecurityPoolState({
			lifecycleState: deriveSecurityPoolLifecycleState({
				hasForkActivity: pool.hasForkActivity,
				isChildPool: pool.parent !== zeroAddress,
				questionOutcome: pool.questionOutcome,
				systemState: pool.systemState,
				universeHasForked: pool.universeHasForked,
			}),
			universeHasForked: pool.universeHasForked,
		}),
	}))
	const selectedPoolWithState = securityPoolsWithState.find(({ pool }) => sameAddress(pool.securityPoolAddress, liquidationSecurityPoolAddress))
	const selectedPool = selectedPoolWithState?.pool
	const currentPoolOracleManagerDetails = selectedPool === undefined || liquidationManagerAddress === undefined || !sameAddress(poolOracleManagerDetails?.managerAddress, liquidationManagerAddress) ? undefined : poolOracleManagerDetails
	const targetVaultSummary = selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))
	const callerVaultSummary = accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const normalizedSearchText = searchText.trim().toLowerCase()
	const hasPreviousPage = resolvedPageIndex > 0
	const hasNextPage = hasCurrentPageData && getHasNextPaginationPage(resolvedPageIndex, poolPageCount)
	const retryPoolRegistryLoad = () => {
		onLoadSecurityPoolPage(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey)
	}
	useEffect(() => {
		if (resolvedPageIndex === pageIndex) return
		setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])
	useEffect(() => {
		let cancelled = false
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(loadSecurityPoolPageRef.current(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
			.catch(() => undefined)
			.finally(() => {
				if (cancelled) return
				setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current))
			})
		return () => {
			cancelled = true
		}
	}, [currentPageRequestKey, environmentRefreshKey, resolvedPageIndex])
	const filteredSecurityPools = securityPoolsWithState.filter(({ pool, poolState }) => {
		const displayState = poolState.lifecycleState
		if (systemStateFilter !== 'all' && displayState !== systemStateFilter) return false
		if (vaultFilter === 'has-vaults' && pool.vaultCount === 0n) return false
		if (vaultFilter === 'empty' && pool.vaultCount > 0n) return false
		if (normalizedSearchText === '') return true
		return pool.securityPoolAddress.toLowerCase().includes(normalizedSearchText) || pool.questionId.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.title.toLowerCase().includes(normalizedSearchText) || pool.marketDetails.description.toLowerCase().includes(normalizedSearchText)
	})
	return (
		<RouteWorkflowPanel showHeader={false} title={UI_STRING_SECURITY_POOLS}>
			<SectionBlock
				density='compact'
				title={UI_STRING_SECURITY_POOLS}
				actions={
					<PaginationControls
						hasNextPage={hasNextPage}
						hasPreviousPage={hasPreviousPage}
						loading={loadingCurrentPage}
						onNextPage={() => {
							setPageIndex(current => current + 1)
						}}
						onPreviousPage={() => {
							setPageIndex(current => Math.max(0, current - 1))
						}}
						summary={hasCurrentPageData ? formatPaginationSummary(resolvedPageIndex, poolPageCount) : undefined}
					/>
				}
			>
				<ErrorNotice message={securityPoolOverviewError} />
				{securityPoolOverviewError === undefined ? undefined : (
					<div className='actions pool-registry-recovery-actions'>
						<button className='secondary' type='button' onClick={retryPoolRegistryLoad} disabled={loadingSecurityPoolPage}>
							{loadingSecurityPoolPage ? <LoadingText>{UI_STRING_RETRYING_SECURITY_POOLS_TRUNCATED}</LoadingText> : UI_STRING_RETRY_LOADING_POOLS}
						</button>
					</div>
				)}
				<div className='filter-toolbar'>
					<label className='field'>
						<span>{UI_STRING_SEARCH_LOADED_PAGE}</span>
						<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={UI_STRING_FILTER_THIS_PAGE_BY_POOL_ADDRESS_QUESTION_ID_OR_QUESTION_TEXT} />
					</label>
					<label className='field'>
						<span>{UI_STRING_SYSTEM_STATE}</span>
						<select value={systemStateFilter} onChange={event => setSystemStateFilter(event.currentTarget.value as 'all' | SecurityPoolLifecycleState)}>
							<option value='all'>{UI_STRING_ALL_STATES}</option>
							<option value='operational'>{UI_STRING_OPERATIONAL}</option>
							<option value='ended'>{UI_STRING_ENDED}</option>
							<option value='poolForked'>{UI_STRING_POOL_FORKED}</option>
							<option value='forkMigration'>{UI_STRING_FORK_MIGRATION}</option>
							<option value='forkTruthAuction'>{UI_STRING_TRUTH_AUCTION}</option>
						</select>
					</label>
					<label className='field'>
						<span>{UI_STRING_VAULT_COVERAGE}</span>
						<select value={vaultFilter} onChange={event => setVaultFilter(event.currentTarget.value as 'all' | 'has-vaults' | 'empty')}>
							<option value='all'>{UI_STRING_ALL_POOLS}</option>
							<option value='has-vaults'>{UI_STRING_HAS_VAULTS}</option>
							<option value='empty'>{UI_STRING_NO_VAULTS}</option>
						</select>
					</label>
				</div>
				{pagedSecurityPools.length > 0 ? (
					<p className='detail'>
						{filteredSecurityPools.length.toString()} {UI_STRING_OF_PREFIX}
						{pagedSecurityPools.length.toString()} {UI_STRING_POOLS_SHOWN_ON_THIS_PAGE}
					</p>
				) : undefined}

				{(() => {
					if (pagedSecurityPools.length === 0) {
						if (registryPresentation === undefined) return undefined
						const isEmptyRegistry = registryPresentation.key === 'empty'
						const isUncheckedRegistry = registryPresentation.key === 'not_checked'
						const registryActions = (() => {
							if (isEmptyRegistry && onCreateSecurityPool !== undefined)
								return (
									<button className='primary' type='button' onClick={onCreateSecurityPool}>
										{UI_STRING_CREATE_SECURITY_POOL}
									</button>
								)
							if (isUncheckedRegistry && securityPoolOverviewError === undefined)
								return (
									<button className='secondary' type='button' onClick={retryPoolRegistryLoad} disabled={loadingSecurityPoolPage}>
										{UI_STRING_LOAD_SECURITY_POOLS}
									</button>
								)
							return undefined
						})()

						return <StateHint presentation={registryPresentation} title={isEmptyRegistry ? UI_STRING_NO_SECURITY_POOLS : undefined} actions={registryActions} />
					}
					if (filteredSecurityPools.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: UI_STRING_NO_MATCHES, badgeTone: 'muted', detail: UI_STRING_NO_POOLS_MATCH_THE_CURRENT_SEARCH_AND_FILTER_SETTINGS }} />

					return (
						<div className='entity-card-list'>
							{filteredSecurityPools.map(({ hasKnownForkActivity, pool, poolState }) => {
								const displayState = poolState.lifecycleState
								const liquidationEnabled = poolState.actions.queueLiquidation.enabled
								const collateralizationPercent = getPoolCollateralizationPercent(pool.totalRepDeposit, pool.totalSecurityBondAllowance, repPerEthPrice)
								const targetCollateralizationPercent = pool.securityMultiplier * 100n * 10n ** 18n
								const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({
									hasForkActivity: hasKnownForkActivity,
									questionOutcome: pool.questionOutcome,
									lifecycleState: displayState,
								})
								const badgeTone = (() => {
									if (displayState === 'operational') return 'ok'
									if (displayState === undefined) return 'muted'

									return 'warning'
								})()
								return (
									<EntityCard
										key={pool.securityPoolAddress}
										className='security-pool-card'
										title={getQuestionTitle(pool.marketDetails)}
										variant='record'
										badge={
											<Badge ariaLabel={statusBadgeLabel} tone={badgeTone}>
												{statusBadgeLabel}
											</Badge>
										}
										actions={
											onSelectSecurityPool === undefined ? undefined : (
												<button className='primary' onClick={() => onSelectSecurityPool(pool.securityPoolAddress)}>
													{UI_STRING_OPEN_POOL}
												</button>
											)
										}
									>
										<div className='security-pool-card-surface'>
											<div className='security-pool-card-title-row' aria-label={UI_STRING_POOL_COLLATERALIZATION}>
												<CollateralizationCircle className='security-pool-card-title-collateralization' collateralizationPercent={collateralizationPercent} targetCollateralizationPercent={targetCollateralizationPercent} size='small' label={UI_STRING_POOL_COLLATERALIZATION} />
											</div>
											<div className='security-pool-strip'>
												<div className='security-pool-strip-story'>
													<Question className='security-pool-strip-question' question={pool.marketDetails} showTitle={false} variant='preview' />
													<div className='security-pool-strip-stats'>
														<div>
															<span>{UI_STRING_VAULTS}</span>
															<strong>{pool.vaultCount.toString()}</strong>
														</div>
														<div>
															<span>{UI_STRING_MULTIPLIER}</span>
															<strong>{pool.securityMultiplier.toString()}x</strong>
														</div>
														<div>
															<span>{UI_STRING_ANNUAL_FEE}</span>
															<strong>
																<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={UI_STRING_PERCENT} />
															</strong>
														</div>
													</div>
												</div>
												<div className='security-pool-strip-signal'>
													<div className='security-pool-strip-price'>
														<span>{UI_STRING_OPEN_ORACLE_PRICE}</span>
														<strong>
															<OpenOraclePriceValue currentTimestamp={undefined} lastPrice={pool.lastOraclePrice} lastSettlementTimestamp={pool.lastOracleSettlementTimestamp} priceValidUntilTimestamp={undefined} />
														</strong>
													</div>
													<div className='security-pool-card-progress security-pool-strip-meters'>
														<ProgressMeter
															className='security-pool-strip-meter'
															label={UI_STRING_OPEN_INTEREST_MINTED}
															maxValue={pool.totalSecurityBondAllowance}
															secondaryValue={
																<span className='detail'>
																	{UI_STRING_MAX_PREFIX}
																	<CurrencyValue value={pool.totalSecurityBondAllowance} suffix={UI_STRING_ETH} />
																</span>
															}
															tone={getToneRatioThreshold({
																ratio: getVisualRatio({ value: pool.completeSetCollateralAmount, maxValue: pool.totalSecurityBondAllowance }),
																successThreshold: 0.6,
																warningThreshold: 0.85,
															})}
															value={pool.completeSetCollateralAmount}
															valueText={<CurrencyValue value={pool.completeSetCollateralAmount} suffix={UI_STRING_ETH} />}
														/>
													</div>
												</div>
											</div>
											<div className='security-pool-detail-rail security-pool-card-inline-details'>
												<MetricField label={UI_STRING_POOL_ADDRESS}>
													<AddressValue address={pool.securityPoolAddress} />
												</MetricField>
												<MetricField label={UI_STRING_MANAGER_ADDRESS}>
													<AddressValue address={pool.managerAddress} />
												</MetricField>
												<MetricField label={UI_STRING_QUESTION_ID}>{pool.questionId}</MetricField>
												<MetricField label={UI_STRING_UNIVERSE}>
													<UniverseLink format='hex' universeId={pool.universeId} />
												</MetricField>
											</div>
											<div className='security-pool-browse-vaults'>
												<div className='security-pool-browse-vaults-head'>
													<h4>{UI_STRING_VAULTS}</h4>
													<div className='security-pool-browse-vaults-count'>{UI_TEMPLATE_VAULT_COUNT_LABEL(pool.vaultCount.toString())}</div>
												</div>
												{pool.hasLoadedVaults === false ? (
													<StateHint presentation={{ key: 'empty', badgeLabel: UI_STRING_UNAVAILABLE, badgeTone: 'muted', detail: UI_STRING_VAULT_PREVIEW_UNAVAILABLE }} />
												) : (
													<div className='security-pool-browse-vault-list'>
														{pool.vaults.length === 0 ? (
															<StateHint presentation={{ key: 'empty', badgeLabel: UI_STRING_NONE, badgeTone: 'muted', detail: UI_STRING_NO_VAULTS_IN_THIS_POOL }} />
														) : (
															(() => {
																const previewVaults = [...pool.vaults]
																const accountAddress = accountState.address
																if (accountAddress !== undefined) {
																	const viewerVault = pool.vaults.find(vault => sameAddress(vault.vaultAddress, accountAddress))
																	if (viewerVault !== undefined && !previewVaults.some(vault => sameAddress(vault.vaultAddress, viewerVault.vaultAddress))) {
																		previewVaults.push(viewerVault)
																	}
																}
																return previewVaults.map(vault => {
																	const vaultCollateralizationPercent = getVaultCollateralizationPercent(vault.repDepositShare, vault.securityBondAllowance, repPerEthPrice)
																	const vaultCollateralizationTarget = pool.securityMultiplier * 100n * 10n ** 18n
																	return (
																		<div className='security-pool-browse-vault-row' key={`${pool.securityPoolAddress}-${vault.vaultAddress}`}>
																			<div className='security-pool-browse-vault-row-top'>
																				<div className='security-pool-browse-vault-row-title'>
																					<CollateralizationCircle collateralizationPercent={vaultCollateralizationPercent} className='security-pool-browse-vault-row-collateralization' size='small' targetCollateralizationPercent={vaultCollateralizationTarget} />
																					<div className='security-pool-browse-vault-row-id'>
																						<strong>
																							<AddressValue address={vault.vaultAddress} />
																						</strong>
																					</div>
																				</div>
																				<div className='security-pool-browse-vault-row-kpi'>
																					<span>{UI_STRING_SECURITY_BOND_ALLOWANCE}</span>
																					<strong>
																						<CurrencyValue value={vault.securityBondAllowance} suffix={UI_STRING_ETH} />
																					</strong>
																				</div>
																				<div className='security-pool-browse-vault-row-kpi'>
																					<span>{UI_STRING_REP_COLLATERAL}</span>
																					<strong>
																						<CurrencyValue value={vault.repDepositShare} suffix={UI_STRING_REP} />
																					</strong>
																				</div>
																				<button
																					className='secondary security-pool-browse-vault-row-liquidate'
																					onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)}
																					disabled={accountState.address === undefined || !isMainnet || !liquidationEnabled}
																					title={UI_STRING_REVIEW_LIQUIDATION_DETAILS_FOR_THIS_VAULT_BEFORE_QUEUEING_THE_ACTION}
																				>
																					{UI_STRING_REVIEW_LIQUIDATION}
																				</button>
																			</div>
																		</div>
																	)
																})
															})()
														)}
														{pool.vaultCount > BigInt(pool.vaults.length) ? (
															<p className='detail'>
																{UI_STRING_SHOWING_PREFIX}
																{pool.vaults.length.toString()} {UI_STRING_OF_PREFIX}
																{pool.vaultCount.toString()} {UI_STRING_ACTIVE_VAULTS_IN_THIS_PREVIEW_NEWEST_ACTIVITY_FIRST}
															</p>
														) : undefined}
													</div>
												)}
											</div>
										</div>
									</EntityCard>
								)
							})}
						</div>
					)
				})()}
			</SectionBlock>

			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationMaxAmount={liquidationMaxAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				liquidationTimeoutMinutes={liquidationTimeoutMinutes}
				loadingPoolOracleManager={loadingPoolOracleManager}
				liquidationTargetVault={liquidationTargetVault}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onSelectedPoolViewChange={() => undefined}
				poolState={selectedPoolWithState?.poolState}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolLiquidationError={securityPoolLiquidationError}
				securityPoolOverviewResult={securityPoolOverviewResult}
				callerVaultSummary={callerVaultSummary}
				targetVaultSummary={targetVaultSummary}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTimeoutMinutesChange={onLiquidationTimeoutMinutesChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
