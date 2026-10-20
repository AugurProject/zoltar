import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { usePortfolioSharedFork, type PortfolioSharedForkParameters } from '../hooks/usePortfolioSharedFork.js'
import * as copy from '../../../copy/portfolioSharedFork.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioSharedFork(parameters: PortfolioSharedForkParameters) {
	const model = usePortfolioSharedFork(parameters)
	const state = model.state
	const disabled = parameters.actions.busy !== undefined
	const branch = state?.branch
	let branchState = copy.branchStates.choose
	if (branch !== undefined) {
		branchState = copy.branchStates.unprepared
		if (branch.prepared) branchState = copy.branchStates.chosen
		if (branch.started) branchState = copy.branchStates.recap
		if (branch.ready) branchState = copy.branchStates.active
	}
	return (
		<SectionBlock title={copy.title} description={copy.description}>
			<MetricGrid>
				<PortfolioInput label={copy.universe} value={model.sourceInput} onChange={model.setSource} disabled={disabled} />
				<PortfolioInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled} />
			</MetricGrid>
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			{state?.forkTime === 0n ? <UserMessage detail={copy.noFork} /> : undefined}
			{model.outcome?.outcomeLabel === undefined ? undefined : <UserMessage detail={copy.questionOutcome(model.outcome.questionTitle, model.outcome.outcomeLabel)} />}
			<MetricGrid>
				<MetricField label={copy.choiceDeadline} loading={model.loading}>
					{state === undefined || state.choiceDeadline === 0n ? undefined : formatTimestamp(state.choiceDeadline)}
				</MetricField>
				<MetricField label={copy.recapDeadline} loading={model.loading}>
					{state === undefined || state.recapitalizationDeadline === 0n ? undefined : formatTimestamp(state.recapitalizationDeadline)}
				</MetricField>
				<MetricField label={copy.child} loading={model.loading}>
					{branch?.universeId.toString()}
				</MetricField>
				<MetricField label={copy.state} loading={model.loading}>
					{branchState}
				</MetricField>
			</MetricGrid>
			<UserMessage tone='warning' detail={copy.choiceHint} />
			<UserMessage detail={state?.choice.recorded ? copy.chosen(state.choice.outcomeIndex) : copy.unchosen} />
			<div className='actions'>
				<PortfolioButton model={parameters.actions} action='choosePortfolioFork' label={copy.choice} pendingLabel={copy.choosing} reason={model.chooseReason} onClick={model.choose} />
				<PortfolioButton model={parameters.actions} action='startPortfolioFork' label={copy.start} pendingLabel={copy.starting} reason={model.startReason} onClick={model.start} />
				<PortfolioButton model={parameters.actions} action='finalizePortfolioFork' label={copy.finalize} pendingLabel={copy.finalizing} reason={model.finalizeReason} onClick={model.finalize} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.open} pendingLabel={copy.loading} availability={{ disabled: disabled || model.openReason !== undefined, reason: disabled ? copy.busy : model.openReason }} onClick={model.open} />
			</div>
			<WorkflowSubsection title={copy.recap}>
				<UserMessage detail={copy.recapHint} />
				<MetricGrid>
					<PortfolioInput label={copy.budget} value={model.budgetInput} onChange={model.setBudget} disabled={disabled} numeric />
					<PortfolioInput label={copy.maximumRep} value={model.maximumRepInput} onChange={model.setMaximumRep} disabled={disabled} numeric />
					<PortfolioInput label={copy.minimumRep} value={model.minimumRepInput} onChange={model.setMinimumRep} disabled={disabled} numeric />
					<PortfolioInput label={copy.maximumCommitment} value={model.maximumCommitmentInput} onChange={model.setMaximumCommitment} disabled={disabled} numeric />
					<PortfolioInput label={copy.maximumOwnRep} value={model.maximumOwnRepInput} onChange={model.setMaximumOwnRep} disabled={disabled} numeric />
					<PortfolioInput label={copy.health} value={model.healthInput} onChange={model.setHealth} disabled={disabled} numeric />
				</MetricGrid>
				<MetricGrid>
					<MetricField label={copy.quoteRep}>
						<CurrencyValue value={model.quote?.rep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.quoteCommitment}>
						<CurrencyValue value={model.quote?.commitment} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.quoteCost}>
						<CurrencyValue value={model.quote?.cost} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.quoteOwnRep}>
						<CurrencyValue value={model.quote?.ownRep} suffix={common.rep} />
					</MetricField>
					<MetricField label={copy.quoteReserve}>
						<CurrencyValue value={model.quote?.executionReserve} suffix={common.eth} />
					</MetricField>
				</MetricGrid>
				<TokenApprovalControl
					actionLabel={copy.buy}
					allowanceError={model.error}
					allowanceLoading={model.loading}
					approvedAmount={model.wallet?.allowance}
					disabled={disabled}
					guardMessage={model.recapReason}
					onApprove={amount => {
						if (amount !== undefined) void model.approve(amount)
					}}
					pending={parameters.actions.busy === 'approvePortfolioRecap'}
					pendingLabel={copy.approving}
					requiredAmount={model.quote?.ownRep}
					resetKey={`${state?.controller}:${state?.owner}:${branch?.universeId}:${model.quote?.ownRep}`}
					tokenSymbol={common.rep}
					tokenUnits={18}
				/>
				<PortfolioButton model={parameters.actions} action='buyPortfolioRecap' label={copy.buy} pendingLabel={copy.buying} reason={model.buyReason} onClick={model.buy} />
			</WorkflowSubsection>
			<WorkflowSubsection title={copy.recovery}>
				<UserMessage detail={copy.recoveryHint} />
				<MetricGrid>
					<PortfolioInput label={copy.question} value={model.questionInput} onChange={model.setQuestion} disabled={disabled} />
					<PortfolioInput label={copy.shares} value={model.sharesInput} onChange={model.setShares} disabled={disabled} numeric />
					<MetricField label={copy.available}>
						<CurrencyValue value={model.recovery?.availableShares} />
					</MetricField>
				</MetricGrid>
				<div className='actions'>
					<PortfolioButton model={parameters.actions} action='preparePortfolioRecovery' label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
					<PortfolioButton model={parameters.actions} action='recoverPortfolioSource' label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
				</div>
			</WorkflowSubsection>
		</SectionBlock>
	)
}
