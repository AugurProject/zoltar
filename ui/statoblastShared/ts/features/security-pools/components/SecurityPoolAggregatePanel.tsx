import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import * as pageCopy from '../../../copy/securityPoolPage.js'
import * as collateralCopy from '../../../copy/collateral.js'
import { useId } from 'preact/hooks'
import { formatCurrencyBalanceWithUnit, formatDuration, formatRoundedCurrencyBalance, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { SecurityPoolButton, SecurityPoolInput, type SecurityPoolActions } from './SecurityPoolControls.js'
import { SecurityPoolRetirementPreview } from './SecurityPoolRetirementPreview.js'
import type { useSecurityPoolAggregate } from '../hooks/useSecurityPoolAggregate.js'
import { maximumSecurityPoolCommitment, requiredSecurityPoolCollateral } from '../lib/capital.js'
import * as copy from '../../../copy/securityPoolCapital.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

type Model = ReturnType<typeof useSecurityPoolAggregate>
export function SecurityPoolAggregatePanel({ model, actions, priceDeadlineChecking = false, positionMode = 'own' }: { positionMode?: 'own' | 'other' | 'none'; priceDeadlineChecking?: boolean; model: Model; actions: Pick<SecurityPoolActions, 'scope' | 'busy'> & Partial<Pick<SecurityPoolActions, 'lastFailedAction'>> }) {
	const snapshot = model.snapshot
	const oldActionData = useOldActionDataNotice(positionMode === 'own' ? model.displayedAt : undefined)
	const actionDescription = (hint: string) =>
		oldActionData === undefined ? (
			hint
		) : (
			<>
				{oldActionData}
				<br />
				{hint}
			</>
		)
	const fieldsLoading = model.loading && snapshot === undefined
	const capitalId = useId()
	if (positionMode === 'none') {
		return (
			<SectionBlock title={pageCopy.poolTabLabels.capital}>
				<UserMessage detail={pageCopy.connectToSeePosition} />
			</SectionBlock>
		)
	}
	const positionTitle = positionMode === 'other' ? pageCopy.position : pageCopy.yourPosition
	const currentPosition = snapshot?.positions[0]
	const queued = currentPosition !== undefined && currentPosition.batch !== 0n
	const collateral = (value: bigint | undefined) => <CurrencyValue value={value} suffix={snapshot?.collateral.symbol ?? collateralCopy.fallback} units={snapshot?.collateral.decimals ?? 0} />
	const rep = (value: bigint | undefined) => <CurrencyValue value={value} suffix={common.rep} />
	const backing = snapshot === undefined ? 0n : requiredSecurityPoolCollateral({ ...snapshot, ownerAccount: { ...snapshot.ownerAccount, targetHealthFactorBps: 10_000n } }, snapshot.ownerCommitmentAttoEth)
	const health = priceDeadlineChecking || currentPosition === undefined || backing === 0n || snapshot?.priceValid !== true ? undefined : Number((currentPosition.rep * 10_000n) / backing) / 100
	const target = Number(snapshot?.ownerAccount.targetHealthFactorBps || 10_000n) / 100
	const gaugeMax = Math.max(200, target)
	const liquidation = snapshot === undefined || snapshot.conservativePrice === 0n ? undefined : Number((snapshot.liquidationPrice * 10_000n) / snapshot.conservativePrice) / 100
	const liquidationDuration = snapshot?.liquidationDuration === undefined ? undefined : formatDuration(snapshot.liquidationDuration)
	const liquidationNotice = liquidation === undefined || liquidationDuration === undefined ? copy.liquidationHint(liquidationDuration) : copy.takeoverThresholdNotice(liquidation.toLocaleString('en-US', { maximumFractionDigits: 2 }), liquidationDuration)
	const priceCurrent = snapshot?.priceValid === true && !priceDeadlineChecking
	const disabled = priceDeadlineChecking || actions.busy !== undefined || fieldsLoading || model.showingPreviousSnapshot
	const disabledReason = actions.busy !== undefined ? copy.actionPending : copy.readUnavailable
	let targetCapacityReason: string | undefined
	if (disabled) targetCapacityReason = disabledReason
	else if (model.targetCapacity === undefined) targetCapacityReason = copy.targetUnavailable
	const sections = [
		{ id: 'deposit', label: copy.deposit, value: rep(snapshot?.ownerPrincipalAttoRep) },
		{ id: 'commitment', label: pageCopy.commitmentSection, value: `${target}%` },
		{ id: 'reduce', label: pageCopy.reduceCommitment, value: queued ? collateral(currentPosition.remainingCommitment) : undefined },
		{ id: 'withdraw', label: copy.withdraw, value: rep(snapshot?.withdrawableAttoRep) },
		{ id: 'earnings', label: copy.earnings, value: collateral(snapshot?.claimableEarnings?.attoEth ?? snapshot?.accruedFeesAttoEth) },
	]
	const previewCommitment = model.commitmentAttoEth ?? snapshot?.ownerCommitmentAttoEth
	const previewTarget = model.healthBps
	const addRep = model.healthDepositAmount.trim() !== '' && model.healthDepositAttoRep !== 0n
	const targetChanged = model.healthBps !== (snapshot?.ownerAccount.targetHealthFactorBps || 10_000n)
	const commitmentChanged = model.commitmentAttoEth !== snapshot?.ownerCommitmentAttoEth
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
		{ label: copy.previewBacking, before: rep(currentRep), after: rep(previewRep) },
		{ label: copy.withdrawableRep, before: rep(snapshot?.withdrawableAttoRep), after: rep(estimatedWithdrawal) },
		{ label: copy.previewMaximum, before: collateral(currentMaximum), after: collateral(previewMaximum) },
	]
	const depositApproval = (
		<TokenApprovalControl
			actionLabel={copy.deposit}
			compact
			customAmountDisclosureLabel={copy.adjustApproval}
			allowanceError={snapshot !== undefined ? undefined : model.readError}
			allowanceLoading={fieldsLoading}
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
	)

	const depositAction = <SecurityPoolButton model={actions} action='depositSecurityPoolRep' label={copy.deposit} pendingLabel={copy.depositing} reason={model.depositReason} onClick={model.deposit} />

	const healthApproval = (
		<TokenApprovalControl
			actionLabel={copy.depositHealth}
			compact
			customAmountDisclosureLabel={copy.adjustApproval}
			allowanceError={snapshot !== undefined ? undefined : model.readError}
			allowanceLoading={fieldsLoading}
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
	)

	const healthDeposit = <SecurityPoolButton model={actions} action='depositSecurityPoolHealthRep' label={copy.depositHealth} pendingLabel={copy.depositingHealth} reason={model.healthDepositReason} onClick={model.depositAndSetHealth} />
	return (
		<div className='statoblast-capital-layout'>
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
			<SectionBlock className='statoblast-capital-position' title={positionTitle}>
				{snapshot?.auctionVault === undefined ? undefined : <UserMessage detail={copy.auctionVaultOwnership} />}
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
			<SectionBlock headingId={`${capitalId}-deposit`} title={copy.deposit} description={actionDescription(copy.idleDepositHint)}>
				<SecurityPoolInput label={copy.repAmount} value={model.depositAmount} onChange={model.setDepositAmount} disabled={disabled} hint={snapshot !== undefined ? copy.walletBalanceHint(formatCurrencyBalanceWithUnit(snapshot.walletAttoRep, common.rep)) : undefined} numeric />
				<ol className='statoblast-capital-actions'>
					<li>{depositApproval}</li>
					<li>{depositAction}</li>
				</ol>
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-commitment`} title={pageCopy.commitmentSection} description={oldActionData}>
				<UserMessage tone='warning' detail={liquidationNotice} />
				<details>
					<summary>{copy.howTargetWorks}</summary>
					<UserMessage detail={copy.healthHint} />
				</details>
				<div className='statoblast-capital-plan'>
					<div>
						<SecurityPoolInput label={copy.health} value={model.healthPercent} onChange={model.setHealthPercent} disabled={disabled} numeric />
						<SecurityPoolInput label={copy.commitment} hint={queued ? copy.queuedCommitmentLock : undefined} value={model.commitmentAmount} onChange={model.setCommitmentAmount} disabled={disabled || queued} numeric />
						{snapshot !== undefined && (
							<div className='statoblast-capital-presets'>
								<button type='button' className='secondary' disabled={disabled || queued} onClick={() => model.setCommitmentAmount(formatUnits(snapshot.ownerCommitmentAttoEth, snapshot.collateral.decimals))}>
									{copy.currentCommitmentPreset}
								</button>
								<ActionLauncherButton tone='secondary' idleLabel={common.max} pendingLabel={common.max} availability={{ disabled: queued || targetCapacityReason !== undefined, reason: queued ? copy.queuedCommitmentLock : targetCapacityReason }} onClick={model.useTargetCapacity} />
							</div>
						)}
						<SecurityPoolInput
							label={copy.optionalHealthDeposit}
							hint={model.targetShortfall === undefined || model.targetShortfall === 0n ? undefined : copy.repToReachTarget(formatCurrencyBalanceWithUnit(model.targetShortfall, common.rep))}
							value={model.healthDepositAmount}
							onChange={model.setHealthDepositAmount}
							disabled={disabled}
							numeric
						/>
						<details>
							<summary>{copy.olderPriceReport}</summary>
							<SecurityPoolInput label={copy.reportId} hint={copy.reportHint} value={model.reportInput} onChange={model.setReportInput} disabled={disabled || queued} />
						</details>
					</div>
					{snapshot !== undefined && (
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
				</div>
				{(addRep || targetChanged || commitmentChanged) && (
					<ol className='statoblast-capital-actions'>
						{addRep && (model.healthDepositAttoRep === undefined || snapshot === undefined || snapshot.allowanceAttoRep < model.healthDepositAttoRep) && <li>{healthApproval}</li>}
						{addRep ? (
							<li>{healthDeposit}</li>
						) : (
							targetChanged && (
								<li>
									<SecurityPoolButton model={actions} action='setSecurityPoolHealth' label={copy.saveHealth} pendingLabel={copy.savingHealth} reason={model.healthReason} onClick={model.setHealth} />
								</li>
							)
						)}
						{commitmentChanged && (
							<li>
								<SecurityPoolButton model={actions} action='authorizeSecurityPoolCommitment' label={copy.setCommitment} pendingLabel={copy.authorizing} reason={addRep ? copy.depositBeforeCommitment : model.authorizeReason} onClick={model.authorize} />
							</li>
						)}
					</ol>
				)}
			</SectionBlock>

			<SectionBlock headingId={`${capitalId}-reduce`} title={pageCopy.reduceCommitment} description={actionDescription(copy.queueHint)}>
				{snapshot !== undefined && model.livePositions.length === 0 ? <EmptyState title={copy.noPositions} detail={copy.noPositionsHint} /> : undefined}
				{model.livePositions.map(position => {
					const reasons = model.positionReasons(position.id, position.batch === 0n ? undefined : position.remainingCommitment)
					if (snapshot === undefined) return undefined
					const key = String(position.id)
					if (position.batch === 0n) {
						return (
							<div key={key}>
								<SecurityPoolInput label={copy.remainingCommitment} value={model.remainingCommitmentAmount} onChange={model.setRemainingCommitmentAmount} disabled={disabled} numeric />
								<SecurityPoolButton model={actions} action={`retireSecurityPool-${position.id}`} label={copy.requestReduction} pendingLabel={copy.retiring} reason={reasons.retire} onClick={() => model.retire(position.id)} />
							</div>
						)
					}
					const keep = formatCurrencyBalanceWithUnit(position.remainingCommitment, snapshot.collateral.symbol, snapshot.collateral.decimals)
					const waitingReasonId = model.serveReason === copy.waitingForFreeCapacity ? `${capitalId}-${key}-waiting` : undefined
					let releaseLabel = copy.releaseKeeping(keep)
					if (model.serveReason === copy.waitingForFreeCapacity) releaseLabel = copy.waitingForFreeCapacity
					else if (actions.lastFailedAction === 'serveSecurityPoolRetirement') releaseLabel = copy.retryRelease
					return (
						<div key={key}>
							<SecurityPoolRetirementPreview snapshot={snapshot} position={position} redesigned />
							{waitingReasonId !== undefined && (
								<span className='visually-hidden' id={waitingReasonId}>
									{copy.waitingForFreeCapacity}
								</span>
							)}
							<SecurityPoolButton model={actions} action='serveSecurityPoolRetirement' label={releaseLabel} pendingLabel={copy.serving} reason={model.serveReason} sharedReasonId={actions.busy === undefined ? waitingReasonId : undefined} onClick={model.serve} />
						</div>
					)
				})}
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-withdraw`} title={copy.withdraw} description={actionDescription(copy.withdrawHint)}>
				<SecurityPoolInput
					label={copy.repAmount}
					value={model.withdrawalAmount}
					onChange={model.setWithdrawalAmount}
					disabled={disabled}
					hint={snapshot !== undefined ? copy.maximumWithdrawalHint(formatValueWithUnit(formatRoundedCurrencyBalance(snapshot.withdrawableAttoRep, 18, 2, 'down'), common.rep)) : undefined}
					action={
						snapshot !== undefined && (
							<button type='button' className='secondary' disabled={disabled || snapshot.withdrawableAttoRep === 0n} onClick={() => model.setWithdrawalAmount(formatUnits(snapshot.withdrawableAttoRep, 18))}>
								{common.max}
							</button>
						)
					}
					numeric
				/>
				<SecurityPoolButton model={actions} action='withdrawSecurityPoolRep' label={copy.withdraw} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
			</SectionBlock>
			<SectionBlock headingId={`${capitalId}-earnings`} title={copy.earnings} description={actionDescription(snapshot !== undefined ? copy.formatRewardVesting(formatDuration(snapshot.economics.rewardVestingSeconds)) : copy.earningsHint)}>
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
