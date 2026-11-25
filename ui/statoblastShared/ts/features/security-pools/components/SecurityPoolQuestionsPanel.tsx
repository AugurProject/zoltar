import { relatedLinkSeparator } from '../../../copy/securityPoolTransactions.js'
import { loadMarketDetails } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import * as watchlistCopy from '../../../copy/watchlist.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { createActiveEnvironmentGuard, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { designQuestionId, statoblastPageHref } from '../../../lib/routing.js'
import { checkStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import { decodeWatchlistRows, loadWatchlistRows, parseWatchlistEntity, type WatchlistRow } from '../../../protocol/watchlistRows.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { useOldActionDataNotice, useStatoblastPageRefresh, type RegisterStatoblastPageRefresh } from '../../useStatoblastPageRefresh.js'
import type { SecurityPoolActions } from './SecurityPoolControls.js'
import { SecurityPoolApprovedQuestions } from './SecurityPoolApprovedQuestions.js'
import { SecurityPoolButton } from './SecurityPoolControls.js'

function savedQuestionStage(question: WatchlistRow['question'], loading: boolean, trading: boolean) {
	if (question === undefined) return loading ? pageCopy.checking : watchlistCopy.unavailable
	if (question.questionOutcome !== 'none') return pageCopy.resolvedQuestion(getReportingOutcomeLabel(question.questionOutcome))
	if (question.universeHasForked) return pageCopy.forked
	if (question.ordinaryEscalationGameStarted) return pageCopy.responseWindow
	return trading ? watchlistCopy.trading : watchlistCopy.reporting
}

export function SecurityPoolQuestionsPanel({
	pool,
	universeId,
	actions,
	admission,
	owner,
	forked = false,
	enabled,
	environmentKey,
	registerPageRefresh,
	paging = false,
	onPreviousApprovedPage,
	onNextApprovedPage,
}: {
	pool: Address
	universeId: bigint
	actions: SecurityPoolActions
	admission: SecurityPoolAccountSnapshot['admission'] | undefined
	owner: Address | undefined
	forked?: boolean
	enabled: boolean
	environmentKey: number
	registerPageRefresh: RegisterStatoblastPageRefresh | undefined
	paging?: boolean
	onPreviousApprovedPage?: () => void
	onNextApprovedPage?: () => void
}) {
	const favoriteQuestions = useFavorites('statoblast', 'question')
	const saved = favoriteQuestions.entries.flatMap(({ id }) => {
		const entry = parseWatchlistEntity(id, 'question')
		return entry?.kind === 'question' && entry.pool.toLowerCase() === pool.toLowerCase() ? [entry] : []
	})
	const readScope = `${environmentKey}:${pool}:${universeId}:${owner ?? ''}`
	const savedIds = saved.map(entry => entry.id).join(',')
	const [savedDetails, setSavedDetails] = useState<{ scope: string; rows: readonly WatchlistRow[]; now: bigint | undefined }>()
	const [rowsLoading, setRowsLoading] = useState(false)
	const [rowsError, setRowsError] = useState<string>()
	const readGeneration = useRef(0)
	const inFlight = useRef(false)
	const refreshRows = async () => {
		if (!enabled || saved.length === 0 || inFlight.current || document.hidden) return
		const generation = ++readGeneration.current
		const guard = createActiveEnvironmentGuard()
		const isCurrent = () => generation === readGeneration.current && guard.isCurrent()
		inFlight.current = true
		setRowsLoading(true)
		setRowsError(undefined)
		const profile = getActiveNetworkProfile()
		let now: bigint | undefined
		try {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.savedQuestionReadFailed)
			const rows = await loadWatchlistRows(client, saved, universeId, owner, profile, {
				includeDeposits: false,
				onChunk: (_rows, _finished, _total, anchor) => {
					now = anchor.timestamp
				},
			})
			if (isCurrent()) setSavedDetails({ scope: readScope, rows, now })
		} catch (error) {
			if (isCurrent()) setRowsError(error instanceof Error ? error.message : pageCopy.savedQuestionReadFailed)
		} finally {
			if (generation === readGeneration.current) {
				inFlight.current = false
				setRowsLoading(false)
			}
		}
	}
	useEffect(() => {
		const stored = statoblastDisplayCache(getActiveNetworkProfile(), { universeId, owner, page: 'watchlist' }, decodeWatchlistRows).read()
		setSavedDetails(previous => {
			if (previous?.scope === readScope) return previous
			return stored === undefined ? undefined : { scope: readScope, rows: stored.value.filter(row => row.entity.pool === pool), now: stored.timestamp }
		})
		void refreshRows()
		return () => {
			readGeneration.current++
			inFlight.current = false
		}
	}, [enabled, readScope, savedIds])
	useBlockRefresh(() => void refreshRows(), enabled && saved.length > 0)
	useStatoblastPageRefresh(registerPageRefresh, refreshRows)
	const details = savedDetails?.scope === readScope ? savedDetails : undefined
	const [result, setResult] = useState<{ scope: string; status: string; id: bigint; mint: boolean; readAt: number }>()
	const [error, setError] = useState<string>()
	const [checking, setChecking] = useState(false)
	const id = designQuestionId(actions.questionInput.trim())
	const findId = useId()
	const selected = result?.scope === readScope && result.id === id ? result : undefined
	const registrationDataNotice = useOldActionDataNotice(selected?.status === 'unregistered-question' && !forked ? selected.readAt : undefined)
	const find = async () => {
		if (id === undefined || checking) return
		setError(undefined)
		setChecking(true)
		try {
			const guard = createActiveEnvironmentGuard()
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.questionLookupTimeout)
			const block = await client.getBlock()
			if (block.number === undefined) throw new Error(pageCopy.questionLookupBlockUnavailable)
			const [entry] = await checkStatoblastEntries(client, [{ pool, questionId: id, universeId }], block.number, true)
			if (entry?.status === 'failed') throw entry.error
			if (entry === undefined) throw new Error(pageCopy.couldNotVerifyQuestion)
			let status: string = entry.status
			let mint = false
			if (entry.status === 'question' || entry.status === 'unregistered-question') {
				const market = await loadMarketDetails(client, id)
				if (!market.exists) status = 'not-a-question'
				mint = market.exists && market.endTime > block.timestamp && !forked && admission?.mode !== 'custom'
			}
			if (guard.isCurrent()) setResult({ scope: readScope, status, id, mint, readAt: Date.now() })
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : pageCopy.couldNotFindQuestion)
		} finally {
			setChecking(false)
		}
	}
	return (
		<>
			<SectionBlock title={pageCopy.savedQuestions} description={saved.length > 0 ? pageCopy.savedQuestionsHere(saved.length) : undefined}>
				<form
					aria-label={pageCopy.findOrRegister}
					onSubmit={event => {
						event.preventDefault()
						void find()
					}}
				>
					<label htmlFor={findId}>{pageCopy.findOrRegister}</label>
					<FormInput
						id={findId}
						aria-label={pageCopy.findOrRegister}
						placeholder={pageCopy.questionIdPlaceholder}
						value={actions.questionInput}
						onInput={event => {
							actions.setQuestionInput(event.currentTarget.value)
							setError(undefined)
						}}
						error={error ?? (actions.questionInput.trim() !== '' && id === undefined ? pageCopy.questionIdFormat : undefined)}
						action={
							<button type='submit' disabled={id === undefined || checking}>
								{checking ? pageCopy.checking : pageCopy.findQuestion}
							</button>
						}
					/>
				</form>
				{selected?.status === 'not-a-question' && <p>{pageCopy.notAQuestion}</p>}
				{selected?.status === 'question' && (
					<p>
						{pageCopy.registeredHereLead}
						<a href={statoblastPageHref({ kind: 'question', pool, questionId: selected.id, tab: 'shares' }, universeId)}>{pageCopy.openShares}</a>
						{selected.mint && (
							<>
								{relatedLinkSeparator}
								<a href={statoblastPageHref({ kind: 'question', pool, questionId: selected.id, tab: 'shares', sharesAction: 'mint' }, universeId)}>{pageCopy.mintShares}</a>
							</>
						)}
					</p>
				)}
				{selected?.status === 'unprepared-question' && (
					<p>
						{pageCopy.unpreparedQuestionLead}
						<a href={statoblastPageHref({ kind: 'pool', pool, tab: 'fork' }, universeId)}>{pageCopy.forkRecovery}</a>
					</p>
				)}
				{selected?.status === 'unregistered-question' && (
					<>
						<p>{pageCopy.questionNotRegistered}</p>
						{registrationDataNotice !== undefined && <p className='detail'>{registrationDataNotice}</p>}
						<SecurityPoolButton
							model={actions}
							action='registerSecurityPoolQuestion'
							label={pageCopy.registerQuestion}
							pendingLabel={pageCopy.registeringQuestion}
							reason={forked ? pageCopy.universeForked : actions.registerReason}
							onClick={async () => {
								await actions.register()
								await find()
							}}
						/>
					</>
				)}
				{selected?.status === 'invalid-pool' && <p>{pageCopy.invalidPool}</p>}
				{rowsLoading && details === undefined && <LoadingText>{pageCopy.checking}</LoadingText>}
				<RetryableNotice message={rowsError} retryLabel={pageCopy.tryAgain} onRetry={() => void refreshRows()} disabled={rowsLoading} />
				{saved.length === 0 ? (
					<p>{pageCopy.emptySavedQuestionsDetail}</p>
				) : (
					<table className='statoblast-watchlist-table' role='table'>
						<thead>
							<tr>
								<th />
								<th scope='col'>{pageCopy.question}</th>
								<th scope='col'>{watchlistCopy.stage}</th>
								<th scope='col'>{watchlistCopy.yourShares}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{saved.map(entry => {
								const row = details?.rows.find(candidate => candidate.entity.id === entry.id)
								const question = row?.question
								const questionId = formatQuestionIdHex(entry.questionId)
								const title = favoriteQuestions.entries.find(candidate => candidate.id === entry.id)?.label || question?.marketDetails.title || questionId
								const shares = row?.shares
								const hasPosition = (row?.reportingPrincipal ?? 0n) > 0n || (shares !== undefined && Object.values(shares).some(amount => amount > 0n))
								const outcome = question?.questionOutcome ?? 'none'
								const now = details?.now
								const trading = question !== undefined && now !== undefined && now < question.marketDetails.endTime && !question.universeHasForked && !question.ordinaryEscalationGameStarted && outcome === 'none'
								const completeSets = shares === undefined ? undefined : [shares.yesAttoShares, shares.noAttoShares, shares.invalidAttoShares].reduce((minimum, amount) => (amount < minimum ? amount : minimum))
								const holdings = outcome === 'none' ? completeSets : shares?.[`${outcome}AttoShares`]
								const page = { kind: 'question', pool, questionId: entry.questionId, tab: 'shares' } as const
								let sharesAction: 'mint' | 'redeem' | undefined
								if (trading && admission?.mode !== 'custom') sharesAction = 'mint'
								if (outcome !== 'none' && (holdings ?? 0n) > 0n) sharesAction = 'redeem'
								const time = trading ? question?.marketDetails.endTime : row?.escalationEnd
								return (
									<tr key={entry.id} role='row'>
										<td role='cell'>
											<FavoriteToggle app='statoblast' id={entry.id} kind='question' entityLabel={title} confirmUnfavorite={() => !hasPosition || window.confirm(watchlistCopy.unstarPositionConfirmation)} />
										</td>
										<td role='cell'>
											<a href={statoblastPageHref(page, universeId)} {...(title === questionId ? { title: questionId } : {})}>
												{title === questionId ? abbreviateAddress(questionId) : title}
											</a>
											{title !== questionId && (
												<small>
													<IdentifierValue value={questionId} abbreviated />
												</small>
											)}
											{time !== undefined && time > 0n && (
												<small>
													{trading ? watchlistCopy.reportingOpensLead : watchlistCopy.responseEndsLead}
													<TimestampValue timestamp={time} relative={false} />
												</small>
											)}
										</td>
										<td role='cell' data-label={watchlistCopy.stage}>
											<Badge tone={outcome !== 'none' || trading ? 'ok' : 'muted'}>{savedQuestionStage(question, rowsLoading, trading)}</Badge>
										</td>
										<td role='cell' data-label={watchlistCopy.yourShares}>
											<CurrencyValue value={holdings} suffix={outcome === 'none' ? watchlistCopy.formatSets(row?.collateral ?? '') : getReportingOutcomeLabel(outcome)} units={row?.collateralDecimals ?? 18} />
										</td>
										<td role='cell'>
											{sharesAction === undefined ? (
												<small>{question === undefined ? undefined : pageCopy.mintingClosed}</small>
											) : (
												<a className='statoblast-outlined-link' href={statoblastPageHref({ ...page, sharesAction }, universeId)}>
													{sharesAction === 'mint' ? pageCopy.mintShares : pageCopy.redeemShares}
												</a>
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				)}
				{saved.length > 0 && <p className='detail'>{pageCopy.mintingCloses}</p>}
			</SectionBlock>
			{admission?.mode === 'fixed' && onPreviousApprovedPage !== undefined && onNextApprovedPage !== undefined && (
				<SecurityPoolApprovedQuestions pool={pool} universeId={universeId} admission={admission} actions={actions} forked={forked} enabled={enabled} environmentKey={environmentKey} paging={paging} onPreviousPage={onPreviousApprovedPage} onNextPage={onNextApprovedPage} registerPageRefresh={registerPageRefresh} />
			)}
			{admission?.mode === 'custom' && (
				<SectionBlock title={pageCopy.customQuestionRules}>
					<UserMessage tone='warning' detail={pageCopy.customQuestionRulesDetail} />
				</SectionBlock>
			)}
		</>
	)
}
