import * as pageCopy from '../../../copy/securityPoolPage.js'
import * as collateralCopy from '../../../copy/collateral.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useState } from 'preact/hooks'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'
import { SecurityPoolRetirementPreview } from './SecurityPoolRetirementPreview.js'
import type { useSecurityPoolAggregate } from '../hooks/useSecurityPoolAggregate.js'
import { capitalPositionPhase, maximumSecurityPoolCommitment, requiredSecurityPoolCollateral } from '../lib/capital.js'
import * as copy from '../../../copy/securityPoolCapital.js'
import * as priceCopy from '../../../copy/securityPoolPrice.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

type Model = ReturnType<typeof useSecurityPoolAggregate>
/** The request form is long, so it stays folded unless the price has expired and a new report can be requested. */
function PriceReportDisclosure({ requestable, children }: { requestable: boolean; children: (unfolded: boolean) => ComponentChildren }) {
	const [open, setOpen] = useState(requestable)
	// Never folds by itself: settling a report must not hide the control that still has focus.
	useEffect(() => {
		if (requestable) setOpen(true)
	}, [requestable])
	// The report stays mounted so folding keeps its drafts; it learns it is folded and reads nothing until unfolded.
	return (
		<details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
			<summary>{priceCopy.scopes.universe.title}</summary>
			{children(open)}
		</details>
	)
}

