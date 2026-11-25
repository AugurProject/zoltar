import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { formatDuration, formatTimestamp, formatTimestampDateTime } from '@zoltar/ui-core-shared/lib/formatters.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { currentStateCheckFailed, formatOldDataCheck } from '@zoltar/ui-core-shared/copy/transaction.js'
import { requiredSecurityPoolCollateral } from '../lib/capital.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { useSignal } from '@preact/signals'
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import { buildSecurityPoolCapitalCureRequest, buildSecurityPoolCapitalTakeOverWithBoundsRequest, securityPoolTakeoverSource, securityPoolTakeoverFill, securityPoolTakeoverTransfer } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capital, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as index } from '../../../contractArtifact.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import * as copy from '../../../copy/securityPoolTakeover.js'
import { changedSinceReview } from '../../../copy/app.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { withStatoblastRequestTimeout } from '../../../protocol/requestTimeout.js'
import { reviewBalance, type ReviewRow } from '../lib/reviewRows.js'

import { liquidationHealth, readKnownLiquidationTargets, useLiquidationTarget, type LiquidationTarget, type TakeoverSnapshot } from '../hooks/useLiquidationTarget.js'
import { useStatoblastRefreshError } from '../../useStatoblastPageRefresh.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'
import { followWithAutoRefresh } from '../../../copy/questionPage.js'
import { LiquidationPositionsTable, type LiquidationPositionRow } from './LiquidationPositionsTable.js'

function LiquidationTime({ timestamp }: { timestamp: bigint }) {
	const dateTime = formatTimestampDateTime(timestamp)
	if (dateTime === undefined) return undefined
	return (
		<time dateTime={dateTime} title={formatTimestamp(timestamp)}>
			{copy.formatUtcTime(dateTime.slice(11, 16))}
		</time>
	)
}

