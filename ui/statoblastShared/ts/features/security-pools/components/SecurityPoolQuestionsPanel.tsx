import * as pageCopy from '../../../copy/securityPoolPage.js'
import * as watchlistCopy from '../../../copy/watchlist.js'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { toHex, type Address } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
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
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { designQuestionId, statoblastPageHref } from '../../../lib/routing.js'
import { checkStatoblastEntries } from '../../../protocol/statoblastEntries.js'
import { decodeWatchlistRows, loadWatchlistRows, parseWatchlistEntity, type WatchlistRow } from '../../../protocol/watchlistRows.js'
import { statoblastDisplayCache } from '../../../protocol/statoblastPageCache.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh } from '../../useStatoblastPageRefresh.js'
import type { SecurityPoolActions } from './SecurityPoolControls.js'
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
	enabled,
	environmentKey,
	registerPageRefresh,
}: {
	pool: Address
	universeId: bigint
	actions: SecurityPoolActions
	admission: SecurityPoolAccountSnapshot['admission'] | undefined
	owner: Address | undefined
	enabled: boolean
	environmentKey: number
	registerPageRefresh: RegisterStatoblastPageRefresh | undefined
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
			const rows = await withTimeout(
				loadWatchlistRows(createConnectedReadClient(), saved, universeId, owner, profile, {
					includeDeposits: false,
					onChunk: (_rows, _finished, _total, anchor) => {
						now = anchor.timestamp
					},
				}),
				15_000,
				pageCopy.savedQuestionReadFailed,
			)
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
	const [result, setResult] = useState<{ status: string; id: bigint }>()
	const [error, setError] = useState<string>()
	const [checking, setChecking] = useState(false)
	const id = designQuestionId(actions.questionInput.trim())
	const selected = result?.id === id ? result : undefined
	const find = async () => {
		if (id === undefined || checking) return
		setError(undefined)
		setChecking(true)
		try {
			const client = createConnectedReadClient()
			const [entry] = await withTimeout(
				(async () => {
					const block = await client.getBlock()
					if (block.number === undefined) throw new Error('Could not confirm the latest block.')
					return await checkStatoblastEntries(client, [{ pool, questionId: id, universeId }], block.number, true)
				})(),
				15_000,
				'Question lookup timed out.',
			)
			if (entry?.status === 'failed') throw entry.error
			if (entry === undefined) throw new Error('Could not verify this question.')
			setResult({ status: entry.status, id })
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not find the question.')
		} finally {
			setChecking(false)
		}
	}
	return (
		<>
			<SectionBlock title={pageCopy.savedQuestions}>
				{rowsLoading && details === undefined && <LoadingText>{pageCopy.checking}</LoadingText>}
				<RetryableNotice message={rowsError} retryLabel={pageCopy.tryAgain} onRetry={() => void refreshRows()} disabled={rowsLoading} />
				{saved.length === 0 ? (
					<p>{pageCopy.emptySavedQuestionsDetail}</p>
				) : (
					<table className='statoblast-watchlist-table' role='table'>
						<thead>
							<tr>
								<th />
								<th scope='col'>{pageCopy.questionId}</th>
								<th scope='col'>{watchlistCopy.stage}</th>
								<th scope='col'>{watchlistCopy.yourPosition}</th>
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
								const outcome = question?.questionOutcome ?? 'none'
								const now = details?.now
								const trading = question !== undefined && now !== undefined && now < question.marketDetails.endTime && !question.universeHasForked && !question.ordinaryEscalationGameStarted && outcome === 'none'
								const completeSets = shares === undefined ? undefined : [shares.yesAttoShares, shares.noAttoShares, shares.invalidAttoShares].reduce((minimum, amount) => (amount < minimum ? amount : minimum))
								const holdings = outcome === 'none' ? completeSets : shares?.[`${outcome}AttoShares`]
								const page = { kind: 'question', pool, questionId: entry.questionId, tab: 'shares' } as const
								let sharesAction: 'mint' | 'redeem' | undefined
								if (trading) sharesAction = 'mint'
								if (outcome !== 'none' && (holdings ?? 0n) > 0n) sharesAction = 'redeem'
								const time = trading ? question?.marketDetails.endTime : row?.escalationEnd
								return (
									<tr key={entry.id} role='row'>
										<td role='cell'>
											<FavoriteToggle app='statoblast' id={entry.id} kind='question' entityLabel={title} confirmUnfavorite={() => shares === undefined || Object.values(shares).every(amount => amount === 0n) || window.confirm(watchlistCopy.unstarPositionConfirmation)} />
										</td>
										<td role='cell'>
											<a href={statoblastPageHref(page, universeId)}>{title}</a>
											{title !== questionId && (
												<small>
													<code>{questionId}</code>
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
										<td role='cell' data-label={watchlistCopy.yourPosition}>
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
			</SectionBlock>
			{admission?.mode === 'fixed' && (
				<SectionBlock title={pageCopy.whichQuestionsCanBeRegistered} description={pageCopy.fixedQuestionList}>
					<ul className='statoblast-watchlist-history'>
						{admission.questions.map(questionId => (
							<li key={questionId.toString()}>
								<code>{toHex(questionId)}</code>
							</li>
						))}
					</ul>
				</SectionBlock>
			)}
			<SectionBlock title={pageCopy.findByQuestionId}>
				<form
					onSubmit={event => {
						event.preventDefault()
						void find()
					}}
				>
					<FormInput
						aria-label={pageCopy.questionId}
						placeholder={pageCopy.questionId}
						value={actions.questionInput}
						onInput={event => {
							actions.setQuestionInput(event.currentTarget.value)
							setError(undefined)
						}}
						error={error ?? (actions.questionInput.trim() !== '' && id === undefined ? 'Enter a hexadecimal or decimal question ID.' : undefined)}
						action={
							<button type='submit' disabled={id === undefined || checking}>
								{checking ? pageCopy.checking : pageCopy.findQuestion}
							</button>
						}
					/>
				</form>
				{selected?.status === 'question' && (
					<p>
						{pageCopy.registeredHereLead}
						<a href={statoblastPageHref({ kind: 'question', pool, questionId: selected.id, tab: 'shares' })}>{pageCopy.openShares}</a>
					</p>
				)}
				{selected?.status === 'unprepared-question' && (
					<p>
						{pageCopy.unpreparedQuestionLead}
						<a href={statoblastPageHref({ kind: 'pool', pool, tab: 'fork' })}>{pageCopy.forkRecovery}</a>
					</p>
				)}
				{selected?.status === 'unregistered-question' && (
					<>
						<p>{pageCopy.questionNotRegistered}</p>
						<SecurityPoolButton model={actions} action='registerSecurityPoolQuestion' label={pageCopy.registerQuestion} pendingLabel={pageCopy.registeringQuestion} reason={actions.registerReason} onClick={actions.register} />
					</>
				)}
				{selected?.status === 'invalid-pool' && <p>{pageCopy.invalidPool}</p>}
			</SectionBlock>
		</>
	)
}
