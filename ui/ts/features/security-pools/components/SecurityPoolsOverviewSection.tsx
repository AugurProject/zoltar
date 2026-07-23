import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from '../../../components/AddressValue.js'
import { IdentifierValue } from '../../../components/IdentifierValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricField } from '../../../components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { ProgressMeter } from '../../../components/ProgressMeter.js'
import { ReadOnlyDetailAccordion } from '../../../components/ReadOnlyDetailAccordion.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { Question, getQuestionTitle } from '../../markets/components/Question.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { UniverseLink } from '../../universes/components/UniverseLink.js'
import { getWalletScopedAccountAddress } from '../../../lib/network.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex, SECURITY_POOL_PAGE_SIZE } from '../../../lib/pagination.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { formatSecurityPoolPageSummary, getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getPoolCollateralizationPercent } from '../../markets/lib/trading.js'
import { getPoolRegistryPresentation } from '../../../lib/userCopy.js'
import { getToneRatioThreshold, getVisualRatio } from '../../../lib/visualMetrics.js'
import type { SecurityPoolsOverviewSectionProps } from '../../types.js'

export function SecurityPoolsOverviewSection({
	accountState,
	environmentRefreshKey,
	hasLoadedSecurityPoolPage,
	loadingSecurityPoolPage,
	onCreateSecurityPool,
	onLoadSecurityPoolPage,
	onSelectSecurityPool,
	repPerEthPrice,
	securityPoolBrowseCount,
	securityPoolPage,
	securityPoolOverviewError,
}: SecurityPoolsOverviewSectionProps) {
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [pageLoadError, setPageLoadError] = useState<string | undefined>(undefined)
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
	const hasLoadedCurrentPage = hasLoadedSecurityPoolPage && hasCurrentPageData
	const effectiveSecurityPoolOverviewError = securityPoolOverviewError ?? pageLoadError
	const loadingCurrentPage = loadingSecurityPoolPage || isWaitingForPageData || (!hasLoadedCurrentPage && effectiveSecurityPoolOverviewError === undefined)
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
	const normalizedSearchText = searchText.trim().toLowerCase()
	const hasPreviousPage = resolvedPageIndex > 0
	const hasNextPage = hasCurrentPageData && getHasNextPaginationPage(resolvedPageIndex, poolPageCount)
	const retryPoolRegistryLoad = () => {
		setPageLoadError(undefined)
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(onLoadSecurityPoolPage(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
			.catch(() => {
				setPageLoadError(securityPoolCopy.poolPageLoadError)
			})
			.finally(() => {
				setActivePageRequestKey(current => (current === currentPageRequestKey ? undefined : current))
			})
	}
	useEffect(() => {
		if (resolvedPageIndex === pageIndex) return
		setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])
	useEffect(() => {
		let cancelled = false
		setPageLoadError(undefined)
		setActivePageRequestKey(currentPageRequestKey)
		void Promise.resolve(loadSecurityPoolPageRef.current(resolvedPageIndex, SECURITY_POOL_PAGE_SIZE, currentPageRequestKey))
			.catch(() => {
				if (cancelled) return
				setPageLoadError(securityPoolCopy.poolPageLoadError)
			})
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
	const hasActiveFilters = normalizedSearchText !== '' || systemStateFilter !== 'all' || vaultFilter !== 'all'
	return (
		<SectionBlock
			density='compact'
			title={commonCopy.securityPools}
			variant='plain'
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
			<ErrorNotice message={effectiveSecurityPoolOverviewError} />
			{effectiveSecurityPoolOverviewError === undefined ? undefined : (
				<div className='actions pool-registry-recovery-actions'>
					<button className='secondary' type='button' onClick={retryPoolRegistryLoad} disabled={loadingCurrentPage}>
						{loadingCurrentPage ? <LoadingText>{securityPoolCopy.retryingSecurityPoolsTruncated}</LoadingText> : securityPoolCopy.retryLoadingPools}
					</button>
				</div>
			)}
			<div className='filter-toolbar'>
				<label className='field'>
					<span>{securityPoolCopy.searchLoadedPage}</span>
					<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={securityPoolCopy.poolSearchPlaceholder} />
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
			{hasActiveFilters && pagedSecurityPools.length > 0 ? <p className='detail'>{formatSecurityPoolPageSummary(filteredSecurityPools.length, pagedSecurityPools.length)}</p> : undefined}

			{(() => {
				if (pagedSecurityPools.length === 0) {
					if (registryPresentation === undefined) return undefined
					const isEmptyRegistry = registryPresentation.key === 'empty'
					const registryActions = (() => {
						if (isEmptyRegistry && onCreateSecurityPool !== undefined)
							return (
								<button className='primary' type='button' onClick={onCreateSecurityPool}>
									{commonCopy.createSecurityPool}
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
											<button className='primary' onClick={() => onSelectSecurityPool(pool.securityPoolAddress, pool.universeId)}>
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
										<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
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
										</ReadOnlyDetailAccordion>
									</div>
								</EntityCard>
							)
						})}
					</div>
				)
			})()}
		</SectionBlock>
	)
}
