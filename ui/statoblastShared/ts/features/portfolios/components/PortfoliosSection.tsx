import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { usePortfolioActions } from '../hooks/usePortfolioActions.js'
import { usePortfolioAggregate } from '../hooks/usePortfolioAggregate.js'
import { usePortfolioServiceCredit } from '../hooks/usePortfolioServiceCredit.js'
import { PortfolioServiceCredit } from './PortfolioServiceCredit.js'
import { usePortfolioReportingReward } from '../hooks/usePortfolioReportingReward.js'
import { PortfolioReportingReward } from './PortfolioReportingReward.js'
import { usePortfolioPurchase } from '../hooks/usePortfolioPurchase.js'
import { PortfolioAggregatePanel } from './PortfolioAggregatePanel.js'
import { PortfolioSharedFork } from './PortfolioSharedFork.js'
import { PortfolioPurchasePanel } from './PortfolioPurchasePanel.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import * as copy from '../../../copy/portfolio.js'
import * as capitalCopy from '../../../copy/portfolioCapital.js'

export function PortfoliosSection({ parameters, enabled, environmentKey, activeUniverseId }: { parameters: WriteOperationsParameters; enabled: boolean; environmentKey: number; activeUniverseId: bigint }) {
	const model = usePortfolio({ accountAddress: parameters.accountAddress, enabled, environmentKey, activeUniverseId })
	const actions = usePortfolioActions(model, parameters)
	const capital = usePortfolioAggregate(model, actions, parameters.accountAddress)
	const purchase = usePortfolioPurchase(model, actions)
	const reporting = usePortfolioReportingReward({ model, actions, accountAddress: parameters.accountAddress, questionInput: purchase.questionInput })
	const serviceCredit = usePortfolioServiceCredit({ model, actions, accountAddress: parameters.accountAddress })
	const disabled = actions.busy !== undefined
	return (
		<div className='portfolio-flow'>
			<RouteHeader title={copy.title} />
			<SectionBlock title={copy.setup}>
				<MetricGrid>
					<PortfolioInput label={copy.manager} value={model.managerInput} onChange={model.setManagerInput} disabled={disabled} />
					<PortfolioInput label={copy.owner} value={model.ownerInput} onChange={model.setOwnerInput} hint={copy.ownerHint} disabled={disabled} />
					<PortfolioInput label={copy.universe} value={model.universeInput} onChange={model.setUniverseInput} disabled={disabled} />
				</MetricGrid>
				<details>
					<summary>{copy.deploy}</summary>
					<div className='form-grid portfolio-creation-form'>
						<PortfolioInput label={copy.originPool} hint={copy.originPoolHint} value={actions.originInput} onChange={actions.setOriginInput} disabled={disabled} />
						<ViewTabs
							ariaLabel={copy.admissionMode}
							variant='segmented'
							value={actions.admissionMode}
							onChange={actions.setAdmissionMode}
							options={[
								{ value: 'open', label: copy.admissionOpen },
								{ value: 'fixed', label: copy.admissionFixed },
							]}
						/>
						<UserMessage detail={actions.admissionMode === 'open' ? copy.admissionOpenHint : copy.admissionFixedHint} />
						{actions.admissionMode === 'fixed' ? <PortfolioInput label={copy.fixedQuestionIds} hint={copy.fixedQuestionIdsHint} value={actions.fixedQuestions} onChange={actions.setFixedQuestions} disabled={disabled} /> : undefined}
						<PortfolioInput label={copy.horizon} hint={copy.horizonHint} value={actions.horizonDays} onChange={actions.setHorizonDays} disabled={disabled} numeric />
						<MetricGrid>
							<PortfolioInput label={copy.purchaseFeePercent} value={actions.economicsDraft.purchaseFeePercent} onChange={value => actions.setEconomicsField('purchaseFeePercent', value)} disabled={disabled} numeric />
							<PortfolioInput label={copy.minimumPurchaseFee} value={actions.economicsDraft.minimumPurchaseFee} onChange={value => actions.setEconomicsField('minimumPurchaseFee', value)} disabled={disabled} numeric />
							<PortfolioInput label={copy.reportingFee} hint={copy.reportingFeeHint} value={actions.economicsDraft.reportingFee} onChange={value => actions.setEconomicsField('reportingFee', value)} disabled={disabled} numeric />
							<PortfolioInput label={copy.serviceFee} value={actions.economicsDraft.serviceFeePercent} onChange={value => actions.setEconomicsField('serviceFeePercent', value)} disabled={disabled} numeric />
							<PortfolioInput label={copy.maximumOracleReward} value={actions.economicsDraft.maximumOracleReward} onChange={value => actions.setEconomicsField('maximumOracleReward', value)} disabled={disabled} numeric />
							<PortfolioInput label={capitalCopy.minimumCommitment} hint={capitalCopy.minimumCommitmentHint} value={actions.economicsDraft.minimumCommitment} onChange={value => actions.setEconomicsField('minimumCommitment', value)} disabled={disabled} numeric />
							<PortfolioInput label={capitalCopy.minimumExecution} value={actions.economicsDraft.minimumExecutionReserve} onChange={value => actions.setEconomicsField('minimumExecutionReserve', value)} disabled={disabled} numeric />
							<PortfolioInput label={capitalCopy.rewardVesting} value={actions.economicsDraft.rewardVestingHours} onChange={value => actions.setEconomicsField('rewardVestingHours', value)} disabled={disabled} numeric />
							<PortfolioInput label={capitalCopy.annualFee} hint={capitalCopy.annualFeeHint} value={actions.economicsDraft.annualFeePercent} onChange={value => actions.setEconomicsField('annualFeePercent', value)} disabled={disabled} numeric />
							<PortfolioInput label={capitalCopy.outcomeRate} hint={capitalCopy.outcomeRateHint} value={actions.economicsDraft.minimumOutcomeRate} onChange={value => actions.setEconomicsField('minimumOutcomeRate', value)} disabled={disabled} numeric />
						</MetricGrid>
						<UserMessage detail={copy.immutableEconomics} />
						{actions.creationError === undefined ? undefined : <UserMessage tone='error' detail={actions.creationError} />}
						<PortfolioButton model={actions} action='deployPortfolioAdmission' label={copy.deployAdmission} pendingLabel={copy.deployingAdmission} reason={actions.admissionDeployReason} onClick={actions.deployAdmission} />
						{actions.admissionAddress === undefined ? undefined : <code>{actions.admissionAddress}</code>}
						<PortfolioButton model={actions} action='deployPortfolio' label={copy.deploy} pendingLabel={copy.deploying} reason={actions.deployReason} onClick={actions.deploy} />
					</div>
				</details>
			</SectionBlock>
			<SectionBlock title={capitalCopy.prepareTitle} description={capitalCopy.prepareHint}>
				<UserMessage tone={actions.setupStage === 4 ? 'success' : 'neutral'} detail={capitalCopy.prepareProgress(actions.setupStage ?? 0)} />
				<div className='actions'>
					{capitalCopy.prepareStages.map((label, index) => (
						<PortfolioButton key={label} model={actions} action={`preparePortfolio${index + 1}`} label={label} pendingLabel={capitalCopy.preparing} reason={actions.preparationReason(index + 1)} onClick={() => actions.prepare(index + 1)} />
					))}
				</div>
			</SectionBlock>
			{model.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={model.error} />}
			{actions.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={actions.error} />}
			{actions.feedback === undefined ? undefined : <UserMessage placement='section' tone='success' announcement='polite' detail={actions.feedback} />}
			<TransactionScopeProvider scope={actions.scope}>
				<PortfolioAggregatePanel model={capital} actions={actions} />
				<PortfolioPurchasePanel model={model} purchase={purchase} actions={actions} />
				<PortfolioReportingReward model={reporting} actions={actions} questionInput={purchase.questionInput} setQuestionInput={purchase.setQuestionInput} />
				<PortfolioServiceCredit model={serviceCredit} actions={actions} />
				<PortfolioSharedFork
					snapshot={model.snapshot}
					actions={actions}
					bidder={parameters.accountAddress}
					openUniverse={universeId => model.setUniverseInput(universeId.toString())}
					openVault={(vault, universeId) => {
						model.setOwnerInput(vault)
						model.setUniverseInput(universeId.toString())
					}}
				/>
			</TransactionScopeProvider>
		</div>
	)
}
