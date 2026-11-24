import * as collateralCopy from '../../../copy/collateral.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { OnChainText } from '@zoltar/ui-core-shared/components/OnChainText.js'
import { OutcomeIdentity } from '@zoltar/ui-core-shared/components/OutcomeIdentity.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolSharedFork, type SecurityPoolSharedForkParameters } from '../hooks/useSecurityPoolSharedFork.js'
import { SecurityPoolPriceReport } from './SecurityPoolPriceReport.js'
import { branchPriceTarget } from '../hooks/useSecurityPoolPrice.js'
import { SecurityPoolRepairAuction } from './SecurityPoolRepairAuction.js'
import * as copy from '../../../copy/securityPoolSharedFork.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function SecurityPoolSharedFork(parameters: SecurityPoolSharedForkParameters) {
	const model = useSecurityPoolSharedFork(parameters)
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
				<SecurityPoolInput label={copy.universe} value={model.sourceInput} onChange={model.setSource} disabled={disabled} />
				<SecurityPoolInput label={copy.outcome} hint={copy.outcomeHint} value={model.outcomeInput} onChange={model.setOutcome} disabled={disabled} />
			</MetricGrid>
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			{state?.forkTime === 0n ? <UserMessage detail={copy.noFork} /> : undefined}
			{model.outcome?.outcomeLabel === undefined ? undefined : (
				<UserMessage
					detail={
						<>
							<OnChainText text={model.outcome.questionTitle} />
							{copy.questionOutcomeSeparator}
							<OnChainText text={model.outcome.outcomeLabel} />
							{branch === undefined ? undefined : <OutcomeIdentity label={model.outcome.outcomeLabel} outcomeIndex={branch.outcomeIndex} />}
						</>
					}
				/>
			)}
			<MetricGrid>
				<MetricField label={copy.choiceDeadline} loading={model.loading}>
					{state === undefined || state.choiceDeadline === 0n ? undefined : formatTimestamp(state.choiceDeadline)}
				</MetricField>
				<MetricField label={copy.activationDeadline} loading={model.loading}>
					{state === undefined || state.activationDeadline === 0n ? undefined : formatTimestamp(state.activationDeadline)}
				</MetricField>
				<MetricField label={copy.child} loading={model.loading}>
					{branch === undefined ? undefined : <IdentifierValue abbreviated value={formatUniverseIdHex(branch.universeId)} />}
				</MetricField>
				<MetricField label={copy.forkQuestionId} loading={model.loading}>
					{model.outcome === undefined ? undefined : <IdentifierValue abbreviated value={formatQuestionIdHex(model.outcome.questionId)} />}
				</MetricField>
				<MetricField label={copy.state} loading={model.loading}>
					{branchState}
				</MetricField>
			</MetricGrid>
			<UserMessage tone='warning' detail={copy.choiceHint} />
			<UserMessage detail={state?.choice.recorded ? copy.chosen(state.choice.outcomeIndex) : copy.unchosen} />
			<div className='actions'>
				<SecurityPoolButton model={parameters.actions} action='prepareSecurityPoolFork' label={copy.prepareBranch} pendingLabel={copy.preparingBranch} reason={model.prepareBranchReason} onClick={model.prepareBranch} />
				<SecurityPoolButton model={parameters.actions} action='chooseSecurityPoolFork' label={copy.choice} pendingLabel={copy.choosing} reason={model.chooseReason} onClick={model.choose} />
				<SecurityPoolButton model={parameters.actions} action='startSecurityPoolFork' label={copy.start} pendingLabel={copy.starting} reason={model.startReason} onClick={model.start} />
				<SecurityPoolButton model={parameters.actions} action='finalizeSecurityPoolFork' label={copy.finalize} pendingLabel={copy.finalizing} reason={model.finalizeReason} onClick={model.finalize} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.open} pendingLabel={copy.loading} availability={{ disabled: disabled || model.openReason !== undefined, reason: disabled ? copy.busy : model.openReason }} onClick={model.open} />
			</div>
			<SecurityPoolPriceReport scope='branch' target={branchPriceTarget(state)} actions={parameters.actions} bidder={parameters.bidder} referencePrice={parameters.snapshot?.acceptedPrice} />
			<SecurityPoolRepairAuction fork={state} actions={parameters.actions} bidder={parameters.bidder} openVault={parameters.openVault} />
			<WorkflowSubsection title={copy.basketTitle}>
				<UserMessage detail={copy.basketHint} />
				<MetricGrid>
					<MetricField label={copy.cashRecovery} loading={model.loading}>
						<CurrencyValue value={branch?.parentCash} suffix={parameters.snapshot?.collateral.symbol ?? collateralCopy.fallback} units={parameters.snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.repRecovery} loading={model.loading}>
						<CurrencyValue value={branch?.started ? branch.recoveryAttoRep : undefined} suffix={common.rep} />
					</MetricField>
				</MetricGrid>
			</WorkflowSubsection>
			<WorkflowSubsection title={copy.recovery}>
				<UserMessage detail={copy.recoveryHint} />
				<MetricGrid>
					<SecurityPoolInput label={copy.question} value={model.questionInput} onChange={model.setQuestion} disabled={disabled} />
					<SecurityPoolInput label={copy.shares} value={model.sharesInput} onChange={model.setShares} disabled={disabled} numeric />
					<MetricField label={copy.available}>
						<CurrencyValue value={model.recovery?.availableShares} units={parameters.snapshot?.collateral.decimals ?? 0} />
					</MetricField>
				</MetricGrid>
				<div className='actions'>
					<SecurityPoolButton model={parameters.actions} action='prepareSecurityPoolRecovery' label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
					<SecurityPoolButton model={parameters.actions} action='recoverSecurityPoolSource' label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
				</div>
				<MetricGrid>
					<MetricField label={copy.invalidAvailable}>
						<CurrencyValue value={model.recovery?.rights[0]} units={parameters.snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.yesAvailable}>
						<CurrencyValue value={model.recovery?.rights[1]} units={parameters.snapshot?.collateral.decimals ?? 0} />
					</MetricField>
					<MetricField label={copy.noAvailable}>
						<CurrencyValue value={model.recovery?.rights[2]} units={parameters.snapshot?.collateral.decimals ?? 0} />
					</MetricField>
				</MetricGrid>
				<UserMessage detail={copy.transferHint} />
				<SecurityPoolInput label={copy.recipient} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} />
				<MetricGrid>
					<SecurityPoolInput label={copy.invalidTransfer} value={model.invalidRightsInput} onChange={model.setInvalidRights} disabled={disabled} numeric />
					<SecurityPoolInput label={copy.yesTransfer} value={model.yesRightsInput} onChange={model.setYesRights} disabled={disabled} numeric />
					<SecurityPoolInput label={copy.noTransfer} value={model.noRightsInput} onChange={model.setNoRights} disabled={disabled} numeric />
				</MetricGrid>
				<SecurityPoolButton model={parameters.actions} action='transferSecurityPoolRecoveryRights' label={copy.transfer} pendingLabel={copy.transferring} reason={model.transferReason} onClick={model.transfer} />
			</WorkflowSubsection>
		</SectionBlock>
	)
}
