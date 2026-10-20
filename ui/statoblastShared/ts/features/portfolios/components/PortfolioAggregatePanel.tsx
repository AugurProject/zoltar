import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioAggregate } from '../hooks/usePortfolioAggregate.js'
import { capitalPositionPhase } from '../lib/capital.js'
import * as copy from '../../../copy/portfolioCapital.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

type Model = ReturnType<typeof usePortfolioAggregate>
export function PortfolioAggregatePanel({ model, actions }: { model: Model; actions: Pick<PortfolioActions, 'scope' | 'busy'> }) {
	const snapshot = model.snapshot
	const disabled = actions.busy !== undefined
	let available: bigint | undefined
	if (snapshot !== undefined) available = snapshot.healthyCommitmentAttoEth > snapshot.demandAttoEth ? snapshot.healthyCommitmentAttoEth - snapshot.demandAttoEth : 0n
	let status = snapshot?.priceValid ? copy.priceValid : copy.priceStale
	if (snapshot?.importing) status = copy.importing
	if (snapshot !== undefined && snapshot.forkTime > 0n) status = copy.forked
	return (
		<>
			<SectionBlock title={copy.poolTitle} description={copy.poolDescription}>
				{snapshot === undefined ? undefined : <Badge tone={snapshot.priceValid ? 'ok' : 'warning'}>{status}</Badge>}
				<MetricGrid>
					<MetricField label={copy.totalPledged} loading={model.loading}>
						<CurrencyValue value={snapshot?.totalPledgedAttoRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.healthyCommitment} loading={model.loading}>
						<CurrencyValue value={snapshot?.healthyCommitmentAttoEth} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.demand} loading={model.loading}>
						<CurrencyValue value={snapshot?.demandAttoEth} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.availableCapacity} loading={model.loading}>
						<CurrencyValue value={available} suffix={common.eth} />
					</MetricField>
				</MetricGrid>
			</SectionBlock>
			<SectionBlock title={copy.title} description={copy.description}>
				<MetricGrid>
					<MetricField label={copy.freeRep} loading={model.loading}>
						<CurrencyValue value={snapshot?.withdrawableAttoRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.pledgedRep} loading={model.loading}>
						<CurrencyValue value={snapshot === undefined ? undefined : model.pledgedAttoRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.commitment} loading={model.loading}>
						<CurrencyValue value={snapshot === undefined ? undefined : model.ownerCommitmentAttoEth} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.savedHealth} loading={model.loading}>
						{snapshot === undefined ? undefined : `${formatUnits(snapshot.ownerAccount.targetHealthFactorBps || 10_000n, 2)}%`}
					</MetricField>
				</MetricGrid>
			</SectionBlock>
			<SectionBlock title={copy.deposit} description={copy.depositHint}>
				<PortfolioInput label={copy.repAmount} value={model.depositAmount} onChange={model.setDepositAmount} disabled={disabled} numeric />
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
					pending={actions.busy === 'approvePortfolioRep'}
					pendingLabel={copy.approving}
					requiredAmount={model.depositAttoRep}
					resetKey={`${snapshot?.capitalLedger}:${snapshot?.owner}:${model.depositAmount}`}
					tokenSymbol={common.rep}
					tokenUnits={18}
				/>
				<PortfolioButton model={actions} action='depositPortfolioRep' label={copy.deposit} pendingLabel={copy.depositing} reason={model.depositReason} onClick={model.deposit} />
			</SectionBlock>
			<SectionBlock title={copy.execution} description={copy.executionHint}>
				<MetricGrid>
					<MetricField label={copy.unassignedExecution} loading={model.loading}>
						<CurrencyValue value={snapshot?.ownerAccount.executionReserveAttoEth} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.minimumExecution} loading={model.loading}>
						<CurrencyValue value={snapshot?.economics.minimumExecutionReserveAttoEth} suffix={common.eth} />
					</MetricField>
				</MetricGrid>
				<PortfolioInput label={copy.ethAmount} value={model.reserveAmount} onChange={model.setReserveAmount} disabled={disabled} numeric />
				<PortfolioButton model={actions} action='fundPortfolioExecution' label={copy.fundExecution} pendingLabel={copy.fundingExecution} reason={model.fundReserveReason} onClick={model.fundReserve} />
				<details>
					<summary>{copy.withdrawExecution}</summary>
					<PortfolioInput label={copy.ethAmount} value={model.reserveWithdrawal} onChange={model.setReserveWithdrawal} disabled={disabled} numeric />
					<PortfolioButton model={actions} action='withdrawPortfolioExecution' label={copy.withdrawExecution} pendingLabel={copy.withdrawingExecution} reason={model.withdrawReserveReason} onClick={model.withdrawReserve} />
				</details>
			</SectionBlock>
			<SectionBlock title={copy.authorize} description={copy.authorizationHint}>
				<PortfolioInput label={copy.health} hint={copy.healthHint} value={model.healthPercent} onChange={model.setHealthPercent} disabled={disabled} numeric />
				<PortfolioButton model={actions} action='setPortfolioHealth' label={copy.saveHealth} pendingLabel={copy.savingHealth} reason={model.healthReason} onClick={model.setHealth} />
				<MetricGrid>
					<PortfolioInput label={copy.pledge} value={model.pledgeAmount} onChange={model.setPledgeAmount} disabled={disabled} numeric />
					<PortfolioInput label={copy.activeCommitment} value={model.commitmentAmount} onChange={model.setCommitmentAmount} disabled={disabled} numeric />
				</MetricGrid>
				<MetricGrid>
					<MetricField label={copy.requiredCollateral}>
						<CurrencyValue value={model.requiredCollateral} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.requiredExecution}>
						<CurrencyValue value={model.requiredExecutionReserve} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.minimumCommitment}>
						<CurrencyValue value={snapshot?.economics.minimumCommitmentAttoEth} suffix={common.eth} />
					</MetricField>
				</MetricGrid>
				<PortfolioButton model={actions} action='authorizePortfolioCommitment' label={copy.authorize} pendingLabel={copy.authorizing} reason={model.authorizeReason} onClick={model.authorize} />
			</SectionBlock>
			<SectionBlock title={copy.positions} description={copy.positionsHint}>
				<MetricGrid>
					<MetricField label={copy.currentCohort}>{snapshot === undefined ? undefined : String(snapshot.currentBatch)}</MetricField>
					<MetricField label={copy.nextCohort}>{snapshot === undefined ? undefined : String(snapshot.nextBatch)}</MetricField>
				</MetricGrid>
				{snapshot !== undefined && model.livePositions.length === 0 ? <EmptyState title={copy.noPositions} detail={copy.noPositionsHint} /> : undefined}
				{model.livePositions.map(position => {
					const reasons = model.positionReasons(position.id)
					const healthy = snapshot !== undefined && snapshot.priceValid && position.maxHealthyPrice >= snapshot.acceptedPrice
					const health = snapshot !== undefined && snapshot.acceptedPrice > 0n ? `${formatUnits((position.maxHealthyPrice * 10_000n) / snapshot.acceptedPrice, 2)}%` : copy.healthUnknown
					return (
						<WorkflowSubsection key={String(position.id)} title={copy.position(position.id)} badge={<Badge>{copy.phase[capitalPositionPhase(position.batch, snapshot?.currentBatch ?? 0n)]}</Badge>}>
							<MetricGrid>
								<MetricField label={copy.positionPledged}>
									<CurrencyValue value={position.rep} suffix={common.rep} />
								</MetricField>
								<MetricField label={copy.positionCommitment}>
									<CurrencyValue value={position.commitment} suffix={common.eth} />
								</MetricField>
								<MetricField label={copy.currentHealth}>{health}</MetricField>
								<MetricField label={copy.assignedExecution}>
									<CurrencyValue value={position.executionReserveAttoEth} suffix={common.eth} />
								</MetricField>
							</MetricGrid>
							{snapshot?.priceValid && !healthy ? <UserMessage tone='warning' detail={copy.unhealthy} /> : undefined}
							<PortfolioInput label={copy.repAmount} value={model.topUps[String(position.id)] ?? ''} onChange={value => model.setTopUp(position.id, value)} disabled={disabled} numeric />
							<div className='actions'>
								<PortfolioButton model={actions} action={`topUpPortfolio-${position.id}`} label={copy.topUp} pendingLabel={copy.toppingUp} reason={reasons.topUp} onClick={() => model.topUp(position.id)} />
								<PortfolioButton model={actions} action={`retirePortfolio-${position.id}`} label={copy.retire} pendingLabel={copy.retiring} reason={reasons.retire} onClick={() => model.retire(position.id)} />
								<PortfolioButton model={actions} action={`cancelRetirementPortfolio-${position.id}`} label={copy.cancelRetirement} pendingLabel={copy.cancelingRetirement} reason={reasons.cancel} onClick={() => model.cancelRetirement(position.id)} />
							</div>
						</WorkflowSubsection>
					)
				})}
				<PortfolioButton model={actions} action='servePortfolioRetirement' label={copy.serve} pendingLabel={copy.serving} reason={model.serveReason} onClick={model.serve} />
			</SectionBlock>
			<SectionBlock title={copy.withdraw} description={copy.withdrawHint}>
				<PortfolioInput label={copy.repAmount} value={model.withdrawalAmount} onChange={model.setWithdrawalAmount} disabled={disabled} numeric />
				<PortfolioButton model={actions} action='withdrawPortfolioRep' label={copy.withdraw} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
			</SectionBlock>
			<SectionBlock title={copy.earnings} description={copy.earningsHint}>
				<MetricGrid>
					<MetricField label={copy.ethEarnings} loading={model.loading}>
						<CurrencyValue value={snapshot?.accruedFeesAttoEth} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.repEarnings} loading={model.loading}>
						<CurrencyValue value={snapshot?.accruedFeesAttoRep} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
				<PortfolioButton model={actions} action='claimPortfolioEarnings' label={copy.claim} pendingLabel={copy.claiming} reason={model.claimReason} onClick={model.claim} />
			</SectionBlock>
		</>
	)
}
