import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { requiredSecurityPoolCollateral } from '../lib/capital.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { useSignal } from '@preact/signals'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
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
import * as common from '@zoltar/ui-core-shared/copy/common.js'

import { useLiquidationTarget, type LiquidationTarget, type TakeoverSnapshot } from '../hooks/useLiquidationTarget.js'
import { useStatoblastRefreshError } from '../../useStatoblastPageRefresh.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { tryAgain } from '../../../copy/securityPoolPage.js'

export function SecurityPoolTakeover({ model, actions, redesigned = false }: { redesigned?: boolean; model: { snapshot: TakeoverSnapshot | undefined; presentationSnapshot?: TakeoverSnapshot | undefined }; actions: Pick<SecurityPoolActions, 'ownerReason' | 'scope' | 'busy' | 'runSecurityPoolAction'> }) {
	const positionInput = useSignal('')
	const commitmentInput = useSignal('')
	const ownInput = useSignal('')
	const principalInput = useSignal('')
	const totalCommitmentInput = useSignal('')
	const sharedReasonId = useId()
	const snapshot = model.snapshot
	const id = securityPoolUnsignedId(positionInput.value, 96)
	const pool = snapshot ?? model.presentationSnapshot
	const target = useLiquidationTarget(snapshot, model.presentationSnapshot, id, redesigned)
	const preview = target.target
	const displayedSnapshot = target.displaySnapshot
	const fresh = target.fresh
	const refreshError = useStatoblastRefreshError(target.error, target.displayedAt)
	const [knownPositions, setKnownPositions] = useState<string[]>([])
	const ledgerKey = pool === undefined ? undefined : `zoltar-ui:positions:${pool.chainId}:${pool.capitalLedger}`
	const [elapsedSinceRead, setElapsedSinceRead] = useState(0n)
	const visible = usePageVisible()
	useEffect(() => {
		if (!redesigned || ledgerKey === undefined) return
		try {
			setKnownPositions((getBrowserStorage('localStorage')?.getItem(ledgerKey) ?? '').split(',').filter(value => securityPoolUnsignedId(value, 96) !== undefined))
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
		setKnownPositions(previous => {
			if (previous.includes(selected)) return previous
			const updated = [selected, ...previous].slice(0, 50)
			try {
				getBrowserStorage('localStorage')?.setItem(ledgerKey, updated.join(','))
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
			return updated
		})
	}, [ledgerKey, redesigned, id, fresh])
	useEffect(() => {
		setElapsedSinceRead(0n)
		if (!redesigned || !visible || fresh === undefined || fresh.started === 0n || target.displayedAt === undefined) return
		const readAt = target.displayedAt
		const timer = setInterval(() => setElapsedSinceRead(BigInt(Math.floor((Date.now() - readAt) / 1000))), 1000)
		return () => clearInterval(timer)
	}, [redesigned, fresh, target.displayedAt, visible])
	const displayedSource =
		displayedSnapshot !== undefined && preview !== undefined && displayedSnapshot.liquidationPrice > 0n ? securityPoolTakeoverSource(displayedSnapshot, { ...preview.position, liquidationStarted: preview.started, liquidationPenaltyPaid: preview.penaltyPaid, liquidationElapsed: preview.elapsed }) : undefined
	const source = fresh === undefined ? undefined : displayedSource
	const commitment = securityPoolAmountOrUndefined(commitmentInput.value, snapshot?.collateral.decimals ?? 18)
	const maximumOwnRep = securityPoolAmountOrUndefined(ownInput.value)
	const maximumOwnerPrincipal = securityPoolAmountOrUndefined(principalInput.value)
	const maximumOwnerCommitment = securityPoolAmountOrUndefined(totalCommitmentInput.value, snapshot?.collateral.decimals ?? 18)
	let reason = actions.ownerReason
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

	const validateTarget = (current: LiquidationTarget, capitalLedger: TakeoverSnapshot['capitalLedger'], commitmentIndex: TakeoverSnapshot['commitmentIndex'], positionId: bigint) => async () => {
		const client = createConnectedReadClient()
		const epoch = await client.readContract({ address: capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch' })
		const position = await client.readContract({ address: commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [positionId] })
		if (epoch !== current.epoch || position.rep !== current.position.rep || position.commitment !== current.position.commitment || position.owner !== current.position.owner || position.batch !== current.position.batch) throw new Error(copy.changed)
	}
	const cure = async () => {
		if (cureReason !== undefined || snapshot === undefined || fresh === undefined || source === undefined || id === undefined) throw new Error(cureReason ?? copy.notEligible)
		await actions.runSecurityPoolAction('cureSecurityPoolPosition', copy.cure, () => ({
			...buildSecurityPoolCapitalCureRequest({ owner: snapshot.owner, capitalLedger: snapshot.capitalLedger, positionId: id, commitment: fresh.position.commitment, expectedAcceptedPriceEpoch: fresh.epoch, expectedSourceBatch: source.batch }),
			reviewDescription: copy.cureReview,
			validateBeforeSubmit: validateTarget(fresh, snapshot.capitalLedger, snapshot.commitmentIndex, id),
		}))
	}
	const takeOver = async () => {
		if (reason !== undefined || snapshot === undefined || fresh === undefined || source === undefined || id === undefined || commitment === undefined || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined) throw new Error(reason ?? copy.enterBounds)
		await actions.runSecurityPoolAction('takeOverSecurityPoolPosition', copy.takeOver, () => ({
			...buildSecurityPoolCapitalTakeOverWithBoundsRequest({
				owner: snapshot.owner,
				capitalLedger: snapshot.capitalLedger,
				positionId: id,
				commitment,
				minimumTakeoverReward: securityPoolTakeoverFill(source, commitment, snapshot.economics.minimumCommitmentAttoEth).takeoverReward,
				maximumOwnRep,
				bounds: { maximumOwnerPrincipal, maximumOwnerCommitment, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps || 10_000n, expectedAcceptedPriceEpoch: fresh.epoch, expectedSourceBatch: source.batch },
			}),
			reviewDescription: copy.review,
			validateBeforeSubmit: validateTarget(fresh, snapshot.capitalLedger, snapshot.commitmentIndex, id),
		}))
	}
	const duration = displayedSnapshot?.liquidationDuration
	const liveElapsed = preview === undefined ? undefined : preview.elapsed + elapsedSinceRead
	const rewardProgress = getVisualRatio({ value: liveElapsed, maxValue: duration })
	const timeBasedReward = preview === undefined || rewardProgress === undefined || duration === undefined || liveElapsed === undefined ? undefined : ((preview.position.rep + preview.penaltyPaid) * (liveElapsed > duration ? duration : liveElapsed)) / duration - preview.penaltyPaid
	const laterTakeover =
		displayedSnapshot === undefined || preview === undefined || displayedSource === undefined || duration === undefined ? undefined : securityPoolTakeoverSource(displayedSnapshot, { ...preview.position, liquidationStarted: preview.started, liquidationPenaltyPaid: preview.penaltyPaid, liquidationElapsed: duration })
	const receiver = displayedSnapshot?.positions.find(position => position.id === displayedSnapshot.ownerAccount.positionId)
	const fill = displayedSnapshot === undefined || displayedSource === undefined || commitment === undefined ? undefined : securityPoolTakeoverFill(displayedSource, commitment, displayedSnapshot.economics.minimumCommitmentAttoEth)
	const pledgedBefore = (receiver?.rep ?? 0n) + (displayedSnapshot?.ownerAccount.freeAttoRep ?? 0n)
	const commitmentBefore = receiver?.commitment ?? 0n
	const applySuggestedBound = () => {
		if (snapshot === undefined || source === undefined || duration === undefined) return
		principalInput.value = formatUnits(pledgedBefore + source.rep, 18)
	}
	const displayCollateral = (value: bigint | undefined) => <CurrencyValue value={value} suffix={pool?.collateral.symbol ?? collateralCopy.fallback} units={pool?.collateral.decimals ?? 0} />
	// Both actions often rest disabled for one shared cause, such as a missing position ID; that reason renders once for the pair.
	const sharedReason = actions.busy === undefined && reason !== undefined && reason === cureReason ? reason : undefined
	const reasonId = sharedReason === undefined ? undefined : sharedReasonId
	return (
		<SectionBlock title={copy.title} description={redesigned ? undefined : copy.description}>
			{redesigned && knownPositions.length > 0 && (
				<label className='field'>
					<span>{copy.knownPositions}</span>
					<select
						value={knownPositions.includes(positionInput.value) ? positionInput.value : ''}
						onChange={event => {
							positionInput.value = event.currentTarget.value
						}}
					>
						<option value=''>{copy.chooseKnownPosition}</option>
						{knownPositions.map(known => (
							<option key={known} value={known}>
								{copy.formatPosition(known)}
							</option>
						))}
					</select>
				</label>
			)}
			<SecurityPoolInput
				label={copy.position}
				hint={copy.hint}
				value={positionInput.value}
				onChange={value => {
					positionInput.value = value
				}}
				disabled={actions.busy !== undefined}
			/>
			{redesigned && target.displayedAt !== undefined && <UpdatedAgo updatedAt={target.displayedAt} refreshing={target.loading} />}
			{redesigned && <RetryableNotice message={refreshError} retryLabel={tryAgain} onRetry={target.retry} />}
			{redesigned && distressed && preview !== undefined && (
				<div className='statoblast-liquidation-reward'>
					<strong>{copy.takeoverReward}</strong>
					<progress aria-label={copy.takeoverReward} max={1} value={rewardProgress} />
					<MetricGrid>
						<MetricField label={copy.rewardNow}>
							<CurrencyValue value={displayedSource?.healthy !== true && timeBasedReward !== undefined && timeBasedReward >= 0n ? timeBasedReward : displayedSource?.maximumTakeoverReward} suffix={common.rep} />
						</MetricField>
						<MetricField label={copy.rewardMax}>
							<CurrencyValue value={preview.position.rep} suffix={common.rep} />
						</MetricField>
						<MetricField label={copy.takeoverNow}>{displayCollateral(displayedSource?.maximumTakeoverCommitment)}</MetricField>
						<MetricField label={copy.takeoverLater}>{displayCollateral(laterTakeover?.maximumTakeoverCommitment)}</MetricField>
					</MetricGrid>
				</div>
			)}
			<MetricGrid>
				<MetricField label={copy.targetRep}>
					<CurrencyValue value={preview?.position.rep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.targetCommitment}>
					<CurrencyValue value={preview?.position.commitment} suffix={pool?.collateral.symbol ?? collateralCopy.fallback} units={pool?.collateral.decimals ?? 0} />
				</MetricField>
				<MetricField label={copy.repairLimit}>
					<CurrencyValue value={displayedSource?.maximumTakeoverCommitment} suffix={pool?.collateral.symbol ?? collateralCopy.fallback} units={pool?.collateral.decimals ?? 0} />
				</MetricField>
				<MetricField label={copy.takeoverReward}>
					<CurrencyValue value={displayedSource?.maximumTakeoverReward} suffix={copy.takeoverRewardUnit} />
				</MetricField>
				<MetricField label={copy.started}>
					<TimestampValue timestamp={preview?.started} relative={false} zeroText={copy.notStarted} />
				</MetricField>
			</MetricGrid>
			<div className='form-grid'>
				{[
					{ label: copy.commitment, input: commitmentInput },
					{ label: copy.maximumOwnRep, input: ownInput },
					{ label: copy.maximumPrincipal, input: principalInput },
					{ label: copy.maximumCommitment, input: totalCommitmentInput },
				].map(field => (
					<SecurityPoolInput
						key={field.label}
						label={field.label}
						value={field.input.value}
						onChange={value => {
							field.input.value = value
						}}
						disabled={actions.busy !== undefined}
						numeric
					/>
				))}
			</div>
			{redesigned && distressed && (
				<button type='button' className='secondary' disabled={source === undefined || actions.busy !== undefined} onClick={applySuggestedBound}>
					{copy.suggestLimit}
				</button>
			)}
			{redesigned && fill !== undefined && (
				<MetricGrid>
					<MetricField label={copy.previewPledged}>
						<CurrencyValue value={pledgedBefore} suffix={common.rep} /> → <CurrencyValue value={pledgedBefore + fill.takeoverReward} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.previewCommitment}>
						{displayCollateral(commitmentBefore)} → {displayCollateral(commitmentBefore + fill.commitment)}
					</MetricField>
				</MetricGrid>
			)}
			<div className='actions'>
				<SecurityPoolButton model={actions} action='takeOverSecurityPoolPosition' label={copy.takeOver} pendingLabel={copy.takingOver} reason={reason} sharedReasonId={reasonId} onClick={takeOver} />
				<SecurityPoolButton model={actions} action='cureSecurityPoolPosition' label={copy.cure} pendingLabel={copy.curing} reason={cureReason} sharedReasonId={reasonId} onClick={cure} />
			</div>
			{sharedReason === undefined ? undefined : (
				<div className='tx-action-feedback shared-action-reason'>
					<InlineHint id={sharedReasonId} message={sharedReason} />
				</div>
			)}
		</SectionBlock>
	)
}
