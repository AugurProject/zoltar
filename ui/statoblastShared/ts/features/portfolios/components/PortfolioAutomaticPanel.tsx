import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { PortfolioButton, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioAutomatic } from '../hooks/usePortfolioAutomatic.js'
import * as copy from '../../../copy/portfolio.js'

type Model = ReturnType<typeof usePortfolioAutomatic>

function WithdrawalStatus({ model }: { model: Model }) {
	if (model.readError !== undefined) return <UserMessage tone='error' detail={model.readError} />
	if (model.state === undefined) return <UserMessage loading detail={copy.recoveryLoading} />
	return (
		<div className='actions'>
			<Badge tone={model.state.withdrawalRequested ? 'warning' : 'muted'}>{model.state.withdrawalRequested ? copy.withdrawalActive : copy.noWithdrawal}</Badge>
			<Badge tone={model.state.withdrawalResidualForfeitureAllowed ? 'warning' : 'ok'}>{model.state.withdrawalResidualForfeitureAllowed ? copy.residualForfeitureAllowed : copy.residualsProtected}</Badge>
		</div>
	)
}

function positionStatus(position: Model['positions'][number], timestamp: bigint) {
	if (position.resolved) return copy.final
	return position.questionEndTime <= timestamp ? copy.matured : copy.activeQuestion
}

function WithdrawalHistory({ model, actions, openVault }: { model: Model; actions: PortfolioActions; openVault: (vault: string) => void }) {
	if (model.queueError !== undefined) return <UserMessage tone='error' detail={model.queueError} />
	if (model.queue === undefined) return <UserMessage loading detail={copy.loading} />
	if (model.queue.requests.length === 0) return <EmptyState title={copy.noWithdrawalHistory} />
	return (
		<>
			{model.queue.requests.map(entry => (
				<div className='actions' key={`${entry.vault}:${entry.requestId}`}>
					<AddressValue address={entry.vault} />
					<span>{String(entry.requestId)}</span>
					<button type='button' className='secondary' disabled={actions.busy !== undefined} onClick={() => openVault(entry.vault)}>
						{copy.load}
					</button>
				</div>
			))}
		</>
	)
}

export function PortfolioWithdrawalPanel({ model, actions, timestamp, openVault }: { model: Model; actions: PortfolioActions; timestamp: bigint; openVault: (vault: string) => void }) {
	return (
		<SectionBlock title={copy.withdrawal} description={copy.withdrawalHint}>
			<WithdrawalStatus model={model} />
			<PortfolioButton model={actions} action='withdrawPortfolioEth' label={copy.withdrawVaultEth} pendingLabel={copy.withdrawingVaultEth} reason={model.withdrawEthReason} onClick={model.withdrawEth} />
			<div className='actions'>
				<PortfolioButton model={actions} action='requestPortfolioWithdrawal' label={copy.requestWithdrawal} pendingLabel={copy.requestingWithdrawal} reason={model.requestReason} onClick={model.requestWithdrawal} />
				<PortfolioButton model={actions} action='cancelPortfolioWithdrawal' label={copy.cancelWithdrawal} pendingLabel={copy.cancelingWithdrawal} reason={model.cancelReason} onClick={model.cancelWithdrawal} />
			</div>
			<UserMessage detail={copy.cancelWithdrawalHint} />
			<div className='actions'>
				<PortfolioButton model={actions} action='allowPortfolioResidualForfeiture' label={copy.allowResidualForfeiture} pendingLabel={copy.allowingResidualForfeiture} reason={model.allowResidualForfeitureReason} onClick={model.allowResidualForfeiture} />
				<PortfolioButton model={actions} action='revokePortfolioResidualForfeiture' label={copy.revokeResidualForfeiture} pendingLabel={copy.revokingResidualForfeiture} reason={model.revokeResidualForfeitureReason} onClick={model.revokeResidualForfeiture} />
			</div>
			{model.positions.length === 0 ? (
				<EmptyState title={copy.noWithdrawalPositions} />
			) : (
				model.positions.map(position => (
					<div className='workflow-subsection' key={position.pool}>
						<div className='actions'>
							<AddressValue address={position.pool} />
							<Badge tone={position.resolved ? 'ok' : 'warning'}>{positionStatus(position, timestamp)}</Badge>
						</div>
						<MetricGrid>
							<MetricField label={copy.universe}>{String(position.universeId)}</MetricField>
							<MetricField label={copy.allocated}>
								<CurrencyValue value={position.backingAttoRep} suffix={commonCopy.rep} />
							</MetricField>
							<MetricField label={copy.commitment}>
								<CurrencyValue value={position.commitmentAttoEth} suffix={commonCopy.eth} />
							</MetricField>
						</MetricGrid>
						{position.partial ? <UserMessage detail={copy.partialWithdrawal} /> : undefined}
						<PortfolioButton model={actions} action={`processPortfolioWithdrawal:${position.pool}`} label={copy.processWithdrawal} pendingLabel={copy.processingWithdrawal} reason={position.processReason} onClick={position.process} />
					</div>
				))
			)}
			<details>
				<summary>{copy.withdrawalHistory}</summary>
				<UserMessage detail={copy.withdrawalHistoryHint} />
				<WithdrawalHistory model={model} actions={actions} openVault={openVault} />
				<PaginationControls hasPreviousPage={model.queueOffset > 0n} hasNextPage={model.queue !== undefined && model.queueOffset + 16n < model.queue.total} loading={model.queue === undefined && model.queueError === undefined} onPreviousPage={model.previousQueue} onNextPage={model.nextQueue} />
			</details>
		</SectionBlock>
	)
}