function liquidationReview(
	snapshot: TakeoverSnapshot,
	expected: Pick<LiquidationTarget, 'epoch' | 'position'>,
	positionId: bigint,
	build: (target: Pick<LiquidationTarget, 'epoch' | 'position'>) => { data: `0x${string}` },
	compare: (position: LiquidationTarget['position'], client: ReturnType<typeof createConnectedReadClient>, blockNumber: bigint) => readonly ReviewRow[] | Promise<readonly ReviewRow[]>,
) {
	let rows: readonly ReviewRow[] = []
	const readTarget = async () => {
		const client = withStatoblastRequestTimeout(createConnectedReadClient(), currentStateCheckFailed)
		const { number: blockNumber } = await client.getBlock()
		if (typeof blockNumber !== 'bigint') throw new Error(currentStateCheckFailed)
		const [epoch, position] = await Promise.all([client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch', blockNumber }), client.readContract({ address: snapshot.commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [positionId], blockNumber })])
		return { epoch, position, client, blockNumber }
	}
	let baseline = expected
	return {
		readReviewRows: () => rows,
		refreshReviewData: async () => {
			const target = await readTarget()
			const data = build(target).data
			baseline = target
			return data
		},
		validateBeforeSubmit: async () => {
			const { epoch, position, client, blockNumber } = await readTarget()
			const original = baseline.position
			if (epoch !== baseline.epoch || position.rep !== original.rep || position.commitment !== original.commitment || position.owner !== original.owner || position.batch !== original.batch || position.remainingCommitment !== original.remainingCommitment) throw new Error(changedSinceReview)
			rows = await compare(position, client, blockNumber)
		},
	}
}

export function SecurityPoolTakeover({
	model,
	actions,
	positionId,
	wallet,
	redesigned = false,
	autoRefresh = false,
}: {
	redesigned?: boolean
	autoRefresh?: boolean
	positionId?: bigint | undefined
	wallet?: Address | undefined
	model: { snapshot: TakeoverSnapshot | undefined; presentationSnapshot?: TakeoverSnapshot | undefined }
	actions: Pick<SecurityPoolActions, 'ownerReason' | 'scope' | 'busy' | 'runSecurityPoolAction'>
}) {
	const positionInput = useSignal(positionId?.toString() ?? '')
	const openedPosition = useSignal(positionId)
	const commitmentInput = useSignal('')
	const ownInput = useSignal('')
	const principalInput = useSignal('')
	const totalCommitmentInput = useSignal('')
	const sharedReasonId = useId()
	const openReasonId = useId()
	const cureReasonId = useId()
	const snapshot = model.snapshot
	const draftPosition = securityPoolUnsignedId(positionInput.value, 96)
	const id = redesigned ? openedPosition.value : draftPosition
	const canOpenPosition = draftPosition !== undefined && draftPosition > 0n
	const pool = snapshot ?? model.presentationSnapshot
	const target = useLiquidationTarget(snapshot, model.presentationSnapshot, id, redesigned)
	const preview = target.target
	const displayedSnapshot = target.displaySnapshot
	const fresh = target.fresh
	const refreshError = useStatoblastRefreshError(target.error, target.displayedAt)
	const ledgerKey = pool === undefined ? undefined : `zoltar-ui:positions:${pool.chainId}:${pool.capitalLedger}`
	const [known, setKnown] = useState<{ ledgerKey: string; positions: string[] }>()
	const walletPosition = wallet !== undefined && pool?.owner.toLowerCase() === wallet.toLowerCase() && pool.ownerAccount.positionId !== 0n ? pool.ownerAccount.positionId.toString() : undefined
	const selectablePositions = useMemo(() => {
		const positions = known?.ledgerKey === ledgerKey ? (known?.positions ?? []) : []
		return walletPosition === undefined || positions.includes(walletPosition) ? positions : [walletPosition, ...positions]
	}, [known, ledgerKey, walletPosition])
	const savedTargets = useMemo(() => (redesigned && pool !== undefined && selectablePositions.length > 0 ? readKnownLiquidationTargets(pool, selectablePositions) : undefined), [redesigned, pool, selectablePositions, fresh])
	const positionRows: LiquidationPositionRow[] = selectablePositions.map(knownId => {
		if (id?.toString() === knownId && preview !== undefined) return { id: knownId, position: preview.position, started: preview.started, health: target.health }
		const position = pool?.positions.find(candidate => candidate.id.toString() === knownId)
		if (position !== undefined && pool !== undefined) return { id: knownId, position, started: position.liquidationStarted, health: liquidationHealth(pool, position) }
		const saved = savedTargets?.get(knownId)
		return { id: knownId, position: saved?.value.target.position, started: saved?.value.target.started, health: saved?.value.health, savedAt: saved?.savedAt }
	})
	const [clock, setClock] = useState(Date.now)
	const readAge = target.displayedAt === undefined ? 0 : Math.max(0, clock - target.displayedAt)
	const elapsedSinceRead = BigInt(Math.floor(readAge / 1000))
	const visible = usePageVisible()
	useEffect(() => {
		if (!redesigned || ledgerKey === undefined) return
		try {
			const positions = (getBrowserStorage('localStorage')?.getItem(ledgerKey) ?? '').split(',').filter(value => /^\d{1,29}$/.test(value) && securityPoolUnsignedId(value, 96) !== undefined && BigInt(value) > 0n)
			setKnown({ ledgerKey, positions: [...new Set(positions.map(value => BigInt(value).toString()))].slice(0, 50) })
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
		}
	}, [ledgerKey, redesigned])
	// Bounds are consent for one position of one owner, so another target starts with none. A snapshot refresh or a half-typed ID is not a new target.
	const boundsTarget = pool === undefined || id === undefined ? undefined : `${pool.chainId}:${pool.universeId}:${pool.capitalLedger}:${pool.owner}:${id}`
	const lastBoundsTarget = useRef(boundsTarget)
	useEffect(() => {
		if (boundsTarget === undefined || boundsTarget === lastBoundsTarget.current) return
		const replacedTarget = lastBoundsTarget.current !== undefined
		lastBoundsTarget.current = boundsTarget
		if (replacedTarget) for (const bound of [commitmentInput, ownInput, principalInput, totalCommitmentInput]) bound.value = ''
	}, [boundsTarget])
	useEffect(() => {
		if (!redesigned || ledgerKey === undefined || id === undefined || fresh === undefined || fresh.position.commitment === 0n) return
		const selected = id.toString()
		setKnown(previous => {
			const positions = previous?.ledgerKey === ledgerKey ? previous.positions : []
			if (positions.includes(selected)) return previous
			const updated = [selected, ...positions].slice(0, 50)
			try {
				getBrowserStorage('localStorage')?.setItem(ledgerKey, updated.join(','))
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
			return { ledgerKey, positions: updated }
		})
	}, [ledgerKey, redesigned, id, fresh])
	useEffect(() => {
		if (!redesigned || !visible || preview === undefined || preview.started === 0n || target.displayedAt === undefined) return
		setClock(Date.now())
		const timer = setInterval(() => setClock(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [redesigned, preview, target.displayedAt, visible])
	const displayedSource =
		displayedSnapshot !== undefined && preview !== undefined && displayedSnapshot.conservativePrice > 0n && displayedSnapshot.liquidationPrice > 0n && displayedSnapshot.securityMultiplierBps > 0n
			? securityPoolTakeoverSource(displayedSnapshot, { ...preview.position, liquidationStarted: preview.started, liquidationPenaltyPaid: preview.penaltyPaid, liquidationElapsed: preview.elapsed })
			: undefined
	const source = fresh === undefined ? undefined : displayedSource
	const commitment = securityPoolAmountOrUndefined(commitmentInput.value, snapshot?.collateral.decimals ?? 18)
	const maximumOwnRep = securityPoolAmountOrUndefined(ownInput.value)
	const maximumOwnerPrincipal = securityPoolAmountOrUndefined(principalInput.value)
	const maximumOwnerCommitment = securityPoolAmountOrUndefined(totalCommitmentInput.value, snapshot?.collateral.decimals ?? 18)
	let reason = actions.ownerReason
	if (reason === undefined && redesigned && draftPosition !== id) reason = canOpenPosition ? copy.openPositionFirst : copy.enterTarget
	if (reason === undefined && (id === undefined || id === 0n)) reason = copy.enterTarget
	if (reason === undefined && fresh === undefined) reason = redesigned && target.error !== undefined ? copy.currentTargetRequired : (target.error ?? copy.loading)
	if (reason === undefined && snapshot !== undefined && (snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing)) reason = copy.inactive
	const distressed = preview !== undefined && displayedSnapshot !== undefined && preview.position.owner !== displayedSnapshot.owner && preview.position.commitment !== 0n && preview.position.maxHealthyPrice < displayedSnapshot.liquidationPrice && preview.started !== 0n
	// Takeover rewards remain pledged in the receiver vault. A preliminary cure that restores health stands without a transfer.
	const curable = distressed && source?.healthy === true && source.removed !== 0n
	let cureReason = reason
	if (reason === undefined && (!distressed || (source?.healthy === true && !curable))) reason = cureReason = copy.notEligible
	if (reason === undefined && curable) reason = copy.cureInstead
	if (reason === undefined && source?.maximumTakeoverCommitment === 0n) reason = copy.additionalBacking
	if (cureReason === undefined && !curable) cureReason = copy.takeOverInstead
	if (reason === undefined && (commitment === undefined || commitment === 0n || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined)) reason = copy.enterBounds
	if (reason === undefined && snapshot !== undefined && source !== undefined && commitment !== undefined && maximumOwnRep !== undefined && maximumOwnerPrincipal !== undefined && maximumOwnerCommitment !== undefined) {
		const { commitment: transferred, takeoverReward } = securityPoolTakeoverFill(source, commitment, snapshot.economics.minimumCommitmentAttoEth)
		const receiver = snapshot.positions.find(position => position.id === snapshot.ownerAccount.positionId)
		const principal = (receiver?.rep ?? 0n) + snapshot.ownerAccount.freeAttoRep + takeoverReward
		const totalCommitment = (receiver?.commitment ?? 0n) + transferred
		if (securityPoolTakeoverTransfer(source, commitment) === undefined) reason = copy.strandsSource
		else if (snapshot.ownerAccount.positionId !== 0n && receiver === undefined) reason = copy.receiverMissing
		else if (receiver !== undefined && receiver.batch !== 0n && receiver.batch !== source.batch) reason = copy.receiverCohort
		else if (snapshot.ownerAccount.freeAttoRep > maximumOwnRep) reason = copy.receiverConsent
		else if (principal < requiredSecurityPoolCollateral(snapshot, totalCommitment)) reason = copy.receiverCollateral
		else if (totalCommitment < snapshot.economics.minimumCommitmentAttoEth) reason = copy.receiverMinimum
		else if (principal > maximumOwnerPrincipal) reason = copy.receiverPrincipalBound
		else if (totalCommitment > maximumOwnerCommitment) reason = copy.receiverCommitmentBound
	}

	const cure = async () => {
		if (cureReason !== undefined || snapshot === undefined || fresh === undefined || source === undefined || id === undefined) throw new Error(cureReason ?? copy.notEligible)
		const build = (target: Pick<LiquidationTarget, 'epoch' | 'position'>) => buildSecurityPoolCapitalCureRequest({ owner: snapshot.owner, capitalLedger: snapshot.capitalLedger, positionId: id, commitment: target.position.commitment, expectedAcceptedPriceEpoch: target.epoch, expectedSourceBatch: target.position.batch })
		await actions.runSecurityPoolAction('cureSecurityPoolPosition', copy.cure, () => ({
			...build(fresh),
			reviewDescription: copy.cureReview,
			...liquidationReview(snapshot, fresh, id, build, async (position, client, blockNumber) => {
				const [[, totalCommitmentAttoEth], demandAttoEth] = await Promise.all([client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'totals', blockNumber }), client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'demandAttoEth', blockNumber })])
				const cured = securityPoolTakeoverSource({ ...snapshot, totalCommitmentAttoEth, demandAttoEth }, position)
				if (!cured.healthy || cured.removed === 0n) throw new Error(changedSinceReview)
				return [reviewBalance(copy.targetCommitment, position.commitment, cured.commitment, snapshot.collateral.decimals, snapshot.collateral.symbol)]
			}),
		}))
	}
	const takeOver = async () => {
		if (reason !== undefined || snapshot === undefined || fresh === undefined || source === undefined || id === undefined || commitment === undefined || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined) throw new Error(reason ?? copy.enterBounds)
		const minimumTakeoverReward = securityPoolTakeoverFill(source, commitment, snapshot.economics.minimumCommitmentAttoEth).takeoverReward
		const build = (target: Pick<LiquidationTarget, 'epoch' | 'position'>) =>
			buildSecurityPoolCapitalTakeOverWithBoundsRequest({
				owner: snapshot.owner,
				capitalLedger: snapshot.capitalLedger,
				positionId: id,
				commitment,
				minimumTakeoverReward,
				maximumOwnRep,
				bounds: { maximumOwnerPrincipal, maximumOwnerCommitment, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps || 10_000n, expectedAcceptedPriceEpoch: target.epoch, expectedSourceBatch: target.position.batch },
			})
		await actions.runSecurityPoolAction('takeOverSecurityPoolPosition', copy.takeOver, () => ({
			...build(fresh),
			reviewDescription: copy.review,
			...liquidationReview(snapshot, fresh, id, build, position => {
				const maximumTransfer = [position.commitment, commitment, maximumOwnerCommitment].reduce((least, next) => (least < next ? least : next))
				const { symbol, decimals } = snapshot.collateral
				const rows = [{ label: copy.additionalCommitment, value: copy.addedUpTo(formatUnits(maximumTransfer, decimals), symbol) }]
				if (maximumOwnRep > 0n) rows.push({ label: copy.ownRepPledged, value: copy.addedUpTo(formatUnits(maximumOwnRep, 18), common.rep) })
				// Quote the encoded floor. The live reward grows over time and does not invalidate the reviewed limits.
				if (minimumTakeoverReward > 0n) rows.push({ label: copy.takeoverReward, value: copy.rewardAtLeast(formatUnits(minimumTakeoverReward, 18), common.rep) })
				return rows
			}),
		}))
	}
	const duration = displayedSnapshot?.liquidationDuration
	const liveElapsed = preview === undefined ? undefined : preview.elapsed + elapsedSinceRead
	const rewardProgress = getVisualRatio({ value: liveElapsed, maxValue: duration })
	const now = displayedSnapshot === undefined ? undefined : displayedSnapshot.timestamp + elapsedSinceRead
	const fullRewardAt = displayedSnapshot === undefined || preview === undefined || duration === undefined || displayedSnapshot.timestamp < preview.elapsed ? undefined : displayedSnapshot.timestamp - preview.elapsed + duration
	const liveTakeover =
		displayedSnapshot === undefined || preview === undefined || displayedSource === undefined || liveElapsed === undefined || elapsedSinceRead === 0n
			? displayedSource
			: securityPoolTakeoverSource(displayedSnapshot, { ...preview.position, liquidationStarted: preview.started, liquidationPenaltyPaid: preview.penaltyPaid, liquidationElapsed: liveElapsed })
	const laterTakeover =
		displayedSnapshot === undefined || preview === undefined || displayedSource === undefined || duration === undefined ? undefined : securityPoolTakeoverSource(displayedSnapshot, { ...preview.position, liquidationStarted: preview.started, liquidationPenaltyPaid: preview.penaltyPaid, liquidationElapsed: duration })
	const receiver = displayedSnapshot?.positions.find(position => position.id === displayedSnapshot.ownerAccount.positionId)
	const fill = displayedSnapshot === undefined || displayedSource === undefined || commitment === undefined ? undefined : securityPoolTakeoverFill(displayedSource, commitment, displayedSnapshot.economics.minimumCommitmentAttoEth)
	const pledgedBefore = receiver?.rep ?? 0n
	const unpledged = displayedSnapshot?.ownerAccount.freeAttoRep ?? 0n
	const commitmentBefore = receiver?.commitment ?? 0n
	const pledgedAfter = fill === undefined ? undefined : pledgedBefore + unpledged + fill.takeoverReward
	const commitmentAfter = fill === undefined ? undefined : commitmentBefore + fill.commitment
	const repNeededBefore = displayedSnapshot === undefined ? undefined : requiredSecurityPoolCollateral(displayedSnapshot, commitmentBefore)
	const repNeededAfter = displayedSnapshot === undefined || commitmentAfter === undefined ? undefined : requiredSecurityPoolCollateral(displayedSnapshot, commitmentAfter)
	const healthAt = (rep: bigint | undefined, commitment: bigint | undefined) => {
		if (displayedSnapshot === undefined || rep === undefined || commitment === undefined || commitment === 0n) return undefined
		const backing = requiredSecurityPoolCollateral(displayedSnapshot, commitment, undefined, 10_000n)
		return backing === 0n ? undefined : copy.formatHealth(formatUnits((rep * 10_000n) / backing, 2))
	}
	const applySuggestedBound = () => {
		if (source === undefined) return
		principalInput.value = formatUnits(pledgedBefore + unpledged + source.rep, 18)
	}
	const displayCollateral = (value: bigint | undefined) => <CurrencyValue value={value} suffix={pool?.collateral.symbol ?? collateralCopy.fallback} units={pool?.collateral.decimals ?? 0} />
	const displayRep = (value: bigint | undefined) => <CurrencyValue value={value} suffix={common.rep} />
	const formAge = readAge > 60_000 ? formatDuration(elapsedSinceRead) : undefined
	const staleFormDescription = formAge === undefined ? undefined : formatOldDataCheck(formAge)
	// Both actions often rest disabled for one shared cause, such as a missing position ID; that reason renders once for the pair.
	const sharedReason = actions.busy === undefined && reason !== undefined && reason === cureReason ? reason : undefined
	const reasonShownInForm = redesigned && !canOpenPosition && sharedReason === copy.enterTarget
	let reasonId = sharedReason === undefined ? undefined : sharedReasonId
	if (reasonShownInForm) reasonId = openReasonId
	const positionField = (
		<SecurityPoolInput
			label={copy.position}
			hint={redesigned ? undefined : copy.hint}
			value={positionInput.value}
			onChange={value => {
				positionInput.value = value
			}}
			disabled={actions.busy !== undefined}
		/>
	)
	const openPosition = (position: string) => {
		positionInput.value = position
		openedPosition.value = BigInt(position)
	}
	const showTakeoverOnly = redesigned && distressed && cureReason === copy.takeOverInstead
	const commitmentField = (
		<SecurityPoolInput
			label={copy.commitment}
			hint={pool?.collateral.symbol}
			value={commitmentInput.value}
			onChange={value => {
				commitmentInput.value = value
			}}
			disabled={actions.busy !== undefined}
			numeric
		/>
	)
	const limitFields = (
		<div className='form-grid'>
			{!redesigned && commitmentField}
			{[
				{ label: copy.maximumOwnRep, input: ownInput, units: common.rep },
				{ label: copy.maximumPrincipal, input: principalInput, units: common.rep },
				{ label: copy.maximumCommitment, input: totalCommitmentInput, units: pool?.collateral.symbol },
			].map(field => (
				<SecurityPoolInput
					key={field.label}
					label={field.label}
					hint={field.units}
					value={field.input.value}
					onChange={value => {
						field.input.value = value
					}}
					disabled={actions.busy !== undefined}
					numeric
				/>
			))}
		</div>
	)
	const work = (
		<SectionBlock title={redesigned && id !== undefined && id > 0n ? copy.formatTargetPosition(id.toString()) : copy.title} description={redesigned ? staleFormDescription : copy.description} badge={showTakeoverOnly ? <Badge tone='warning'>{copy.takeoverOnly}</Badge> : undefined}>
			{!redesigned && positionField}
			{showTakeoverOnly && <InlineHint id={cureReasonId} message={copy.takeOverInstead} />}
			{redesigned && distressed && preview !== undefined && (
				<div className='statoblast-liquidation-reward'>
					<strong>{copy.takeoverReward}</strong>
					{duration === undefined ? undefined : <p className='detail'>{copy.formatRewardGrowth(formatDuration(duration))}</p>}
					<div className='statoblast-liquidation-timeline'>
						<div>
							<span>{copy.startedPoint}</span>
							<LiquidationTime timestamp={preview.started} />
						</div>
						<div>
							<span>{copy.nowPoint}</span>
							{now === undefined ? undefined : <LiquidationTime timestamp={now} />}
						</div>
						<div>
							<span>{copy.fullRewardPoint}</span>
							{fullRewardAt === undefined ? undefined : <LiquidationTime timestamp={fullRewardAt} />}
						</div>
					</div>
					{rewardProgress === undefined ? undefined : <progress aria-label={copy.takeoverReward} max={1} value={rewardProgress} />}
					<dl className='statoblast-liquidation-reward-values'>
						<div>
							<dt>{copy.rewardNow}</dt>
							<dd>{displayRep(liveTakeover?.maximumTakeoverReward)}</dd>
							<dt>{copy.takeoverNow}</dt>
							<dd>{displayCollateral(liveTakeover?.maximumTakeoverCommitment)}</dd>
						</div>
						<div>
							<dt>{copy.rewardMax}</dt>
							<dd>{displayRep(laterTakeover?.maximumTakeoverReward)}</dd>
							<dt>{copy.takeoverLater}</dt>
							<dd>{displayCollateral(laterTakeover?.maximumTakeoverCommitment)}</dd>
						</div>
					</dl>
					{formAge === undefined ? undefined : <p className='detail'>{copy.formatDataAge(formAge)}</p>}
					{!autoRefresh && <p className='detail'>{followWithAutoRefresh}</p>}
				</div>
			)}
			{!redesigned && (
				<MetricGrid>
					<MetricField label={copy.targetRep}>{displayRep(preview?.position.rep)}</MetricField>
					<MetricField label={copy.targetCommitment}>{displayCollateral(preview?.position.commitment)}</MetricField>
					<MetricField label={copy.takeoverLimit}>{displayCollateral(displayedSource?.maximumTakeoverCommitment)}</MetricField>
					<MetricField label={copy.takeoverReward}>{displayRep(displayedSource?.maximumTakeoverReward)}</MetricField>
					<MetricField label={copy.started}>
						<TimestampValue timestamp={preview?.started} relative={false} zeroText={copy.notStarted} />
					</MetricField>
				</MetricGrid>
			)}
			{redesigned && commitmentField}
			{redesigned ? (
				<fieldset className='statoblast-liquidation-limits'>
					<legend>{copy.limits}</legend>
					<p className='detail'>{copy.limitsHint}</p>
					{limitFields}
					<button type='button' className='secondary' disabled={!distressed || curable || source === undefined || source.maximumTakeoverCommitment === 0n || actions.busy !== undefined} onClick={applySuggestedBound}>
						{copy.suggestLimit}
					</button>
				</fieldset>
			) : (
				limitFields
			)}
			{redesigned && distressed && <p className='detail'>{copy.fillHint}</p>}
			<div className='actions'>
				<SecurityPoolButton model={actions} action='takeOverSecurityPoolPosition' label={copy.takeOver} pendingLabel={copy.takingOver} reason={reason} sharedReasonId={reasonId} onClick={takeOver} />
				<SecurityPoolButton model={actions} action='cureSecurityPoolPosition' label={copy.cure} pendingLabel={copy.curing} reason={cureReason} sharedReasonId={showTakeoverOnly ? cureReasonId : reasonId} onClick={cure} />
			</div>
			{sharedReason === undefined || reasonShownInForm ? undefined : (
				<div className='tx-action-feedback shared-action-reason'>
					<InlineHint id={sharedReasonId} message={sharedReason} />
				</div>
			)}
		</SectionBlock>
	)
	const comparison = redesigned && distressed && displayedSnapshot !== undefined && displayedSnapshot.owner.toLowerCase() === wallet?.toLowerCase() && (
		<aside className='statoblast-liquidation-comparison'>
			<SectionBlock title={copy.afterTakeover}>
				<dl>
					{[
						{ label: copy.commitmentColumn, before: displayCollateral(commitmentBefore), after: displayCollateral(commitmentAfter) },
						{ label: copy.pledgedColumn, before: displayRep(pledgedBefore), after: displayRep(pledgedAfter) },
						{ label: copy.formatRepNeeded(copy.formatHealth(formatUnits(displayedSnapshot.ownerAccount.targetHealthFactorBps || 10_000n, 2))), before: displayRep(repNeededBefore), after: displayRep(repNeededAfter) },
						{ label: copy.healthColumn, before: healthAt(pledgedBefore, commitmentBefore) ?? copy.healthUnavailable, after: healthAt(pledgedAfter, commitmentAfter) ?? copy.healthUnavailable },
					].map(({ label, before, after }) => (
						<div key={label}>
							<dt>{label}</dt>
							<dd>
								{before} → {after}
							</dd>
						</div>
					))}
				</dl>
				{pledgedAfter !== undefined && repNeededAfter !== undefined && pledgedAfter >= repNeededAfter && <p className='detail'>{copy.noDepositNeeded}</p>}
			</SectionBlock>
		</aside>
	)
	return (
		<>
			{redesigned && (
				<SectionBlock title={copy.knownPositions} description={copy.description}>
					<form
						className='statoblast-liquidation-lookup'
						onSubmit={event => {
							event.preventDefault()
							if (!canOpenPosition || actions.busy !== undefined) return
							if (openedPosition.value === draftPosition) target.retry()
							else openedPosition.value = draftPosition
						}}
					>
						{positionField}
						<div className='actions'>
							<button type='submit' className='secondary' disabled={!canOpenPosition || actions.busy !== undefined} aria-describedby={canOpenPosition ? undefined : openReasonId}>
								{copy.openPosition}
							</button>
						</div>
						{!canOpenPosition && <InlineHint id={openReasonId} message={copy.enterTarget} />}
					</form>
					{target.displayedAt !== undefined && <UpdatedAgo updatedAt={target.displayedAt} refreshing={target.loading} />}
					<RetryableNotice message={refreshError} retryLabel={tryAgain} onRetry={target.retry} />
					<LiquidationPositionsTable rows={positionRows} selected={id} collateral={pool?.collateral ?? { symbol: collateralCopy.fallback, decimals: 0 }} disabled={actions.busy !== undefined} onOpen={openPosition} />
					<p className='detail'>{copy.devicePositions}</p>
				</SectionBlock>
			)}
			{comparison ? (
				<div className='statoblast-liquidation-workspace'>
					{work}
					{comparison}
				</div>
			) : (
				work
			)}
		</>
	)
}
