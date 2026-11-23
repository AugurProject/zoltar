import { requiredSecurityPoolCollateral } from '../lib/capital.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { useSignal } from '@preact/signals'
import { useEffect, useId, useRef } from 'preact/hooks'
import { buildSecurityPoolCapitalCureRequest, buildSecurityPoolCapitalTakeOverWithBoundsRequest, securityPoolTakeoverSource, securityPoolTakeoverTransfer } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capital, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as index } from '../../../contractArtifact.js'
import type { useSecurityPool } from '../hooks/useSecurityPool.js'
import { securityPoolAmountOrUndefined, securityPoolUnsignedId } from '../lib/draft.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import * as copy from '../../../copy/securityPoolTakeover.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

type TakeoverSnapshot = Pick<
	NonNullable<ReturnType<typeof useSecurityPool>['snapshot']>,
	| 'chainId'
	| 'blockNumber'
	| 'blockHash'
	| 'capitalLedger'
	| 'commitmentIndex'
	| 'owner'
	| 'economics'
	| 'forkTime'
	| 'frozen'
	| 'importing'
	| 'liquidationPrice'
	| 'conservativePrice'
	| 'ownerConservativePrice'
	| 'securityMultiplierBps'
	| 'totalCommitmentAttoEth'
	| 'demandAttoEth'
	| 'ownerAccount'
	| 'positions'
	| 'priceValid'
> & { collateral: { symbol: string; decimals: number } }

