import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { EntityCard } from '../../../components/EntityCard.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { UniverseLink } from '../../universes/components/UniverseLink.js'
import { getSecurityPoolStatusBadgeLabel } from '../../security-pools/lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState } from '../../security-pools/lib/securityPoolState.js'
import { sameCaseInsensitiveText } from '../../../lib/caseInsensitive.js'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, QUESTION_PAGE_SIZE } from '../../../lib/pagination.js'
import type { ListedSecurityPool, MarketDetailsPage } from '../../../types/contracts.js'

function isCurrentQuestionPage(page: MarketDetailsPage | undefined, pageIndex: number, questionCount: bigint | undefined) {
	return page?.pageIndex === pageIndex && page.pageSize === QUESTION_PAGE_SIZE && (questionCount === undefined || page.questionCount === questionCount)
}

type MarketQuestionsSectionProps = {
	environmentRefreshKey: number
	hasForked: boolean
	hasLoadedSecurityPools: boolean
	loadingSecurityPools: boolean
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	onCreateQuestion: () => void
	onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>
	onLoadSecurityPools: () => void
	onOpenForkTab: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	securityPools: ListedSecurityPool[]
	securityPoolsLoadError: string | undefined
	zoltarQuestionCount: bigint | undefined
	zoltarQuestionPage: MarketDetailsPage | undefined
}
export function MarketQuestionsSection({
	environmentRefreshKey,
	hasForked,
	hasLoadedSecurityPools,
	loadingSecurityPools,
	loadingZoltarQuestionCount,
	loadingZoltarQuestions,
	onCreateQuestion,
	onLoadSecurityPools,
	onLoadZoltarQuestionPage,
	onOpenForkTab,
	onUseQuestionForFork,
	onUseQuestionForPool,
	securityPools,
	securityPoolsLoadError,
	zoltarQuestionCount,
	zoltarQuestionPage,
}: MarketQuestionsSectionProps) {
	const noQuestionsAvailable = zoltarQuestionCount === 0n
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [lastFailedPageRequestKey, setLastFailedPageRequestKey] = useState<string | undefined>(undefined)
	const lastSeenEnvironmentRefreshKeyRef = useRef(environmentRefreshKey)
	const lastRequestedPageKeyRef = useRef<string | undefined>(undefined)
	const currentPageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount?.toString() ?? 'unknown'}`
	const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount)
	const effectiveQuestionCount = zoltarQuestionPage?.questionCount ?? zoltarQuestionCount
	const questionPageCount = getPaginationPageCount(effectiveQuestionCount, QUESTION_PAGE_SIZE)
	const visibleQuestions = hasCurrentPageData && zoltarQuestionPage !== undefined ? zoltarQuestionPage.questions : []
	const isWaitingForPageData = activePageRequestKey === currentPageRequestKey
	useEffect(() => {
		setPageIndex(0)
	}, [zoltarQuestionCount])
	useEffect(() => {
		setLastFailedPageRequestKey(undefined)
		lastRequestedPageKeyRef.current = undefined
	}, [currentPageRequestKey])
	useEffect(() => {
		if (loadingZoltarQuestionCount) return
		if (zoltarQuestionCount === undefined || zoltarQuestionCount === 0n) return
		const pageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount.toString()}`
		const environmentChanged = lastSeenEnvironmentRefreshKeyRef.current !== environmentRefreshKey
		const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount)
		if (hasCurrentPageData && !environmentChanged) {
			if (lastFailedPageRequestKey === pageRequestKey) setLastFailedPageRequestKey(undefined)
			if (activePageRequestKey === pageRequestKey) setActivePageRequestKey(undefined)
			return
		}
		if (lastFailedPageRequestKey === pageRequestKey) return
		if (activePageRequestKey === pageRequestKey) return
		if (lastRequestedPageKeyRef.current === pageRequestKey) return
		lastRequestedPageKeyRef.current = pageRequestKey
		lastSeenEnvironmentRefreshKeyRef.current = environmentRefreshKey
		setActivePageRequestKey(pageRequestKey)
		void Promise.resolve(onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE))
			.catch(() => {
				setLastFailedPageRequestKey(current => (current === undefined ? pageRequestKey : current))
			})
			.finally(() => {
				setActivePageRequestKey(current => (current === pageRequestKey ? undefined : current))
			})
	}, [activePageRequestKey, environmentRefreshKey, lastFailedPageRequestKey, loadingZoltarQuestionCount, onLoadZoltarQuestionPage, pageIndex, zoltarQuestionCount, zoltarQuestionPage])
	const hasPreviousPage = pageIndex > 0
	const hasNextPage = getHasNextPaginationPage(pageIndex, questionPageCount)
	return (
		<SectionBlock
			density='compact'
			title={marketCopy.questions}
			actions={
				<PaginationControls
					hasNextPage={hasNextPage}
					hasPreviousPage={hasPreviousPage}
					loading={loadingZoltarQuestions}
					onNextPage={() => setPageIndex(current => current + 1)}
					onPreviousPage={() => setPageIndex(current => Math.max(0, current - 1))}
					summary={zoltarQuestionPage === undefined ? undefined : formatPaginationSummary(pageIndex, questionPageCount)}
				/>
			}
		>
			{visibleQuestions.length === 0 ? (
				(() => {
					if (loadingZoltarQuestionCount || loadingZoltarQuestions || isWaitingForPageData)
						return (
							<p className='detail'>
								<LoadingText>{marketCopy.loadingQuestions}</LoadingText>
							</p>
						)
					if (noQuestionsAvailable)
						return (
							<StateHint
								presentation={{
									key: 'empty',
									badgeLabel: marketCopy.noQuestions,
									badgeTone: 'muted',
								}}
								title={marketCopy.noQuestions}
								actions={
									<button className='primary' type='button' onClick={onCreateQuestion}>
										{commonCopy.createQuestion}
									</button>
								}
							/>
						)
					if (effectiveQuestionCount !== undefined && effectiveQuestionCount > 0n) return <p className='detail'>{marketCopy.questionPageUnavailable}</p>

					return undefined
				})()
			) : (
				<div className='entity-card-list'>
					{visibleQuestions.map(question => (
						<EntityCard
							key={question.questionId}
							title={getQuestionTitle(question)}
							actions={
								<div className='actions'>
									<button
										className='secondary'
										disabled={hasForked}
										onClick={() => {
											if (hasForked) return
											onUseQuestionForFork(question.questionId)
											onOpenForkTab()
										}}
									>
										{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
									</button>
									<button className='secondary' onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										{marketCopy.createPoolFromQuestion}
									</button>
								</div>
							}
						>
							<Question question={question} showTitle={false} />
							{question.marketType !== 'binary' ? <p className='detail'>{marketCopy.nonBinaryPoolCompatibilityDetail}</p> : undefined}
							{(() => {
								const linkedPools = securityPools.filter(pool => sameCaseInsensitiveText(pool.questionId, question.questionId))
								const linkedPoolsContent = (() => {
									if (!hasLoadedSecurityPools) {
										if (securityPoolsLoadError === undefined)
											return (
												<p className='detail'>
													<LoadingText>{marketCopy.loadingLinkedPools}</LoadingText>
												</p>
											)
										return (
											<div>
												<p className='error-text' role='alert'>
													{securityPoolsLoadError}
												</p>
												<button className='secondary' type='button' onClick={onLoadSecurityPools} disabled={loadingSecurityPools}>
													{marketCopy.retryLinkedPools}
												</button>
											</div>
										)
									}
									if (linkedPools.length === 0) return <p className='detail'>{marketCopy.noLinkedPool}</p>
									return (
										<div className='market-linked-pool-list'>
											{linkedPools.map(pool => {
												const lifecycleState = deriveSecurityPoolLifecycleState({
													hasForkActivity: pool.hasForkActivity,
													isChildPool: pool.parent !== zeroAddress,
													questionOutcome: pool.questionOutcome,
													systemState: pool.systemState,
													universeHasForked: pool.universeHasForked,
												})
												const statusLabel = getSecurityPoolStatusBadgeLabel({ hasForkActivity: pool.hasForkActivity, lifecycleState, questionOutcome: pool.questionOutcome })
												return (
													<div className='market-linked-pool' key={pool.securityPoolAddress}>
														<div className='market-linked-pool-summary'>
															<Badge tone={lifecycleState === 'operational' ? 'ok' : 'warning'}>{statusLabel}</Badge>
															<span>
																{commonCopy.universe}: <UniverseLink universeId={pool.universeId} />
															</span>
															<span>
																<strong>{marketCopy.openInterest}</strong>: <CurrencyValue value={pool.completeSetCollateralAmount} suffix={commonCopy.eth} copyable={false} />
															</span>
															<span>
																<strong>{marketCopy.shareSupply}</strong>: <CurrencyValue value={pool.shareTokenSupply} copyable={false} />
															</span>
														</div>
														<div className='market-linked-pool-participation'>
															<strong>{marketCopy.completeSetOperations}</strong>
															<span>{marketCopy.completeSetOperationsDetail}</span>
														</div>
														<div className='actions'>
															<SecurityPoolLink className='button-link secondary' securityPoolAddress={pool.securityPoolAddress} selectedPoolView='trading' universeId={pool.universeId}>
																{marketCopy.openSharesAndPosition}
															</SecurityPoolLink>
															<SecurityPoolLink className='button-link secondary' securityPoolAddress={pool.securityPoolAddress} selectedPoolView='reporting' universeId={pool.universeId}>
																{marketCopy.openReporting}
															</SecurityPoolLink>
														</div>
													</div>
												)
											})}
										</div>
									)
								})()
								return (
									<section className='market-linked-pools' aria-label={marketCopy.linkedPools}>
										<div className='market-linked-pools-header'>
											<strong>{marketCopy.linkedPools}</strong>
											<span>{marketCopy.linkedPoolsDetail}</span>
										</div>
										{linkedPoolsContent}
									</section>
								)
							})()}
						</EntityCard>
					))}
				</div>
			)}
		</SectionBlock>
	)
}