/** `priceReport` renders inside Shared backing, next to the price status it refreshes, and is told whether its disclosure is unfolded. */
export function SecurityPoolAggregatePanel({
	model,
	actions,
	priceReport,
	priceDeadlineChecking = false,
	redesigned = false,
}: {
	redesigned?: boolean
	priceDeadlineChecking?: boolean
	model: Model
	actions: Pick<SecurityPoolActions, 'scope' | 'busy'>
	priceReport?: ((unfolded: boolean) => ComponentChildren) | undefined
}) {
	const snapshot = model.snapshot
	const fieldsLoading = model.loading && snapshot === undefined
	const capitalId = useId()
	const currentPosition = snapshot?.positions[0]
	const collateral = (value: bigint | undefined) => <CurrencyValue value={value} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
	const rep = (value: bigint | undefined) => <CurrencyValue value={value} suffix={common.rep} />
	const backing = snapshot === undefined ? 0n : requiredSecurityPoolCollateral({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, targetHealthFactorBps: 10_000n } }, snapshot.ownerCommitmentAttoEth)
	const health = priceDeadlineChecking || currentPosition === undefined || backing === 0n || snapshot?.priceValid !== true ? undefined : Number((currentPosition.rep * 10_000n) / backing) / 100
	const target = Number(snapshot?.ownerAccount.targetHealthFactorBps || 10_000n) / 100
	const gaugeMax = Math.max(200, target)
	const liquidation = snapshot === undefined || snapshot.conservativePrice === 0n ? undefined : Number((snapshot.liquidationPrice * 10_000n) / snapshot.conservativePrice) / 100
	const priceCurrent = snapshot?.priceValid === true && !priceDeadlineChecking
	const disabled = priceDeadlineChecking || actions.busy !== undefined || model.loading || model.showingPreviousSnapshot
	const disabledReason = actions.busy !== undefined ? copy.actionPending : copy.readUnavailable
	let targetCapacityReason: string | undefined
	if (disabled) targetCapacityReason = disabledReason
	else if (model.targetCapacity === undefined) targetCapacityReason = copy.targetUnavailable
	// A forked or importing universe cannot accept a new report, so only an expired price in an active universe asks for one.
	const priceRequestable = snapshot !== undefined && !snapshot.priceValid && snapshot.forkTime === 0n && !snapshot.importing
	let status = priceCurrent ? copy.priceValid : copy.priceStale
	if (priceDeadlineChecking) status = pageCopy.priceWindowEndedChecking
	if (snapshot?.importing) status = copy.importing
	if (snapshot !== undefined && snapshot.forkTime > 0n) status = copy.forked
	const sections = [
		{ id: 'deposit', label: copy.deposit, value: rep(snapshot?.ownerPrincipalAttoRep) },
		{ id: 'commitment', label: pageCopy.commitmentSection, value: collateral(snapshot?.ownerCommitmentAttoEth) },
		{ id: 'reduce', label: pageCopy.reduceCommitment, value: currentPosition?.batch ? collateral(currentPosition.remainingCommitment) : undefined },
		{ id: 'withdraw', label: copy.withdraw, value: rep(snapshot?.withdrawableAttoRep) },
		{ id: 'earnings', label: copy.earnings, value: collateral(snapshot?.claimableEarnings?.attoEth ?? snapshot?.accruedFeesAttoEth) },
	]
	const previewCommitment = model.commitmentAttoEth ?? snapshot?.ownerCommitmentAttoEth
	const previewTarget = model.healthBps
	const previewPrincipal = (snapshot?.ownerPrincipalAttoRep ?? 0n) + (model.healthDepositAttoRep ?? 0n)
	const previewReady = priceCurrent && snapshot !== undefined && previewCommitment !== undefined && previewTarget !== undefined && previewTarget >= 10_000n && previewTarget < 1n << 256n
	const previewRep = previewReady ? requiredSecurityPoolCollateral(snapshot, previewCommitment, model.proofPrice, previewTarget) : undefined
	let estimatedWithdrawal: bigint | undefined
	if (previewRep !== undefined) estimatedWithdrawal = previewPrincipal > previewRep ? previewPrincipal - previewRep : 0n
	const currentRep = priceCurrent && snapshot !== undefined ? requiredSecurityPoolCollateral(snapshot, snapshot.ownerCommitmentAttoEth) : undefined
	const currentMaximum = priceCurrent && snapshot !== undefined ? maximumSecurityPoolCommitment(snapshot, snapshot.ownerAccount.targetHealthFactorBps || 10_000n) : undefined
	const previewMaximum = previewReady ? maximumSecurityPoolCommitment({ ...snapshot, ownerPrincipalAttoRep: previewPrincipal }, previewTarget, model.proofPrice) : undefined
	const previewRows = [
		{ label: copy.savedHealth, before: `${target}%`, after: previewTarget === undefined ? undefined : `${formatUnits(previewTarget, 2)}%` },
		{ label: copy.commitment, before: collateral(snapshot?.ownerCommitmentAttoEth), after: collateral(previewCommitment) },
		{ label: copy.requiredCollateral, before: rep(currentRep), after: rep(previewRep) },
		{ label: copy.estimatedWithdrawal, before: rep(snapshot?.withdrawableAttoRep), after: rep(estimatedWithdrawal) },
		{ label: copy.targetCapacity, before: collateral(currentMaximum), after: collateral(previewMaximum) },
	]
	return (
		<div className={redesigned ? 'statoblast-capital-layout' : 'route-view-flow'}>
			{redesigned && (
				<nav className='statoblast-capital-nav' aria-label={pageCopy.capitalSections}>
					{sections.map(section => (
						<button
							key={section.id}
							type='button'
							className='secondary'
							onClick={() => {
								const heading = document.getElementById(`${capitalId}-${section.id}`)
								heading?.scrollIntoView({ block: 'start' })
								heading?.focus({ preventScroll: true })
							}}
						>
							{section.label}
							{snapshot !== undefined && section.value !== undefined && <small>{section.value}</small>}
						</button>
					))}
				</nav>
			)}
			{!redesigned && (
				<SectionBlock className='statoblast-capital-facts' title={copy.poolTitle} description={copy.poolDescription}>
					{model.showingPreviousSnapshot ? <UserMessage detail={copy.lastConfirmed} /> : undefined}
					{snapshot === undefined ? undefined : (
						<Badge className='badge-wrap' tone={priceCurrent ? 'ok' : 'warning'}>
							{status}
						</Badge>
					)}
					<MetricGrid>
						<MetricField label={copy.totalPledged} loading={fieldsLoading}>
							<CurrencyValue value={snapshot?.totalPledgedAttoRep} suffix={common.rep} />
						</MetricField>
						<MetricField label={copy.healthyCommitment} loading={fieldsLoading}>
							<CurrencyValue value={snapshot?.healthyCommitmentAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.demand} loading={fieldsLoading}>
							<CurrencyValue value={snapshot?.demandAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.availableCapacity} loading={fieldsLoading}>
							<CurrencyValue value={snapshot?.availableMintCapacityAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
						</MetricField>
						<MetricField label={copy.priceExpiry} loading={fieldsLoading}>
							<TimestampValue timestamp={snapshot?.priceValidUntil} relative={false} zeroText={copy.noPrice} />
						</MetricField>
						<MetricField label={copy.snapshotTime} loading={fieldsLoading}>
							<TimestampValue timestamp={snapshot?.timestamp} relative={false} />
						</MetricField>
					</MetricGrid>
					{priceReport === undefined ? undefined : <PriceReportDisclosure requestable={priceRequestable}>{priceReport}</PriceReportDisclosure>}
				</SectionBlock>
			)}
			<SectionBlock className='statoblast-capital-position' title={redesigned ? pageCopy.yourPosition : copy.title} description={redesigned ? undefined : copy.description}>
				{snapshot?.auctionVault === undefined ? undefined : <UserMessage detail={copy.auctionVaultOwnership} />}
				{redesigned && (
					<div className='statoblast-health-gauge'>
						<strong>{health === undefined ? pageCopy.healthUnavailable : pageCopy.formatHealth(health.toLocaleString('en-US', { maximumFractionDigits: 1 }))}</strong>
						{health !== undefined && (
							<div className='statoblast-marked-meter'>
								<meter min={0} max={gaugeMax} low={liquidation} high={100} optimum={target} value={Math.min(health, gaugeMax)} aria-label={pageCopy.positionHealth} />
								{[liquidation, 100, target].map((point, index) => (point === undefined ? undefined : <span key={index} aria-hidden='true' style={{ insetInlineStart: `${Math.min(99, (point * 100) / gaugeMax)}%` }} />))}
							</div>
						)}
						<p>
							{liquidation === undefined ? pageCopy.liquidationThresholdUnavailable : pageCopy.formatLiquidation(liquidation)}
							{pageCopy.backingAndTargetTail}
							{target}%
						</p>
					</div>
				)}

				<MetricGrid>
					<MetricField label={copy.withdrawableRep} loading={fieldsLoading}>
						<CurrencyValue value={snapshot?.withdrawableAttoRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.principalRep} loading={fieldsLoading}>
						<CurrencyValue value={snapshot?.ownerPrincipalAttoRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.commitment} loading={fieldsLoading}>
						<CurrencyValue value={snapshot?.ownerCommitmentAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.savedHealth} loading={fieldsLoading}>
						{snapshot === undefined ? undefined : `${formatUnits(snapshot.ownerAccount.targetHealthFactorBps || 10_000n, 2)}%`}
					</MetricField>
				</MetricGrid>
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-deposit`} title={copy.deposit} description={redesigned ? copy.idleDepositHint : copy.depositHint}>
				<SecurityPoolInput label={copy.repAmount} value={model.depositAmount} onChange={model.setDepositAmount} disabled={disabled} numeric />
				<TokenApprovalControl
					actionLabel={copy.deposit}
					allowanceError={model.readError}
					allowanceLoading={model.loading}
					approvedAmount={snapshot?.allowanceAttoRep}
					disabled={disabled}
					guardMessage={model.fundingReason}
					onApprove={value => {
						if (value !== undefined) void model.approve(value)
					}}
					pending={actions.busy === 'approveSecurityPoolRep'}
					pendingLabel={copy.approving}
					requiredAmount={model.depositAttoRep}
					resetKey={`${snapshot?.capitalLedger}:${snapshot?.owner}:${model.depositAmount}`}
					tokenSymbol={common.rep}
					tokenUnits={18}
				/>
				<SecurityPoolButton model={actions} action='depositSecurityPoolRep' label={copy.deposit} pendingLabel={copy.depositing} reason={model.depositReason} onClick={model.deposit} />
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-commitment`} title={redesigned ? pageCopy.commitmentSection : copy.authorize} description={copy.authorizationHint}>
				{redesigned && <UserMessage tone='warning' detail={copy.liquidationHint(snapshot?.liquidationDuration === undefined ? undefined : formatDuration(snapshot.liquidationDuration))} />}
				<SecurityPoolInput label={copy.health} hint={copy.healthHint} value={model.healthPercent} onChange={model.setHealthPercent} disabled={disabled} numeric />
				<MetricGrid>
					<MetricField label={copy.targetCapacity}>
						<CurrencyValue value={model.targetCapacity} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.targetShortfall}>
						<CurrencyValue value={model.targetShortfall} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
				<SecurityPoolButton model={actions} action='setSecurityPoolHealth' label={copy.saveHealth} pendingLabel={copy.savingHealth} reason={model.healthReason} onClick={model.setHealth} />
				<details>
					<summary>{copy.healthDepositDetails}</summary>
					<SecurityPoolInput label={copy.healthDepositAmount} hint={copy.healthDepositHint} value={model.healthDepositAmount} onChange={model.setHealthDepositAmount} disabled={disabled} numeric />
					<TokenApprovalControl
						actionLabel={copy.depositHealth}
						allowanceError={model.readError}
						allowanceLoading={model.loading}
						approvedAmount={snapshot?.allowanceAttoRep}
						disabled={disabled}
						guardMessage={model.healthFundingReason}
						onApprove={value => {
							if (value !== undefined) void model.approveHealthDeposit(value)
						}}
						pending={actions.busy === 'approveSecurityPoolHealthRep'}
						pendingLabel={copy.approving}
						requiredAmount={model.healthDepositAttoRep}
						resetKey={`${snapshot?.capitalLedger}:${snapshot?.owner}:${model.healthDepositAmount}`}
						tokenSymbol={common.rep}
						tokenUnits={18}
					/>
					<SecurityPoolButton model={actions} action='depositSecurityPoolHealthRep' label={copy.depositHealth} pendingLabel={copy.depositingHealth} reason={model.healthDepositReason} onClick={model.depositAndSetHealth} />
				</details>
				<MetricGrid>
					<SecurityPoolInput label={copy.activeCommitment} value={model.commitmentAmount} onChange={model.setCommitmentAmount} disabled={disabled} numeric />
				</MetricGrid>
				<ActionLauncherButton tone='secondary' idleLabel={copy.useTargetCapacity} pendingLabel={copy.useTargetCapacity} availability={{ disabled: targetCapacityReason !== undefined, reason: targetCapacityReason }} onClick={model.useTargetCapacity} />
				{redesigned && snapshot !== undefined && (
					<button type='button' className='secondary' disabled={disabled} onClick={() => model.setCommitmentAmount(formatUnits(snapshot.ownerCommitmentAttoEth, snapshot.collateral.decimals))}>
						{copy.currentCommitment}
					</button>
				)}
				{redesigned && snapshot !== undefined && (
					<table className='statoblast-capital-preview'>
						<caption>{copy.preview}</caption>
						<thead>
							<tr>
								<td />
								<th scope='col'>{copy.previewBefore}</th>
								<th scope='col'>{copy.previewAfter}</th>
							</tr>
						</thead>
						<tbody>
							{previewRows.map(row => (
								<tr key={row.label}>
									<th scope='row'>{row.label}</th>
									<td>{row.before}</td>
									<td>{row.after ?? '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
				<MetricGrid>
					{!redesigned && (
						<MetricField label={copy.requiredCollateral}>
							<CurrencyValue value={model.requiredCollateral} suffix={common.rep} />
						</MetricField>
					)}
					<MetricField label={copy.minimumCommitment}>
						<CurrencyValue value={snapshot?.economics.minimumCommitmentAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
					</MetricField>
				</MetricGrid>
				<SecurityPoolInput label={copy.reportId} hint={copy.reportHint} value={model.reportInput} onChange={model.setReportInput} disabled={disabled} />
				<SecurityPoolButton model={actions} action='authorizeSecurityPoolCommitment' label={copy.authorize} pendingLabel={copy.authorizing} reason={model.authorizeReason} onClick={model.authorize} />
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-reduce`} title={redesigned ? pageCopy.reduceCommitment : copy.positions} description={copy.positionsHint}>
				{snapshot !== undefined && model.livePositions.length === 0 ? <EmptyState title={copy.noPositions} detail={copy.noPositionsHint} /> : undefined}
				{model.livePositions.map(position => {
					const reasons = model.positionReasons(position.id, position.batch === 0n ? undefined : position.remainingCommitment)
					const required = snapshot === undefined ? 0n : requiredSecurityPoolCollateral({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, targetHealthFactorBps: 10_000n } }, snapshot.ownerCommitmentAttoEth)
					const healthy = snapshot !== undefined && position.rep >= required
					const targetMet = snapshot !== undefined && position.rep >= requiredSecurityPoolCollateral(snapshot, position.commitment)
					const health = snapshot !== undefined && priceCurrent && required > 0n ? `${formatUnits((position.rep * 10_000n) / required, 2)}%` : copy.healthUnknown
					let liquidationStatus: string = copy.healthUnknown
					if (snapshot !== undefined && priceCurrent) liquidationStatus = position.maxHealthyPrice >= snapshot.liquidationPrice ? copy.liquidationHealthy : copy.liquidationUnhealthy
					let retirementSizingReason: string | undefined
					if (disabled) retirementSizingReason = disabledReason
					else if (position.batch !== 0n) retirementSizingReason = copy.retirementRequested
					else if (model.retirementTargetCapacity === undefined) retirementSizingReason = copy.targetUnavailable
					else if (model.retirementTargetCapacity >= position.commitment) retirementSizingReason = copy.currentTargetSatisfied
					return (
						<WorkflowSubsection key={String(position.id)} title={copy.position(position.id)} badge={<Badge>{copy.phase[capitalPositionPhase(position.batch, snapshot?.currentBatch ?? 0n)]}</Badge>}>
							<MetricGrid>
								<MetricField label={copy.positionPledged}>
									<CurrencyValue value={position.rep} suffix={common.rep} />
								</MetricField>
								<MetricField label={copy.positionCommitment}>
									<CurrencyValue value={position.commitment} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
								</MetricField>
								<MetricField label={copy.currentHealth}>{health}</MetricField>
								<MetricField label={copy.liquidationHealth}>{liquidationStatus}</MetricField>
								<MetricField label={copy.liquidationSince}>
									<TimestampValue timestamp={position.liquidationStarted} relative={false} zeroText={copy.noLiquidationInterval} />
								</MetricField>
								{position.batch === 0n ? undefined : (
									<MetricField label={copy.queuedRemainingCommitment}>
										<CurrencyValue value={position.remainingCommitment} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
									</MetricField>
								)}
							</MetricGrid>
							{priceCurrent && !healthy ? <UserMessage tone='warning' detail={copy.unhealthy} /> : undefined}
							{priceCurrent && healthy && !targetMet ? <UserMessage tone='warning' detail={copy.belowTarget} /> : undefined}
							<UserMessage detail={copy.liquidationHint(snapshot?.liquidationDuration === undefined ? undefined : formatDuration(snapshot.liquidationDuration))} />
							{position.liquidationStarted === 0n ? undefined : <UserMessage detail={copy.liquidationTimingHint} />}
							{snapshot === undefined || position.batch === 0n ? undefined : <SecurityPoolRetirementPreview snapshot={snapshot} position={position} redesigned={redesigned} />}
							{/* A queued target stays fixed; repeating it lets the ledger cure or release capacity. */}
							{position.batch === 0n ? (
								<>
									<SecurityPoolInput label={copy.remainingCommitment} hint={copy.remainingCommitmentHint} value={model.remainingCommitmentAmount} onChange={model.setRemainingCommitmentAmount} disabled={disabled} numeric />
									<ActionLauncherButton tone='secondary' idleLabel={copy.retireToTarget} pendingLabel={copy.retireToTarget} availability={{ disabled: retirementSizingReason !== undefined, reason: retirementSizingReason }} onClick={model.retireToTarget} />
									<UserMessage detail={copy.retirementTargetHint} />
									<div className='actions'>
										<SecurityPoolButton model={actions} action={`retireSecurityPool-${position.id}`} label={copy.retire} pendingLabel={copy.retiring} reason={reasons.retire} onClick={() => model.retire(position.id)} />
									</div>
								</>
							) : (
								<SecurityPoolButton model={actions} action={`retireSecurityPool-${position.id}`} label={copy.resubmitRetirement} pendingLabel={copy.resubmittingRetirement} reason={reasons.retire} onClick={() => model.retire(position.id, position.remainingCommitment)} />
							)}
						</WorkflowSubsection>
					)
				})}
				<SecurityPoolButton model={actions} action='serveSecurityPoolRetirement' label={copy.serve} pendingLabel={copy.serving} reason={model.serveReason} onClick={model.serve} />
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-withdraw`} title={copy.withdraw} description={copy.withdrawHint}>
				<SecurityPoolInput label={copy.repAmount} value={model.withdrawalAmount} onChange={model.setWithdrawalAmount} disabled={disabled} numeric />
				<SecurityPoolButton model={actions} action='withdrawSecurityPoolRep' label={copy.withdraw} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-earnings`} title={copy.earnings} description={redesigned && snapshot !== undefined ? copy.formatRewardVesting(formatDuration(snapshot.economics.rewardVestingSeconds)) : copy.earningsHint}>
				<MetricGrid>
					<MetricField label={copy.ethEarnings} loading={fieldsLoading}>
						<CurrencyValue value={snapshot?.claimableEarnings?.attoEth ?? snapshot?.accruedFeesAttoEth} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.repEarnings} loading={fieldsLoading}>
						<CurrencyValue value={snapshot?.claimableEarnings?.attoRep ?? snapshot?.accruedFeesAttoRep} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
				<SecurityPoolButton model={actions} action='claimSecurityPoolEarnings' label={copy.claim} pendingLabel={copy.claiming} reason={model.claimReason} onClick={model.claim} />
			</SectionBlock>
		</div>
	)
}
