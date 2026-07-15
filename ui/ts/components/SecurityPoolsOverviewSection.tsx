import * as commonCopy from '../copy/common.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { IdentifierValue } from './IdentifierValue.js'
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
		<RouteWorkflowPanel showHeader={false} title={commonCopy.securityPools}>
			<SectionBlock
				density='compact'
				title={commonCopy.securityPools}
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
							{loadingSecurityPoolPage ? <LoadingText>{securityPoolCopy.retryingSecurityPoolsTruncated}</LoadingText> : securityPoolCopy.retryLoadingPools}
						</button>
					</div>
				)}
				<div className='filter-toolbar'>
					<label className='field'>
						<span>{securityPoolCopy.searchLoadedPage}</span>
						<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={securityPoolCopy.poolSearchHelpText} />
					</label>
					<label className='field'>
						<span>{securityPoolCopy.systemState}</span>
						<select value={systemStateFilter} onChange={event => setSystemStateFilter(event.currentTarget.value as 'all' | SecurityPoolLifecycleState)}>
							<option value='all'>{securityPoolCopy.allStates}</option>
							<option value='operational'>{commonCopy.operational}</option>
							<option value='ended'>{securityPoolCopy.ended}</option>
							<option value='poolForked'>{securityPoolCopy.poolForked}</option>
							<option value='forkMigration'>{securityPoolCopy.forkMigration}</option>
							<option value='forkTruthAuction'>{commonCopy.truthAuction}</option>
						</select>
					</label>
					<label className='field'>
						<span>{securityPoolCopy.vaultCoverage}</span>
						<select value={vaultFilter} onChange={event => setVaultFilter(event.currentTarget.value as 'all' | 'has-vaults' | 'empty')}>
							<option value='all'>{securityPoolCopy.allPools}</option>
							<option value='has-vaults'>{securityPoolCopy.hasVaults}</option>
							<option value='empty'>{securityPoolCopy.noVaults}</option>
						</select>
					</label>
				</div>
				{pagedSecurityPools.length > 0 ? <p className='detail'>{securityPoolCopy.formatPoolPageSummary(pagedSecurityPools.length, filteredSecurityPools.length)}</p> : undefined}

				{(() => {
					if (pagedSecurityPools.length === 0) {
						if (registryPresentation === undefined) return undefined
						const isEmptyRegistry = registryPresentation.key === 'empty'
						const isUncheckedRegistry = registryPresentation.key === 'not_checked'
						const registryActions = (() => {
							if (isEmptyRegistry && onCreateSecurityPool !== undefined)
								return (
									<button className='primary' type='button' onClick={onCreateSecurityPool}>
										{commonCopy.createSecurityPool}
									</button>
								)
							if (isUncheckedRegistry && securityPoolOverviewError === undefined)
								return (
									<button className='secondary' type='button' onClick={retryPoolRegistryLoad} disabled={loadingSecurityPoolPage}>
										{securityPoolCopy.loadSecurityPools}
									</button>
								)
							return undefined
						})()

						return <StateHint presentation={registryPresentation} title={isEmptyRegistry ? securityPoolCopy.noSecurityPools : undefined} actions={registryActions} />
					}
					if (filteredSecurityPools.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: securityPoolCopy.poolFiltersEmpty }} />

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
													{securityPoolCopy.openPool}
												</button>
											)
										}
									>
										<div className='security-pool-card-surface'>
											<div className='security-pool-card-title-row' aria-label={securityPoolCopy.poolCollateralization}>
												<CollateralizationCircle className='security-pool-card-title-collateralization' collateralizationPercent={collateralizationPercent} targetCollateralizationPercent={targetCollateralizationPercent} size='small' label={securityPoolCopy.poolCollateralization} />
											</div>
											<div className='security-pool-strip'>
												<div className='security-pool-strip-story'>
													<Question className='security-pool-strip-question' question={pool.marketDetails} showTitle={false} variant='preview' />
													<div className='security-pool-strip-stats'>
														<div>
															<span>{securityPoolCopy.vaults}</span>
															<strong>{pool.vaultCount.toString()}</strong>
														</div>
														<div>
															<span>{commonCopy.multiplier}</span>
															<strong>{pool.securityMultiplier.toString()}x</strong>
														</div>
														<div>
															<span>{securityPoolCopy.annualFee}</span>
															<strong>
																<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
															</strong>
														</div>
													</div>
												</div>
												<div className='security-pool-strip-signal'>
													<div className='security-pool-strip-price'>
														<span>{commonCopy.openOraclePrice}</span>
														<strong>
															<OpenOraclePriceValue currentTimestamp={undefined} lastPrice={pool.lastOraclePrice} lastSettlementTimestamp={pool.lastOracleSettlementTimestamp} priceValidUntilTimestamp={undefined} />
														</strong>
													</div>
													<div className='security-pool-card-progress security-pool-strip-meters'>
														<ProgressMeter
															className='security-pool-strip-meter'
															label={securityPoolCopy.openInterestMinted}
															maxValue={pool.totalSecurityBondAllowance}
															secondaryValue={
																<span className='detail'>
																	{securityPoolCopy.maxLead}
																	<CurrencyValue value={pool.totalSecurityBondAllowance} suffix={commonCopy.eth} />
																</span>
															}
															tone={getToneRatioThreshold({
																ratio: getVisualRatio({ value: pool.completeSetCollateralAmount, maxValue: pool.totalSecurityBondAllowance }),
																successThreshold: 0.6,
																warningThreshold: 0.85,
															})}
															value={pool.completeSetCollateralAmount}
															valueText={<CurrencyValue value={pool.completeSetCollateralAmount} suffix={commonCopy.eth} />}
														/>
													</div>
												</div>
											</div>
											<div className='security-pool-detail-rail security-pool-card-inline-details'>
												<MetricField label={securityPoolCopy.poolAddress}>
													<AddressValue address={pool.securityPoolAddress} />
												</MetricField>
												<MetricField label={securityPoolCopy.managerAddress}>
													<AddressValue address={pool.managerAddress} />
												</MetricField>
												<MetricField label={commonCopy.questionId}>
													<IdentifierValue value={pool.questionId} />
												</MetricField>
												<MetricField label={commonCopy.universe}>
													<UniverseLink format='hex' universeId={pool.universeId} />
												</MetricField>
											</div>
											<div className='security-pool-browse-vaults'>
												<div className='security-pool-browse-vaults-head'>
													<h4>{securityPoolCopy.vaults}</h4>
													<div className='security-pool-browse-vaults-count'>{securityPoolCopy.formatVaultCountLabel(pool.vaultCount.toString())}</div>
												</div>
												{pool.hasLoadedVaults === false ? (
													<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.unavailable, badgeTone: 'muted', detail: securityPoolCopy.vaultPreviewUnavailable }} />
												) : (
													<div className='security-pool-browse-vault-list'>
														{pool.vaults.length === 0 ? (
															<StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: securityPoolCopy.poolVaultsEmpty }} />
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
																					<span>{commonCopy.securityBondAllowance}</span>
																					<strong>
																						<CurrencyValue value={vault.securityBondAllowance} suffix={commonCopy.eth} />
																					</strong>
																				</div>
																				<div className='security-pool-browse-vault-row-kpi'>
																					<span>{commonCopy.repCollateral}</span>
																					<strong>
																						<CurrencyValue value={vault.repDepositShare} suffix={commonCopy.rep} />
																					</strong>
																				</div>
																				<button
																					className='secondary security-pool-browse-vault-row-liquidate'
																					onClick={() => onOpenLiquidationModal(pool.managerAddress, pool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)}
																					disabled={accountState.address === undefined || !isMainnet || !liquidationEnabled}
																					title={securityPoolCopy.liquidationReviewHint}
																				>
																					{securityPoolCopy.reviewLiquidation}
																				</button>
																			</div>
																		</div>
																	)
																})
															})()
														)}
														{pool.vaultCount > BigInt(pool.vaults.length) ? <p className='detail'>{securityPoolCopy.formatVaultPreviewSummary(pool.vaults.length, pool.vaultCount)}</p> : undefined}
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
