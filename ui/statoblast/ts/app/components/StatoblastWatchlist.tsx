import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/watchlist.js'
import { useStatoblastPageRefresh, useStatoblastRefreshError, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '@zoltar/ui-statoblast-shared/features/useStatoblastPageRefresh.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { getAddress, isAddress, formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { createActiveEnvironmentGuard, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { ensureSentence, getErrorDetail } from '@zoltar/ui-core-shared/lib/errors.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { hasInvalidUniverseQueryParam, readUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { parseStatoblastPage, statoblastPageHref, type StatoblastPoolPage, type StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { checkStatoblastEntries } from '@zoltar/ui-statoblast-shared/protocol/statoblastEntries.js'
import { exportStatoblastWatchlist, importStatoblastWatchlist } from '@zoltar/ui-statoblast-shared/protocol/watchlistTransfer.js'
import { statoblastDisplayCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'
import { decodeWatchlistRows, loadWatchlistRows, parseWatchlistEntity, type WatchlistEntity, type WatchlistReadCheckpoint, type WatchlistRow } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'
import { withStatoblastRequestTimeout } from '@zoltar/ui-statoblast-shared/protocol/requestTimeout.js'
import { openHistory } from '../lib/watchlistHistory.js'
import { RecentWatchlistMetadata } from './RecentWatchlistMetadata.js'
import { WatchlistPoolForkStage, WatchlistQuestionStage } from './WatchlistStages.js'

function destination(entity: WatchlistEntity): StatoblastPoolPage | StatoblastQuestionPage {
	return entity.kind === 'pool' ? { kind: 'pool', pool: entity.pool, tab: 'capital' } : { kind: 'question', pool: entity.pool, questionId: entity.questionId, tab: 'shares' }
}

function openTarget(input: string, currentUniverse: bigint) {
	const value = input.trim()
	if (isAddress(value)) return { page: { kind: 'pool', pool: getAddress(value), tab: 'capital' } as const, universe: currentUniverse }
	const url = new URL(value, window.location.href)
	const { search } = parseRouteHash(url.hash)
	const page = parseStatoblastPage(url.hash)
	if ((page.kind !== 'pool' && page.kind !== 'question') || hasInvalidUniverseQueryParam(search) || hasInvalidUniverseQueryParam(url.search)) throw new Error('Enter a security pool address or a Statoblast link.')
	return { page, universe: readUniverseQueryParam(search) ?? readUniverseQueryParam(url.search) ?? currentUniverse }
}

function depositSearchHref(pool: Address, questionId: bigint) {
	const href = statoblastPageHref({ kind: 'question', pool, questionId, tab: 'reporting' })
	return `${href}${href.includes('?') ? '&' : '?'}locate=1`
}

function entryReason(status: WatchlistRow['status']) {
	if (status === 'unregistered-question') return pageCopy.invalidQuestion
	if (status === 'unprepared-question') return pageCopy.questionUnprepared
	if (status === 'invalid-pool') return pageCopy.missingPoolContract
	if (status === 'non-statoblast-contract') return pageCopy.invalidPool
	return undefined
}

function hasPosition(row: WatchlistRow | undefined) {
	if (row === undefined) return false
	const { shares, pledged, commitment, reportingPrincipal } = row
	return (pledged ?? 0n) > 0n || (commitment ?? 0n) > 0n || (reportingPrincipal ?? 0n) > 0n || (shares !== undefined && Object.values(shares).some(amount => amount > 0n))
}

export function StatoblastWatchlist({ enabled, universe, owner, environmentKey, registerPageRefresh, onReadStatus }: { registerPageRefresh: RegisterStatoblastPageRefresh; onReadStatus?: ReportStatoblastReadStatus | undefined; enabled: boolean; universe: bigint; owner: Address | undefined; environmentKey: number }) {
	const questions = useFavorites('statoblast', 'question')
	const pools = useFavorites('statoblast', 'pool')
	const source = [...questions.entries.map(({ id }) => parseWatchlistEntity(id, 'question')), ...pools.entries.map(({ id }) => parseWatchlistEntity(id, 'pool'))].filter(entity => entity !== undefined)
	const sourceKey = source.map(entity => entity.id).join(',')
	const profile = getActiveNetworkProfile()
	const history = openHistory(profile)
	const displayCache = statoblastDisplayCache(profile, { universeId: universe, owner, page: 'watchlist' }, decodeWatchlistRows)
	const poolLabels = new Map(pools.entries.map(entry => [entry.id, entry.label]))
	const [recent, setRecent] = useState(history.read)
	const [input, setInput] = useState('')
	const [opening, setOpening] = useState(false)
	const [openError, setOpenError] = useState<string>()
	const [readError, setReadError] = useState<string>()
	const [transferMessage, setTransferMessage] = useState<string>()
	const [importing, setImporting] = useState(false)
	const [loading, setLoading] = useState(false)
	const [progress, setProgress] = useState<{ completed: number; total: number }>()
	const [readAt, setReadAt] = useState<number>()
	const refreshError = useStatoblastRefreshError(readError, readAt)
	const [rows, setRows] = useState<ReadonlyMap<string, WatchlistRow>>(new Map())
	const inputId = useId()
	const fileId = useId()
	const generation = useRef(0)
	const tail = useRef(25)
	const inFlight = useRef<number>()
	const pendingRead = useRef<AbortController>()
	const watchlistRead = useRef<{ scope: string; checkpoint: WatchlistReadCheckpoint }>()
	const scope = `${environmentKey}:${universe}:${owner ?? ''}`
	const rowScope = useRef('')
	const refresh = async (automatic = false) => {
		if (!enabled || inFlight.current !== undefined || source.length === 0 || document.hidden) return
		const marker = ++generation.current
		inFlight.current = marker
		const abort = new AbortController()
		pendingRead.current = abort
		const guard = createActiveEnvironmentGuard()
		const current = () => generation.current === marker && guard.isCurrent()
		const first = source.slice(0, 25)
		let selected = source
		if (automatic && source.length > 25) {
			selected = [...first, ...source.slice(tail.current, tail.current + 10)]
			tail.current = tail.current + 10 >= source.length ? 25 : tail.current + 10
		}
		const readScope = `${scope}:${selected.map(entry => entry.id).join(',')}`
		if (watchlistRead.current?.scope !== readScope) watchlistRead.current = { scope: readScope, checkpoint: { rows: [] } }
		const { checkpoint } = watchlistRead.current
		setLoading(true)
		setProgress({ completed: Math.ceil(checkpoint.rows.length / 25), total: Math.ceil(selected.length / 25) })
		setReadError(undefined)
		const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.refreshTimeoutError, abort.signal)
		await loadWatchlistRows(client, selected, universe, owner, profile, {
			checkpoint,
			onChunk: (batch, finished, total, { observedAt }) => {
				if (!current()) return
				setRows(previous => new Map([...previous, ...batch.map(row => [row.entity.id, row] as const)]))
				setReadAt(previous => (previous === undefined ? observedAt : Math.min(previous, observedAt)))
				setProgress({ completed: Math.ceil(finished / 25), total: Math.ceil(total / 25) })
			},
		})
			.then(
				result => {
					if (!current()) return
					watchlistRead.current = undefined
					const anchor = checkpoint.anchor
					if (anchor === undefined) return
					const observedAt = anchor.observedAt
					setReadAt(previous => (selected.length === source.length || previous === undefined ? observedAt : Math.min(previous, observedAt)))
					if (selected.length === source.length) displayCache.write(result, anchor, observedAt)
				},
				error => {
					if (current()) setReadError(ensureSentence(getErrorDetail(error) ?? pageCopy.refreshFailedError))
				},
			)
			.finally(() => {
				if (pendingRead.current === abort) pendingRead.current = undefined
				if (inFlight.current === marker) inFlight.current = undefined
				if (current()) setLoading(false)
				if (generation.current === marker) generation.current++
			})
	}
	const refreshVisibleWatchlist = useRef(refresh)
	refreshVisibleWatchlist.current = refresh
	useEffect(() => {
		if (!enabled || source.length === 0) setLoading(false)
		if (rowScope.current !== scope) {
			rowScope.current = scope
			const cached = displayCache.read()
			setRows(new Map(cached?.value.map(row => [row.entity.id, row])))
			setReadAt(cached?.savedAt)
			setRecent(history.read())
			tail.current = 25
		}
		const cancel = () => {
			generation.current++
			inFlight.current = undefined
			pendingRead.current?.abort()
			pendingRead.current = undefined
			watchlistRead.current = undefined
		}
		const visibilityChanged = () => {
			if (!document.hidden) {
				void refreshVisibleWatchlist.current()
				return
			}
			cancel()
			setLoading(false)
		}
		document.addEventListener('visibilitychange', visibilityChanged)
		void refresh()
		return () => {
			document.removeEventListener('visibilitychange', visibilityChanged)
			cancel()
		}
	}, [enabled, scope, sourceKey])
	useBlockRefresh(event => void refresh(event.reason === 'block'), enabled)
	useStatoblastPageRefresh(registerPageRefresh, refresh)
	const refreshingLabel = progress === undefined || progress.total < 2 ? pageCopy.refreshingSavedItems : pageCopy.formatRefreshProgress(Math.min(progress.completed + 1, progress.total), progress.total)
	useEffect(() => onReadStatus?.(readAt, loading ? refreshingLabel : undefined), [readAt, loading, refreshingLabel, onReadStatus])
	const visibleRows = rowScope.current === scope ? rows : new Map<string, WatchlistRow>()
	const remember = (page: StatoblastPoolPage | StatoblastQuestionPage, title: string, selectedUniverse = universe) => {
		history.add(page, title, selectedUniverse)
		setRecent(history.read())
	}
	const open = async () => {
		if (opening || input.trim() === '') return
		setOpening(true)
		setOpenError(undefined)
		const guard = createActiveEnvironmentGuard()
		try {
			const { page, universe: targetUniverse } = openTarget(input, universe)
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), 'Opening this item timed out. Try again.')
			const head = await client.getBlock()
			if (head.number === undefined) throw new Error('Could not confirm the latest block.')
			const [result] = await checkStatoblastEntries(client, [{ pool: page.pool, universeId: targetUniverse, ...(page.kind === 'question' ? { questionId: page.questionId } : {}) }], head.number, true)
			if (!guard.isCurrent()) return
			if (result?.status === 'failed') throw result.error
			if (result?.status === 'unprepared-question') {
				const forkPage = { kind: 'pool', pool: page.pool, tab: 'fork' } as const
				remember(forkPage, page.pool, targetUniverse)
				window.location.hash = statoblastPageHref(forkPage, targetUniverse)
				return
			}
			if (result?.status !== 'pool' && result?.status !== 'question') throw new Error(entryReason(result?.status ?? 'failed') ?? 'Could not verify this item.')
			remember(page, page.kind === 'pool' ? page.pool : formatQuestionIdHex(page.questionId), targetUniverse)
			window.location.hash = statoblastPageHref(page, targetUniverse)
		} catch (error) {
			if (guard.isCurrent()) setOpenError(error instanceof Error ? error.message : 'Could not open this item.')
		} finally {
			if (guard.isCurrent()) setOpening(false)
		}
	}
	const exportFile = () => {
		const blob = new Blob([exportStatoblastWatchlist(profile)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = 'statoblast-watchlist.json'
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 0)
		setTransferMessage('Exported the watchlist and deposits located on this device.')
	}
	const importFile = async (file: File | undefined) => {
		if (file === undefined || importing) return
		const guard = createActiveEnvironmentGuard()
		setImporting(true)
		setTransferMessage(undefined)
		try {
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.importTimeoutError)
			const result = await importStatoblastWatchlist(client, profile, universe, await file.text(), guard.isCurrent)
			setTransferMessage(result.skipped === 0 ? 'Watchlist imported.' : `Watchlist imported. Skipped ${result.skipped} entries.`)
		} catch (error) {
			setTransferMessage(error instanceof Error ? error.message : 'Could not import this watchlist.')
		} finally {
			setImporting(false)
		}
	}
	const remove = (entity: WatchlistEntity) => (entity.kind === 'pool' ? pools : questions).setFavorite(entity.id, false)
	const entityLink = (entity: WatchlistEntity, title: string, page = destination(entity), targetUniverse = universe, label = pageCopy.open) => (
		<a className='statoblast-outlined-link' href={statoblastPageHref(page, targetUniverse)} onClick={() => remember(page, title, targetUniverse)}>
			{label}
		</a>
	)
	const star = (entity: WatchlistEntity, title: string, row: WatchlistRow | undefined, savedRow?: () => WatchlistRow | undefined) => (
		<FavoriteToggle app='statoblast' id={entity.id} kind={entity.kind} entityLabel={title} confirmUnfavorite={() => !hasPosition(row ?? savedRow?.()) || window.confirm(pageCopy.unstarPositionConfirmation)} />
	)
	const questionRows = source.filter(entity => entity.kind === 'question')
	const poolRows = source.filter(entity => entity.kind === 'pool')
	const frozen = source.some(entity => {
		const row = visibleRows.get(entity.id)
		return (row?.forkedAt ?? 0n) > 0n || row?.question?.universeHasForked === true
	})
	return (
		<div className='route-view-flow statoblast-watchlist'>
			<RouteHeader title={pageCopy.watchlist} actions={<UpdatedAgo updatedAt={readAt} refreshing={loading} />} />
			<SectionBlock title={pageCopy.openTitle}>
				<form
					className='statoblast-watchlist-open'
					onSubmit={event => {
						event.preventDefault()
						void open()
					}}
				>
					<div className='field'>
						<label className='visually-hidden' htmlFor={inputId}>
							{pageCopy.securityPoolAddressOrLink}
						</label>
						<FormInput
							id={inputId}
							placeholder={pageCopy.poolAddressOrLink}
							value={input}
							onInput={event => setInput(event.currentTarget.value)}
							error={openError}
							liveError
							action={
								<button type='submit' className='statoblast-open-item' aria-label={pageCopy.open} aria-busy={opening} disabled={opening || !enabled || input.trim() === ''}>
									{opening ? <LoadingText>{pageCopy.open}</LoadingText> : pageCopy.open}
								</button>
							}
						/>
					</div>
				</form>
			</SectionBlock>
			{readError !== undefined && (
				<UserMessage
					placement='section'
					tone='error'
					detail={
						<>
							{refreshError}{' '}
							<button className='secondary' type='button' onClick={() => void refresh()}>
								{pageCopy.tryAgain}
							</button>
						</>
					}
					announcement='polite'
				/>
			)}
			{loading && <span role='status'>{refreshingLabel}</span>}
			{source.length === 0 && <EmptyState title={pageCopy.yourWatchlistIsEmpty} detail={pageCopy.emptyWatchlistDetail} />}
			{questionRows.length > 0 && (
				<SectionBlock title={pageCopy.savedQuestions} badge={frozen ? <Badge>{pageCopy.frozen}</Badge> : undefined}>
					<table className='statoblast-watchlist-table' role='table' aria-busy={loading}>
						<thead role='rowgroup'>
							<tr role='row'>
								<th role='columnheader'>{pageCopy.saved}</th>
								<th role='columnheader'>{pageCopy.question}</th>
								<th role='columnheader'>{pageCopy.securityPool}</th>
								<th role='columnheader'>{frozen ? pageCopy.afterTheFork : pageCopy.stage}</th>
								<th role='columnheader'>{pageCopy.yourShares}</th>
								<th role='columnheader'>{pageCopy.open}</th>
							</tr>
						</thead>
						<tbody role='rowgroup'>
							{questionRows.map(entity => {
								const row = visibleRows.get(entity.id)
								const questionTitle = row?.question?.marketDetails.title
								const questionId = formatQuestionIdHex(entity.questionId)
								const title = questionTitle ?? pageCopy.formatQuestion(questionId)
								const reason = row === undefined ? undefined : entryReason(row.status)
								const shares = row?.shares
								const completeSets = shares === undefined ? undefined : [shares.yesAttoShares, shares.noAttoShares, shares.invalidAttoShares].reduce((smallest, amount) => (amount < smallest ? amount : smallest))
								const onlyCompleteSets = shares !== undefined && shares.yesAttoShares === completeSets && shares.noAttoShares === completeSets && shares.invalidAttoShares === completeSets
								return (
									<tr role='row' key={entity.id}>
										<td role='cell'>{row?.status === 'unprepared-question' ? pageCopy.saved : star(entity, title, row)}</td>
										<td role='cell' className='statoblast-watchlist-question-title'>
											{questionTitle === undefined ? (
												<>
													<strong>{pageCopy.question}</strong> <IdentifierValue value={questionId} abbreviated />
												</>
											) : (
												<strong>{questionTitle}</strong>
											)}
											{row?.missingDeposits !== undefined && (
												<p>
													<CurrencyValue value={row.missingDeposits} suffix={pageCopy.rep} />
													{pageCopy.missingDepositsTail}
													<a href={depositSearchHref(entity.pool, entity.questionId)}>{pageCopy.locateThem}</a>
												</p>
											)}
										</td>
										<td role='cell' data-label='Security pool'>
											<AddressValue longAbbreviation address={entity.pool} />
										</td>
										<td role='cell' data-label={frozen ? pageCopy.afterTheFork : pageCopy.stage}>
											{row === undefined && loading ? <span className='skeleton-line' aria-hidden='true' /> : <WatchlistQuestionStage row={row} reason={reason} />}
										</td>
										<td role='cell' data-label='Your shares'>
											{shares === undefined && (row === undefined && loading ? <span className='skeleton-line' aria-hidden='true' /> : '—')}
											{onlyCompleteSets && <CurrencyValue value={completeSets} suffix={row?.collateral === undefined ? pageCopy.sets : pageCopy.formatSets(row.collateral)} units={row?.collateralDecimals ?? 18} />}
											{shares !== undefined && !onlyCompleteSets && (
												<>
													{pageCopy.yesLead}
													<CurrencyValue value={shares.yesAttoShares} units={row?.collateralDecimals ?? 18} />
													{pageCopy.noTail}
													<CurrencyValue value={shares.noAttoShares} units={row?.collateralDecimals ?? 18} />
													{pageCopy.invalidTail}
													<CurrencyValue value={shares.invalidAttoShares} units={row?.collateralDecimals ?? 18} />
												</>
											)}
										</td>
										<td role='cell'>
											{row?.status === 'unprepared-question' && entityLink(entity, entity.pool, { kind: 'pool', pool: entity.pool, tab: 'fork' }, universe, pageCopy.forkRecovery)}
											{row?.status !== 'unprepared-question' && reason !== undefined && (
												<button type='button' className='secondary' onClick={() => remove(entity)}>
													{pageCopy.remove}
												</button>
											)}
											{reason === undefined && entityLink(entity, title)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
					{frozen && <small>{pageCopy.migrateSharesHint}</small>}
				</SectionBlock>
			)}
			<SectionBlock title={pageCopy.savedSecurityPools} badge={frozen ? <Badge>{pageCopy.frozen}</Badge> : undefined} actions={<a href={statoblastPageHref({ kind: 'deploy-pool' })}>{pageCopy.deployPool}</a>}>
				{poolRows.length === 0 ? (
					<EmptyState title={pageCopy.noSavedSecurityPools} />
				) : (
					<table className='statoblast-watchlist-table' role='table' aria-busy={loading}>
						<thead role='rowgroup'>
							<tr role='row'>
								<th role='columnheader'>{pageCopy.saved}</th>
								<th role='columnheader'>{pageCopy.securityPool}</th>
								<th role='columnheader'>{frozen ? pageCopy.afterTheFork : pageCopy.repPrice}</th>
								{!frozen && <th role='columnheader'>{pageCopy.capacityInUse}</th>}
								<th role='columnheader'>{pageCopy.yourPosition}</th>
								<th role='columnheader'>{pageCopy.open}</th>
							</tr>
						</thead>
						<tbody role='rowgroup'>
							{poolRows.map(entity => {
								const row = visibleRows.get(entity.id)
								const reason = row === undefined ? undefined : entryReason(row.status)
								const priceStatus = row?.priceValid ? pageCopy.repPriceCurrent : pageCopy.repPriceDue
								let open = entityLink(entity, entity.pool)
								if (frozen && row?.forkBranchReady && row.forkChildUniverse !== undefined) open = entityLink(entity, entity.pool, undefined, row.forkChildUniverse)
								else if (frozen) open = entityLink(entity, entity.pool, { kind: 'pool', pool: entity.pool, tab: 'fork' }, universe, row?.forkChoiceRecorded ? pageCopy.open : pageCopy.forkRecovery)
								const placeholder = row === undefined && loading ? <span className='skeleton-line' aria-hidden='true' /> : '—'
								const used = getVisualRatio({ value: row?.demand, maxValue: row?.capacity })
								return (
									<tr role='row' key={entity.id}>
										<td role='cell'>{star(entity, entity.pool, row)}</td>
										<td role='cell'>
											<AddressValue longAbbreviation address={entity.pool} />
											{poolLabels.get(entity.id) === undefined ? undefined : <strong>{poolLabels.get(entity.id)}</strong>}
											<small>
												{row?.collateral}
												{row?.admission === undefined ? undefined : pageCopy.poolPolicy[row.admission]}
												{row?.annualFee === undefined ? '' : pageCopy.formatAnnualFee(formatUnits(row.annualFee, 2))}
												{row?.purchaseFee === undefined ? undefined : pageCopy.formatPurchaseFee(formatUnits(row.purchaseFee, 2))}
												{row?.minimumFee === undefined || row.minimumFee === 0n ? undefined : (
													<>
														{' '}
														· <CurrencyValue value={row.minimumFee} suffix={row.collateral ?? ''} units={row.collateralDecimals ?? 18} />
													</>
												)}
											</small>
										</td>
										<td role='cell' data-label={frozen ? pageCopy.afterTheFork : pageCopy.repPrice}>
											{row === undefined && loading ? (
												<span className='skeleton-line' aria-hidden='true' />
											) : (
												(reason ??
												(frozen ? (
													<WatchlistPoolForkStage row={row} />
												) : (
													<a href={statoblastPageHref({ kind: 'pool', pool: entity.pool, tab: 'price' })}>
														<Badge tone={row?.priceValid ? 'ok' : 'muted'}>{row?.priceValid === undefined ? pageCopy.unavailable : priceStatus}</Badge>
													</a>
												)))
											)}
										</td>
										{!frozen && (
											<td role='cell' data-label='Capacity in use'>
												{row?.demand === undefined || row.capacity === undefined ? (
													placeholder
												) : (
													<>
														{used === undefined ? undefined : <meter max={1} value={used} aria-label={pageCopy.capacityInUse} />}
														<small>
															<CurrencyValue value={row.demand} units={row.collateralDecimals ?? 18} notation='compact' accessibleUnit={row.collateral ?? ''} />
															{pageCopy.capacitySeparator}
															<CurrencyValue value={row.capacity} units={row.collateralDecimals ?? 18} notation='compact' suffix={row.collateral ?? ''} />
														</small>
													</>
												)}
											</td>
										)}
										<td role='cell' data-label='Your position'>
											{row?.pledged === undefined ? (
												placeholder
											) : (
												<>
													<CurrencyValue value={row.pledged} suffix={pageCopy.rep} />
													{pageCopy.pledgedTail}
													{row.commitment === undefined ? undefined : (
														<small>
															<CurrencyValue value={row.commitment} suffix={row.collateral ?? ''} units={row.collateralDecimals ?? 18} />
															{pageCopy.committedTail}
															{row.healthBps === undefined ? undefined : ` · ${formatUnits(row.healthBps, 2)}${pageCopy.healthTail}`}
														</small>
													)}
													{row.earnedCollateral === undefined || row.earnedRep === undefined || row.earnedCollateral + row.earnedRep === 0n ? undefined : (
														<small>
															{pageCopy.earnedLead}
															<CurrencyValue value={row.earnedCollateral} suffix={row.collateral ?? ''} units={row.collateralDecimals ?? 18} /> · <CurrencyValue value={row.earnedRep} suffix={pageCopy.rep} />
														</small>
													)}
												</>
											)}
										</td>
										<td role='cell'>
											{reason === undefined ? (
												open
											) : (
												<button type='button' className='secondary' onClick={() => remove(entity)}>
													{pageCopy.remove}
												</button>
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				)}
			</SectionBlock>
			<div className='actions statoblast-watchlist-transfer'>
				<button type='button' className='secondary' onClick={exportFile}>
					{pageCopy.exportWatchlist}
				</button>
				<input
					id={fileId}
					type='file'
					accept='.json,application/json'
					disabled={importing || !enabled}
					aria-label={pageCopy.importWatchlist}
					onChange={event => {
						const file = event.currentTarget.files?.[0]
						event.currentTarget.value = ''
						void importFile(file)
					}}
				/>
				<label htmlFor={fileId}>{importing ? pageCopy.importing : pageCopy.importWatchlist}</label>
				{transferMessage === undefined ? undefined : <UserMessage detail={transferMessage} announcement='polite' />}
			</div>
			{recent.length > 0 && (
				<SectionBlock
					title={pageCopy.recentlyOpened}
					actions={
						<button
							type='button'
							className='secondary'
							onClick={() => {
								history.clear()
								setRecent([])
							}}
						>
							{pageCopy.clearHistory}
						</button>
					}
				>
					<ul className='statoblast-watchlist-history'>
						{recent.map(item => {
							const page = parseStatoblastPage(item.hash)
							if (page.kind !== 'pool' && page.kind !== 'question') return undefined
							const id = page.kind === 'pool' ? page.pool.toLowerCase() : `${page.pool.toLowerCase()}:${formatQuestionIdHex(page.questionId)}`
							const entity = { ...page, id }
							const openedUniverse = BigInt(item.universe)
							const row = openedUniverse === universe ? visibleRows.get(id) : undefined
							const title = page.kind === 'pool' ? (poolLabels.get(id) ?? item.title) : (row?.question?.marketDetails.title ?? item.title)
							const questionId = page.kind === 'question' ? formatQuestionIdHex(page.questionId) : undefined
							const idTitle = questionId !== undefined && (title.toLowerCase() === questionId || title === pageCopy.formatQuestion(questionId))
							const questionName = idTitle ? pageCopy.formatQuestion(questionId) : title
							const questionTitle = idTitle ? (
								<>
									<strong>{pageCopy.question}</strong> <IdentifierValue value={questionId} abbreviated />
								</>
							) : (
								<strong>{title}</strong>
							)
							const starLabel = page.kind === 'question' ? pageCopy.questionInPool(questionName, page.pool) : `${pageCopy.securityPool} ${page.pool}`
							const savedRow = () =>
								statoblastDisplayCache(profile, { universeId: openedUniverse, owner, page: 'watchlist' }, decodeWatchlistRows)
									.read()
									?.value.find(candidate => candidate.entity.id === id)
							return (
								<li key={`${item.hash}:${item.universe}`}>
									{row?.status === 'unprepared-question' ? pageCopy.saved : star(entity, starLabel, row, savedRow)}
									<div className='statoblast-history-identity'>
										{page.kind === 'pool' ? <AddressValue longAbbreviation address={page.pool} /> : questionTitle}
										<RecentWatchlistMetadata page={page} collateral={row?.collateral} openedAt={item.opened} universe={openedUniverse} />
									</div>
									<a className='statoblast-outlined-link' href={statoblastPageHref(page, openedUniverse)} onClick={() => remember(page, title, openedUniverse)}>
										{pageCopy.open}
									</a>
								</li>
							)
						})}
					</ul>
					<small className='statoblast-history-limit'>{pageCopy.recentlyOpenedLimit}</small>
				</SectionBlock>
			)}
		</div>
	)
}
