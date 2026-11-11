import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { buildPortfolioCapitalTakeOverWithBoundsRequest, portfolioTakeoverSource } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capital, statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as index } from '../../../contractArtifact.js'
import type { usePortfolio } from '../hooks/usePortfolio.js'
import { portfolioAmountOrUndefined, portfolioUnsignedId } from '../lib/draft.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import * as copy from '../../../copy/portfolioTakeover.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

async function loadTarget(snapshot: NonNullable<ReturnType<typeof usePortfolio>['snapshot']>, id: bigint) {
	const client = createConnectedReadClient()
	const [position, started, epoch] = await Promise.all([
		client.readContract({ address: snapshot.commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'liquidationStarted', args: [id], blockNumber: snapshot.blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch', blockNumber: snapshot.blockNumber }),
	])
	return { position, started, epoch }
}

export function PortfolioTakeover({ model, actions }: { model: Pick<ReturnType<typeof usePortfolio>, 'snapshot'>; actions: Pick<PortfolioActions, 'ownerReason' | 'scope' | 'busy' | 'runPortfolioAction'> }) {
	const positionInput = useSignal('')
	const commitmentInput = useSignal('')
	const awardInput = useSignal('')
	const ownInput = useSignal('')
	const principalInput = useSignal('')
	const totalCommitmentInput = useSignal('')
	const snapshot = model.snapshot
	const id = portfolioUnsignedId(positionInput.value, 96)
	const key = `${snapshot?.chainId}:${snapshot?.capitalLedger}:${snapshot?.owner}:${snapshot?.blockHash}:${id}`
	const target = useSignal<{ key: string; value?: Awaited<ReturnType<typeof loadTarget>>; error?: string }>()
	// Bounds are consent for one position of one owner, so another target starts with none. A snapshot refresh or a half-typed ID is not a new target.
	const boundsTarget = snapshot === undefined || id === undefined ? undefined : `${snapshot.chainId}:${snapshot.capitalLedger}:${snapshot.owner}:${id}`
	const lastBoundsTarget = useRef(boundsTarget)
	useEffect(() => {
		if (boundsTarget === undefined || boundsTarget === lastBoundsTarget.current) return
		const replacedTarget = lastBoundsTarget.current !== undefined
		lastBoundsTarget.current = boundsTarget
		if (replacedTarget) for (const bound of [commitmentInput, awardInput, ownInput, principalInput, totalCommitmentInput]) bound.value = ''
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
	const source = snapshot !== undefined && preview !== undefined && snapshot.liquidationPrice > 0n ? portfolioTakeoverSource(snapshot, preview.position) : undefined
	const commitment = portfolioAmountOrUndefined(commitmentInput.value)
	const minimumAward = portfolioAmountOrUndefined(awardInput.value)
	const maximumOwnRep = portfolioAmountOrUndefined(ownInput.value)
	const maximumOwnerPrincipal = portfolioAmountOrUndefined(principalInput.value)
	const maximumOwnerCommitment = portfolioAmountOrUndefined(totalCommitmentInput.value)
	let reason = actions.ownerReason
	if (reason === undefined && (id === undefined || id === 0n)) reason = copy.enterTarget
	if (reason === undefined && preview === undefined) reason = loaded?.error ?? copy.loading
	if (reason === undefined && snapshot !== undefined && (snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing)) reason = copy.inactive
	if (reason === undefined && snapshot !== undefined && !snapshot.priceValid) reason = copy.priceRequired
	if (reason === undefined && preview !== undefined && snapshot !== undefined && (preview.position.owner === snapshot.owner || preview.position.commitment === 0n || preview.position.maxHealthyPrice >= snapshot.liquidationPrice || preview.started === 0n || source?.healthy === true)) reason = copy.notEligible
	if (reason === undefined && (commitment === undefined || commitment === 0n || minimumAward === undefined || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined)) reason = copy.enterBounds
	const takeOver = async () => {
		if (reason !== undefined || snapshot === undefined || preview === undefined || source === undefined || id === undefined || commitment === undefined || minimumAward === undefined || maximumOwnRep === undefined || maximumOwnerPrincipal === undefined || maximumOwnerCommitment === undefined)
			throw new Error(reason ?? copy.enterBounds)
		await actions.runPortfolioAction('takeOverPortfolioPosition', copy.takeOver, () => ({
			...buildPortfolioCapitalTakeOverWithBoundsRequest({
				owner: snapshot.owner,
				capitalLedger: snapshot.capitalLedger,
				positionId: id,
				commitment,
				minimumAward,
				maximumOwnRep,
				bounds: { maximumOwnerPrincipal, maximumOwnerCommitment, expectedTargetHealthFactorBps: snapshot.ownerAccount.targetHealthFactorBps || 10_000n, expectedAcceptedPriceEpoch: preview.epoch, expectedSourceBatch: source.batch },
			}),
			reviewDescription: copy.review,
			validateBeforeSubmit: async () => {
				const client = createConnectedReadClient()
				const epoch = await client.readContract({ address: snapshot.capitalLedger, abi: capital.abi, functionName: 'acceptedPriceEpoch' })
				const position = await client.readContract({ address: snapshot.commitmentIndex, abi: index.abi, functionName: 'accountOf', args: [id] })
				if (epoch !== preview.epoch || position.rep !== preview.position.rep || position.commitment !== preview.position.commitment || position.owner !== preview.position.owner || position.batch !== preview.position.batch) throw new Error(copy.changed)
			},
		}))
	}
	return (
		<SectionBlock title={copy.title} description={copy.description}>
			<PortfolioInput
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
					<CurrencyValue value={preview?.position.commitment} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.afterCure}>
					<CurrencyValue value={source?.commitment} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.started}>
					<TimestampValue timestamp={preview?.started} relative={false} zeroText={copy.notStarted} />
				</MetricField>
			</MetricGrid>
			<div className='form-grid'>
				{[
					{ label: copy.commitment, input: commitmentInput },
					{ label: copy.minimumAward, input: awardInput },
					{ label: copy.maximumOwnRep, input: ownInput },
					{ label: copy.maximumPrincipal, input: principalInput },
					{ label: copy.maximumCommitment, input: totalCommitmentInput },
				].map(field => (
					<PortfolioInput
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
			<PortfolioButton model={actions} action='takeOverPortfolioPosition' label={copy.takeOver} pendingLabel={copy.takingOver} reason={reason} onClick={takeOver} />
		</SectionBlock>
	)
}
