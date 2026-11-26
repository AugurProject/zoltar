import * as pageCopy from '../../../copy/reportingDeposits.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createActiveEnvironmentGuard, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { formatCurrencyBalanceWithUnit, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import { locatedDepositKey, reportingDepositStore } from '../../../protocol/reportingDeposits.js'
import { reportingDepositCursorStore, reportingDepositRead, searchReportingDepositsPage } from '../../../protocol/reportingDepositSearch.js'

const retryDelays = [250, 1000, 4000]

export function LocateReportingDeposits({ details, wallet, refresh, openOnEntry = false }: { openOnEntry?: boolean; details: ActiveReportingDetails; wallet: Address; refresh: () => Promise<void> }) {
	const [open, setOpen] = useState(openOnEntry)
	const [attempt, setAttempt] = useState(0)
	const [status, setStatus] = useState<'idle' | 'searching' | 'exhausted' | 'failed'>('idle')
	const [inspected, setInspected] = useState(0n)
	const [progress, setProgress] = useState<{ count: bigint; seconds: bigint }>()
	const [manualIndex, setManualIndex] = useState('')
	const [checkingIndex, setCheckingIndex] = useState(false)
	const [indexError, setIndexError] = useState<string>()
	const [searchError, setSearchError] = useState<string>()
	const singleFlight = useRef({ pending: false })
	const publishing = useRef<Promise<void>>()
	const indexInputId = useId()
	const visible = usePageVisible()
	const { escalationGameAddress, reportingDepositPool, reportingQuestionId, universeId } = details
	const missing = details.sides.find(side => (details.questionOutcome === 'none' || details.questionOutcome === side.key) && (side.localPrincipalAttoRep ?? 0n) > side.userDeposits.reduce((total, deposit) => total + deposit.amountAttoRep, 0n))
	const outcome = missing?.key
	const total = missing?.localPrincipalAttoRep
	const locatedPrincipal = missing?.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n) ?? 0n
	// Publishing a page updates the located stake. Keep the live cursor across those updates.
	const latest = useRef({ missing, locatedPrincipal, refresh })
	latest.current = { missing, locatedPrincipal, refresh }
	useEffect(() => {
		if (!open || !visible || checkingIndex || reportingDepositPool === undefined || reportingQuestionId === undefined || outcome === undefined || total === undefined) return
		const side = { pool: reportingDepositPool, questionId: reportingQuestionId, universeId, depositor: wallet, outcome }
		const profile = getActiveNetworkProfile()
		const guard = createActiveEnvironmentGuard()
		const abort = new AbortController()
		const client = withStatoblastRequestTimeout(createConnectedReadClient(), 'Deposit search timed out.', abort.signal, singleFlight.current)
		const deposits = reportingDepositStore(profile)
		const cursors = reportingDepositCursorStore(profile, side)
		const initial = latest.current
		const known = new Set((initial.missing?.userDeposits ?? []).map(deposit => locatedDepositKey({ ...side, index: deposit.depositIndex })))
		let current = true
		let timeout: ReturnType<typeof setTimeout> | undefined
		let cursor = cursors.read()
		let startIndex = cursor?.nextIndex ?? 0n
		let startedAt = Date.now()
		setInspected(startIndex)
		let found = initial.locatedPrincipal
		let failures = 0
		const active = () => current && !document.hidden && guard.isCurrent()
		const work = async () => {
			if (publishing.current !== undefined) await publishing.current
			if (!active()) return
			setStatus('searching')
			try {
				const pageStartedAt = Date.now()
				const result = await searchReportingDepositsPage(client, escalationGameAddress, side, cursor)
				if (!active()) return
				if (result.restarted) {
					// Deposits located on the old chain cannot count toward completion on the new chain.
					known.clear()
					found = 0n
					startIndex = 0n
					startedAt = pageStartedAt
					setProgress(undefined)
				}
				deposits.add(result.matches.map(match => match.deposit))
				if (result.confirmed !== undefined) cursors.write(result.confirmed)
				cursor = result.position
				setInspected(cursor.nextIndex)
				const count = result.totalDeposits
				const scanned = cursor.nextIndex - startIndex
				if (count !== undefined && scanned > 0n && count >= cursor.nextIndex) {
					const elapsed = BigInt(Math.max(1, Date.now() - startedAt))
					setProgress({ count, seconds: ((count - cursor.nextIndex) * elapsed + scanned * 1000n - 1n) / (scanned * 1000n) })
				}
				let foundNewDeposits = false
				for (const { deposit, principal } of result.matches) {
					const key = locatedDepositKey(deposit)
					if (known.has(key)) continue
					known.add(key)
					found += principal
					foundNewDeposits = true
				}
				if (foundNewDeposits || result.restarted || result.end) {
					const publication = latest.current.refresh().catch(() => undefined)
					publishing.current = publication
					await publication
					if (publishing.current === publication) publishing.current = undefined
					if (!active()) return
				}
				if (found >= total || result.end) {
					setStatus(found >= total ? 'idle' : 'exhausted')
					return
				}
				failures = 0
				timeout = setTimeout(() => void work(), 0)
			} catch (error) {
				if (!active()) return
				const delay = retryDelays[failures++]
				if (delay === undefined) {
					setSearchError(getErrorMessage(error, pageCopy.searchFailedError))
					setStatus('failed')
				} else timeout = setTimeout(() => void work(), delay)
			}
		}
		void work()
		return () => {
			current = false
			abort.abort()
			clearTimeout(timeout)
		}
	}, [attempt, open, visible, checkingIndex, wallet, reportingDepositPool, reportingQuestionId, universeId, outcome, total, escalationGameAddress])
	if (missing === undefined || total === undefined || reportingDepositPool === undefined || reportingQuestionId === undefined) return undefined
	const missingOutcome = missing.key
	const checkIndex = async () => {
		if (!/^\d{1,78}$/u.test(manualIndex) || checkingIndex) return
		const index = BigInt(manualIndex)
		if (index >= 1n << 256n) {
			setIndexError(pageCopy.invalidDepositIndex)
			return
		}
		const guard = createActiveEnvironmentGuard()
		const profile = getActiveNetworkProfile()
		setCheckingIndex(true)
		setIndexError(undefined)
		try {
			if (publishing.current !== undefined) await publishing.current
			if (!guard.isCurrent()) return
			const client = withStatoblastRequestTimeout(createConnectedReadClient(), pageCopy.depositCheckTimeout)
			const [deposit] = await client.readContract(reportingDepositRead(escalationGameAddress, missingOutcome, index, 1n))
			if (!guard.isCurrent()) return
			if (deposit === undefined) throw new Error(pageCopy.depositNotFound(index, missing.label))
			if (!sameAddress(deposit.depositor, wallet)) throw new Error(pageCopy.depositWrongOwner)
			if (deposit.amountAttoRep === 0n) throw new Error(pageCopy.depositAlreadyClaimed)
			reportingDepositStore(profile).add([{ pool: reportingDepositPool, questionId: reportingQuestionId, universeId, depositor: wallet, outcome: missingOutcome, index, originalAttoRep: deposit.amountAttoRep }])
			await refresh()
		} catch (failure) {
			if (guard.isCurrent()) setIndexError(failure instanceof Error ? failure.message : pageCopy.depositCheckFailed)
		} finally {
			if (guard.isCurrent()) setCheckingIndex(false)
		}
	}
	const searchAgain = () => {
		if (status === 'exhausted') {
			reportingDepositCursorStore(getActiveNetworkProfile(), { pool: reportingDepositPool, questionId: reportingQuestionId, universeId, depositor: wallet, outcome: missingOutcome }).write(undefined)
			setInspected(0n)
			setProgress(undefined)
		}
		setAttempt(value => value + 1)
	}
	return (
		<details className='statoblast-deposit-search' open={open} onToggle={event => setOpen(event.currentTarget.open)}>
			<summary>{pageCopy.locateDeposits}</summary>
			<div className='statoblast-deposit-search-split'>
				<dl>
					<div>
						<dt>{pageCopy.formatStakeToLocate(missing.label)}</dt>
						<dd>
							<CurrencyValue value={total} suffix={pageCopy.rep} />
						</dd>
					</div>
					<div>
						<dt>{pageCopy.locatedStake}</dt>
						<dd>
							<CurrencyValue value={locatedPrincipal} suffix={pageCopy.rep} /> {pageCopy.formatDepositCount(missing.userDeposits.length)}
						</dd>
					</div>
					<div>
						<dt>{pageCopy.unlocatedStake}</dt>
						<dd>
							<CurrencyValue value={total - locatedPrincipal} suffix={pageCopy.rep} />
						</dd>
					</div>
				</dl>
				<meter min={0} max={1} aria-label={pageCopy.locatedStake} value={getVisualRatio({ value: locatedPrincipal, maxValue: total })} />
				<p>{pageCopy.unlocatedStakeSafe}</p>
			</div>
			{status === 'searching' && (
				<div role='status'>
					<progress max={1} aria-label={pageCopy.locateDeposits} value={getVisualRatio({ value: inspected, maxValue: progress?.count })} />
					<p>{progress === undefined ? `${inspected}${pageCopy.depositsCheckedTail}` : pageCopy.formatDepositSearchProgress(inspected, progress.count, formatDuration(progress.seconds))}</p>
					<p>{pageCopy.keepTabOpen}</p>
				</div>
			)}
			<details>
				<summary>{pageCopy.manualDepositLookup}</summary>
				<form
					onSubmit={event => {
						event.preventDefault()
						void checkIndex()
					}}
				>
					<label htmlFor={indexInputId}>{pageCopy.depositNumber}</label>
					<FormInput
						id={indexInputId}
						inputMode='numeric'
						value={manualIndex}
						onInput={event => setManualIndex(event.currentTarget.value)}
						error={indexError}
						action={
							<button type='submit' disabled={checkingIndex || !/^\d{1,78}$/u.test(manualIndex)}>
								{checkingIndex ? pageCopy.checking : pageCopy.checkDeposit}
							</button>
						}
					/>
				</form>
			</details>
			{(status === 'exhausted' || status === 'failed') && (
				<>
					<p role='status'>{status === 'failed' ? (searchError ?? pageCopy.searchFailedError) : pageCopy.formatMissingDepositsDetail(formatCurrencyBalanceWithUnit(total - locatedPrincipal, pageCopy.rep))}</p>
					<button type='button' onClick={searchAgain}>
						{pageCopy.searchAgain}
					</button>
				</>
			)}
		</details>
	)
}
