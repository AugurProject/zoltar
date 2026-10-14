import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatEther, toHex, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as copy from '../../../copy/portfolio.js'
import { emptyAllocationDraft } from '../lib/draft.js'
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'

export function PortfolioAllocationPanel({ model }: { model: PortfolioActions }) {
	return (
		<SectionBlock title={copy.allocations} description={copy.allocationHint}>
			<MetricGrid>
				<PortfolioInput label={copy.reserve} value={model.reserve} onChange={model.setReserve} disabled={model.busy !== undefined} numeric />
				<PortfolioInput label={copy.health} value={model.health} onChange={model.setHealth} disabled={model.busy !== undefined} numeric />
			</MetricGrid>
			{model.branch?.positions.map(position => {
				const draft = model.drafts[String(position.questionId)] ?? emptyAllocationDraft()
				return (
					<WorkflowSubsection key={position.pool} title={<AddressValue address={position.pool} />}>
						<MetricGrid>
							<MetricField label={copy.questionId}>
								<code>{toHex(position.questionId)}</code>
							</MetricField>
						</MetricGrid>
						<label>
							<input type='checkbox' disabled={model.busy !== undefined} checked={draft.selected} onChange={event => model.setDraft(position.questionId, { selected: event.currentTarget.checked, commitment: draft.commitment || formatEther(position.commitmentAttoEth) })} />
							{copy.select}
						</label>
						<MetricGrid>
							<PortfolioInput label={copy.deposit} value={draft.deposit} onChange={value => model.setDraft(position.questionId, { deposit: value })} disabled={model.busy !== undefined || !draft.selected} numeric />
							<PortfolioInput label={copy.targetCommitment} value={draft.commitment} onChange={value => model.setDraft(position.questionId, { commitment: value })} disabled={model.busy !== undefined || !draft.selected} numeric />
						</MetricGrid>
					</WorkflowSubsection>
				)
			})}
			{model.plan === undefined ? undefined : (
				<MetricGrid>
					<MetricField label={copy.idle}>
						<CurrencyValue value={model.plan.idleAfterAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</MetricGrid>
			)}
			<div className='actions'>
				<PortfolioButton model={model} action='allocatePortfolio' label={copy.submit} pendingLabel={copy.submitting} reason={model.allocationReason} onClick={model.submit} />
				<button type='button' className='secondary' disabled={model.plan === undefined || model.busy !== undefined} onClick={() => void model.exportBatch()}>
					{copy.exportTransaction}
				</button>
			</div>
		</SectionBlock>
	)
}

function PortfolioPolicyStatus({ model }: { model: PortfolioActions }) {
	if (model.policyReadError !== undefined) return <UserMessage tone='error' announcement='assertive' detail={model.policyReadError} />
	if (model.policy === undefined) return <UserMessage loading announcement='polite' detail={copy.policyLoading} />
	if (model.policy.config.executor === zeroAddress) return <UserMessage detail={copy.policyInactive} />
	return (
		<MetricGrid>
			<MetricField label={copy.policyActive}>{String(model.policy.version)}</MetricField>
			<MetricField label={copy.executor}>
				<AddressValue address={model.policy.config.executor} />
			</MetricField>
			<MetricField label={copy.universe}>{String(model.policy.config.universeId)}</MetricField>
			<MetricField label={copy.policyExpires}>{formatTimestamp(model.policy.config.expiresAt)}</MetricField>
			<MetricField label={copy.policyRemaining}>
				<CurrencyValue value={model.policy.config.depositBudgetAttoRep - model.policy.spentDepositAttoRep} suffix={commonCopy.rep} />
			</MetricField>
			<MetricField label={copy.policyCommitmentRemaining}>
				<CurrencyValue value={model.policy.config.commitmentIncreaseBudgetAttoEth - model.policy.spentCommitmentIncreaseAttoEth} suffix={commonCopy.eth} />
			</MetricField>
		</MetricGrid>
	)
}

export function PortfolioPolicyPanel({ model }: { model: PortfolioActions }) {
	return (
		<SectionBlock title={copy.policy} description={copy.policyHint}>
			<PortfolioPolicyStatus model={model} />
			<UserMessage tone='warning' detail={copy.policyRisk} />
			<UserMessage detail={copy.policyExecutionHint} />
			<MetricGrid>
				<PortfolioInput label={copy.executor} value={model.executor} onChange={model.setExecutor} disabled={model.busy !== undefined} />
				<PortfolioInput label={copy.expires} value={model.expiryHours} onChange={model.setExpiryHours} disabled={model.busy !== undefined} numeric />
				<PortfolioInput label={copy.depositBudget} value={model.depositBudget} onChange={model.setDepositBudget} disabled={model.busy !== undefined} numeric />
				<PortfolioInput label={copy.commitmentBudget} value={model.commitmentBudget} onChange={model.setCommitmentBudget} disabled={model.busy !== undefined} numeric />
			</MetricGrid>
			<div className='actions'>
				<PortfolioButton model={model} action='installPortfolioPolicy' label={copy.install} pendingLabel={copy.installing} reason={model.policyReason} onClick={model.installPolicy} />
				<PortfolioButton model={model} action='revokePortfolioPolicy' label={copy.revoke} pendingLabel={copy.revoking} reason={model.vaultReason} onClick={model.revokePolicy} />
				<ActionLauncherButton
					tone='secondary'
					idleLabel={copy.exportPolicy}
					pendingLabel={copy.exportPolicy}
					availability={{ disabled: model.busy !== undefined || model.policyExportReason !== undefined, reason: model.busy !== undefined ? copy.busy : model.policyExportReason }}
					onClick={() => void model.exportPolicy()}
				/>
			</div>
		</SectionBlock>
	)
}