async function loadTarget(snapshot: TakeoverSnapshot, id: bigint) {
	const client = createConnectedReadClient()
	const [position, started, epoch] = await Promise.all([
		client.readContract({ address: snapshot.commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'liquidationStarted', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch', blockNumber: snapshot.blockNumber }),
	])
	return { position, started, epoch }
}

export function SecurityPoolTakeover({ model, actions }: { model: { snapshot: TakeoverSnapshot | undefined }; actions: Pick<SecurityPoolActions, 'ownerReason' | 'scope' | 'busy' | 'runSecurityPoolAction'> }) {
	const positionInput = useSignal('')
	const commitmentInput = useSignal('')
	const ownInput = useSignal('')
	const principalInput = useSignal('')
	const totalCommitmentInput = useSignal('')
	const sharedReasonId = useId()
	const snapshot = model.snapshot
	const id = securityPoolUnsignedId(positionInput.value, 96)
	const key = `${snapshot?.chainId}:${snapshot?.capitalLedger}:${snapshot?.owner}:${snapshot?.blockHash}:${id}`
	const target = useSignal<{ key: string; value?: Awaited<ReturnType<typeof loadTarget>>; error?: string }>()
	// Bounds are consent for one position of one owner, so another target starts with none. A snapshot refresh or a half-typed ID is not a new target.
	const boundsTarget = snapshot === undefined || id === undefined ? undefined : `${snapshot.chainId}:${snapshot.capitalLedger}:${snapshot.owner}:${id}`
	const lastBoundsTarget = useRef(boundsTarget)
	useEffect(() => {
		if (boundsTarget === undefined || boundsTarget === lastBoundsTarget.current) return
		const replacedTarget = lastBoundsTarget.current !== undefined
		lastBoundsTarget.current = boundsTarget
		if (replacedTarget) for (const bound of [commitmentInput, ownInput, principalInput, totalCommitmentInput]) bound.value = ''
	}, [boundsTarget])
	useEffect(() => {
		let current = true
		target.value = undefined
		if (snapshot !== undefined && id !== undefined && id > 0n)
			void loadTarget(snapshot, id)
				.then(value => {
					if (current) target.value = { key, value }
				})
				.catch(error => {
					if (current) target.value = { key, error: getErrorMessage(error, copy.unavailable) }
				})
		return () => {
			current = false
		}
	}, [key])
	const loaded = target.value?.key === key ? target.value : undefined
	const preview = loaded?.value
	const source = snapshot !== undefined && preview !== undefined && snapshot.liquidationPrice > 0n ? securityPoolTakeoverSource(snapshot, preview.position) : undefined
	const commitment = securityPoolAmountOrUndefined(commitmentInput.value, snapshot?.collateral.decimals ?? 18)
	const maximumOwnRep = securityPoolAmountOrUndefined(ownInput.value)
	const maximumOwnerPrincipal = securityPoolAmountOrUndefined(principalInput.value)
	const maximumOwnerCommitment = securityPoolAmountOrUndefined(totalCommitmentInput.value, snapshot?.collateral.decimals ?? 18)
	let reason = actions.ownerReason
	if (reason === undefined && (id === undefined || id === 0n)) reason = copy.enterTarget
	if (reason === undefined && preview === undefined) reason = loaded?.error ?? copy.loading
	if (reason === undefined && snapshot !== undefined && (snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing)) reason = copy.inactive
	if (reason === undefined && snapshot !== undefined && !snapshot.priceValid) reason = copy.priceRequired
	const distressed = preview !== undefined && snapshot !== undefined && preview.position.owner !== snapshot.owner && preview.position.commitment !== 0n && preview.position.maxHealthyPrice < snapshot.liquidationPrice && preview.started !== 0n
	// Repairs retain source principal. A preliminary cure that restores health stands without a transfer.
	const curable = distressed && source?.healthy === true && source.removed !== 0n
	let cureReason = reason
	if (reason === undefined && (!distressed || (source?.healthy === true && !curable))) reason = cureReason = copy.notEligible
	if (reason === undefined && curable) reason = copy.cureInstead
	if (reason === undefined && source?.maximumTakeoverCommitment === 0n) reason = copy.additionalBacking
	if (cureReason === undefined && !curable) cureReason = copy.takeOverInstead
	if (reason === undefined && (commitment === undefined || commitment === 0n || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined)) reason = copy.enterBounds
	if (reason === undefined && snapshot !== undefined && source !== undefined && commitment !== undefined && maximumOwnRep !== undefined && maximumOwnerPrincipal !== undefined && maximumOwnerCommitment !== undefined) {
		const transferred = securityPoolTakeoverTransfer(source, commitment) ?? 0n
		const receiver = snapshot.positions.find(position => position.id === snapshot.ownerAccount.positionId)
		const principal = (receiver?.rep ?? 0n) + snapshot.ownerAccount.freeAttoRep
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

	const validateTarget = (current: NonNullable<typeof preview>, capitalLedger: NonNullable<typeof snapshot>['capitalLedger'], commitmentIndex: NonNullable<typeof snapshot>['commitmentIndex'], positionId: bigint) => async () => {
		const client = createConnectedReadClient()
		const epoch = await client.readContract({ address: capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch' })
		const position = await client.readContract({ address: commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [positionId] })
		if (epoch !== current.epoch || position.rep !== current.position.rep || position.commitment !== current.position.commitment || position.owner !== current.position.owner || position.batch !== current.position.batch) throw new Error(copy.changed)
	}
	const cure = async () => {
		if (cureReason !== undefined || snapshot === undefined || preview === undefined || source === undefined || id === undefined) throw new Error(cureReason ?? copy.notEligible)
		await actions.runSecurityPoolAction('cureSecurityPoolPosition', copy.cure, () => ({
			...buildSecurityPoolCapitalCureRequest({ owner: snapshot.owner, capitalLedger: snapshot.capitalLedger, positionId: id, commitment: preview.position.commitment, expectedAcceptedPriceEpoch: preview.epoch, expectedSourceBatch: source.batch }),
			reviewDescription: copy.cureReview,
			validateBeforeSubmit: validateTarget(preview, snapshot.capitalLedger, snapshot.commitmentIndex, id),
		}))
	}
	const takeOver = async () => {
		if (reason !== undefined || snapshot === undefined || preview === undefined || source === undefined || id === undefined || commitment === undefined || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined) throw new Error(reason ?? copy.enterBounds)
		await actions.runSecurityPoolAction('takeOverSecurityPoolPosition', copy.takeOver, () => ({
			...buildSecurityPoolCapitalTakeOverWithBoundsRequest({
				owner: snapshot.owner,
				capitalLedger: snapshot.capitalLedger,
				positionId: id,
				commitment,
				minimumAward: 0n,
				maximumOwnRep,
				bounds: { maximumOwnerPrincipal, maximumOwnerCommitment, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps || 10_000n, expectedAcceptedPriceEpoch: preview.epoch, expectedSourceBatch: source.batch },
			}),
			reviewDescription: copy.review,
			validateBeforeSubmit: validateTarget(preview, snapshot.capitalLedger, snapshot.commitmentIndex, id),
		}))
	}
	// Both actions often rest disabled for one shared cause, such as a missing position ID; that reason renders once for the pair.
	const sharedReason = actions.busy === undefined && reason !== undefined && reason === cureReason ? reason : undefined
	const reasonId = sharedReason === undefined ? undefined : sharedReasonId
	return (
		<SectionBlock title={copy.title} description={copy.description}>
			<SecurityPoolInput
				label={copy.position}
				hint={copy.hint}
				value={positionInput.value}
				onChange={value => {
					positionInput.value = value
				}}
				disabled={actions.busy !== undefined}
			/>
			<MetricGrid>
				<MetricField label={copy.targetRep}>
					<CurrencyValue value={preview?.position.rep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.targetCommitment}>
					<CurrencyValue value={preview?.position.commitment} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
				</MetricField>
				<MetricField label={copy.repairLimit}>
					<CurrencyValue value={source?.maximumTakeoverCommitment} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
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
