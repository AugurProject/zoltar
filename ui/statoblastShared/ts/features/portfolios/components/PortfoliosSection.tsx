import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { WriteOperationsParameters } from '../../../types/app.js'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { usePortfolioActions } from '../hooks/usePortfolioActions.js'
import { usePortfolioAutomatic } from '../hooks/usePortfolioAutomatic.js'
import { usePortfolioAggregate } from '../hooks/usePortfolioAggregate.js'
import { PortfolioAggregatePanel } from './PortfolioAggregatePanel.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { PortfolioBalances, PortfolioOperationHistory } from './PortfolioBalances.js'
import { PortfolioAllocationPanel, PortfolioPolicyPanel } from './PortfolioAllocationPanel.js'
import { PortfolioWithdrawalPanel } from './PortfolioAutomaticPanel.js'
import * as copy from '../../../copy/portfolio.js'

export function PortfoliosSection({ parameters, enabled, environmentKey, activeUniverseId }: { parameters: WriteOperationsParameters; enabled: boolean; environmentKey: number; activeUniverseId: bigint }) {
	const model = usePortfolio({ accountAddress: parameters.accountAddress, enabled, environmentKey, activeUniverseId })
	const selectedUniverse = useSignal(String(activeUniverseId))
	useEffect(() => {
		selectedUniverse.value = String(activeUniverseId)
	}, [activeUniverseId])
	const actions = usePortfolioActions(model, parameters, BigInt(selectedUniverse.value))
	const automatic = usePortfolioAutomatic(model, actions, parameters.accountAddress)
	const aggregate = usePortfolioAggregate(model, actions, parameters.accountAddress, enabled)
	return (
		<div className='portfolio-flow'>
			<RouteHeader title={copy.title} description={copy.description} />
			<SectionBlock title={copy.setup}>
				<MetricGrid>
					<PortfolioInput label={copy.manager} value={model.managerInput} onChange={model.setManagerInput} disabled={actions.busy !== undefined} />
					<PortfolioInput label={copy.owner} value={model.ownerInput} onChange={model.setOwnerInput} hint={copy.ownerHint} disabled={actions.busy !== undefined} />
				</MetricGrid>
				<details>
					<summary>{copy.deploy}</summary>
					<PortfolioInput label={copy.originPool} hint={copy.originPoolHint} value={actions.originInput} onChange={actions.setOriginInput} disabled={actions.busy !== undefined} />
					<PortfolioInput label={copy.horizon} hint={copy.horizonHint} value={actions.horizonDays} onChange={actions.setHorizonDays} disabled={actions.busy !== undefined} numeric />
					<PortfolioButton model={actions} action='deployPortfolio' label={copy.deploy} pendingLabel={copy.deploying} reason={actions.deployReason} onClick={actions.deploy} />
				</details>
			</SectionBlock>
			{model.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={model.error} />}
			{actions.error === undefined ? undefined : <UserMessage placement='section' tone='error' announcement='polite' detail={actions.error} />}
			{actions.feedback === undefined ? undefined : <UserMessage placement='section' tone='success' announcement='polite' detail={actions.feedback} />}
			<TransactionScopeProvider scope={actions.scope}>
				<PortfolioAggregatePanel model={aggregate} actions={actions} />
				<details>
					<summary>{copy.recovery}</summary>
					<PortfolioInput label={copy.questionFilter} hint={copy.questionFilterHint} value={model.questionFilter} onChange={model.setQuestionFilter} disabled={actions.busy !== undefined} />
					<div className='actions'>
						<PortfolioButton model={actions} action='createPortfolioVault' label={copy.createVault} pendingLabel={copy.creatingVault} reason={actions.createReason} onClick={actions.createVault} />
					</div>
					<PaginationControls
						hasPreviousPage={model.positionPage > 0n}
						hasNextPage={model.positionPage + 1n < model.positionPageCount}
						loading={model.loading || actions.busy !== undefined}
						onPreviousPage={() => void model.previousPositionPage()}
						onNextPage={() => void model.nextPositionPage()}
						summary={copy.formatPositionPage(model.positionPage + 1n, model.positionPageCount)}
					/>
					<PortfolioBalances model={model} />
					{model.snapshot === undefined ? undefined : (
						<>
							<ViewTabs
								ariaLabel={copy.universe}
								variant='segmented'
								value={selectedUniverse.value}
								onChange={value => {
									selectedUniverse.value = value
								}}
								options={model.snapshot.branches.map(branch => ({ value: String(branch.universeId), label: `${copy.universe} ${branch.universeId}` }))}
							/>
							<PortfolioWithdrawalPanel model={automatic} actions={actions} timestamp={model.snapshot.timestamp} openVault={vault => void automatic.openVault(vault)} />
							<PortfolioOperationHistory model={model} />
							<details>
								<summary>{copy.manual}</summary>
								<SectionBlock title={copy.nativeFunding} description={copy.nativeFundingHint}>
									<PortfolioInput label={copy.amount} value={actions.fundingAmount} onChange={actions.setFundingAmount} disabled={actions.busy !== undefined} numeric />
									<PortfolioButton model={actions} action='fundPortfolioVault' label={copy.transfer} pendingLabel={copy.transferringNativeRep} reason={actions.fundingReason} onClick={actions.fund} />
								</SectionBlock>
								<PortfolioAllocationPanel model={actions} />
								<PortfolioPolicyPanel model={actions} />
							</details>
						</>
					)}
				</details>
			</TransactionScopeProvider>
			<SectionBlock title={copy.addQuestion} description={copy.questionHint}>
				<PortfolioInput label={copy.questionId} value={actions.questionInput} onChange={actions.setQuestionInput} disabled={actions.busy !== undefined} />
				<PortfolioButton model={actions} action='registerPortfolioQuestion' label={copy.addQuestion} pendingLabel={copy.addingQuestion} reason={actions.registerReason} onClick={actions.register} />
			</SectionBlock>
			{actions.exported === undefined ? undefined : (
				<SectionBlock title={copy.smartExport} description={copy.exportHint}>
					<pre className='portfolio-transaction-export'>{actions.exported}</pre>
				</SectionBlock>
			)}
		</div>
	)
}
