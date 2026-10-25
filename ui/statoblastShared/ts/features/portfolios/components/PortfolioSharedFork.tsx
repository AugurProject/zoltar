import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
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
		if (branch.started) branchState = copy.branchStates.waiting
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
				<MetricField label={copy.activationDeadline} loading={model.loading}>
					{state === undefined || state.activationDeadline === 0n ? undefined : formatTimestamp(state.activationDeadline)}
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
			<WorkflowSubsection title={copy.basketTitle}>
				<UserMessage detail={copy.basketHint} />
				<MetricGrid>
					<MetricField label={copy.cashRecovery} loading={model.loading}>
						<CurrencyValue value={branch?.parentCash} suffix={common.eth} />
					</MetricField>
					<MetricField label={copy.repRecovery} loading={model.loading}>
						<CurrencyValue value={branch?.started ? branch.recoveryAttoRep : undefined} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
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
				<MetricGrid>
					<MetricField label={copy.invalidAvailable}>
						<CurrencyValue value={model.recovery?.rights[0]} />
					</MetricField>
					<MetricField label={copy.yesAvailable}>
						<CurrencyValue value={model.recovery?.rights[1]} />
					</MetricField>
					<MetricField label={copy.noAvailable}>
						<CurrencyValue value={model.recovery?.rights[2]} />
					</MetricField>
				</MetricGrid>
				<UserMessage detail={copy.transferHint} />
				<PortfolioInput label={copy.recipient} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} />
				<MetricGrid>
					<PortfolioInput label={copy.invalidTransfer} value={model.invalidRightsInput} onChange={model.setInvalidRights} disabled={disabled} numeric />
					<PortfolioInput label={copy.yesTransfer} value={model.yesRightsInput} onChange={model.setYesRights} disabled={disabled} numeric />
					<PortfolioInput label={copy.noTransfer} value={model.noRightsInput} onChange={model.setNoRights} disabled={disabled} numeric />
				</MetricGrid>
				<PortfolioButton model={parameters.actions} action='transferPortfolioRecoveryRights' label={copy.transfer} pendingLabel={copy.transferring} reason={model.transferReason} onClick={model.transfer} />
			</WorkflowSubsection>
		</SectionBlock>
	)
}
