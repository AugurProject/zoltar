import { useId } from 'preact/hooks'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
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
import { PortfolioButton, PortfolioInput, type PortfolioActions } from './PortfolioControls.js'
import type { usePortfolioAutomatic } from '../hooks/usePortfolioAutomatic.js'
import * as copy from '../../../copy/portfolio.js'
import { buildPoolsRouteHash } from '../../../lib/statoblastLocation.js'

type Model = ReturnType<typeof usePortfolioAutomatic>

function AutomaticSummary({ model }: { model: Model }) {
	if (model.readError !== undefined) return <UserMessage tone='error' detail={model.readError} />
	if (model.state === undefined) return <UserMessage loading detail={copy.automaticLoading} />
	return (
		<MetricGrid>
			<MetricField label={copy.automatic}>
				<Badge tone={model.state.enabled ? 'ok' : 'muted'}>{model.state.enabled ? copy.automaticEnabled : copy.automaticDisabled}</Badge>
			</MetricField>
			<MetricField label={copy.availableVaultEth}>
				<CurrencyValue value={model.state.ethBalanceAttoEth} suffix={commonCopy.eth} />
			</MetricField>
			<MetricField label={copy.horizonDuration}>{copy.formatHorizon(model.state.maximumQuestionHorizonSeconds)}</MetricField>
			<MetricField label={copy.reserve}>
				<CurrencyValue value={model.state.minimumIdleAttoRep} suffix={commonCopy.rep} />
			</MetricField>
			<MetricField label={copy.health}>{String(model.state.minimumHealthFactorBps)}</MetricField>
			<MetricField label={copy.reservationFee}>{String(model.state.reservationFeeBps)}</MetricField>
			<MetricField label={copy.minimumAllocationFee}>
				<CurrencyValue value={model.state.minimumAllocationFeeAttoEth} suffix={commonCopy.eth} />
			</MetricField>
		</MetricGrid>
	)
}

function WithdrawalStatus({ model }: { model: Model }) {
	if (model.readError !== undefined) return <UserMessage tone='error' detail={model.readError} />
	if (model.state === undefined) return <UserMessage loading detail={copy.automaticLoading} />
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

export function PortfolioAutomaticPanel({ model, actions }: { model: Model; actions: PortfolioActions }) {
	return (
		<SectionBlock title={copy.automatic} description={copy.automaticHint}>
			<AutomaticSummary model={model} />
			<UserMessage detail={copy.availableVaultEthHint} />
			<button type='button' className='secondary' disabled={actions.busy !== undefined} onClick={() => void model.retry()}>
				{copy.refresh}
			</button>
			<UserMessage tone='warning' detail={copy.automaticRisk} />
			<MetricGrid>
				<PortfolioInput label={copy.reserve} value={model.reserve} onChange={model.setReserve} disabled={actions.busy !== undefined} numeric />
				<PortfolioInput label={copy.health} value={model.health} onChange={model.setHealth} disabled={actions.busy !== undefined} numeric />
				<PortfolioInput label={copy.reservationFee} hint={copy.reservationFeeHint} value={model.reservationFee} onChange={model.setReservationFee} disabled={actions.busy !== undefined} numeric />
				<PortfolioInput label={copy.minimumAllocationFee} hint={copy.minimumAllocationFeeHint} value={model.minimumAllocationFee} onChange={model.setMinimumAllocationFee} disabled={actions.busy !== undefined} numeric />
			</MetricGrid>
			<label>
				<input type='checkbox' checked={model.acknowledged} disabled={actions.busy !== undefined} onChange={event => model.setAcknowledged(event.currentTarget.checked)} />
				{copy.automaticConsent}
			</label>
			<div className='actions'>
				<PortfolioButton model={actions} action='enablePortfolioAutomatic' label={copy.enableAutomatic} pendingLabel={copy.enablingAutomatic} reason={model.enableReason} onClick={model.enable} />
				<PortfolioButton model={actions} action='revokePortfolioPolicy' label={copy.revoke} pendingLabel={copy.revoking} reason={actions.vaultReason} onClick={actions.revokePolicy} />
				<PortfolioButton model={actions} action='withdrawPortfolioEth' label={copy.withdrawVaultEth} pendingLabel={copy.withdrawingVaultEth} reason={model.withdrawEthReason} onClick={model.withdrawEth} />
			</div>
		</SectionBlock>
	)
}

export function PortfolioWithdrawalPanel({ model, actions, timestamp, openVault }: { model: Model; actions: PortfolioActions; timestamp: bigint; openVault: (vault: string) => void }) {
	return (
		<SectionBlock title={copy.withdrawal} description={copy.withdrawalHint}>
			<WithdrawalStatus model={model} />
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

export function PortfolioMintPanel({ model, actions }: { model: Model; actions: Pick<PortfolioActions, 'busy' | 'scope'> }) {
	const quoteReasonId = useId()
	const busyReason = actions.busy !== undefined ? copy.busy : undefined
	let quoteReason = busyReason
	if (quoteReason === undefined && model.estimatedReservationFee === undefined) quoteReason = model.reservationFeeLoading ? copy.reservationFeeLoading : (model.reservationFeeError ?? model.mintReason ?? copy.reservationFeeWaiting)
	return (
		<SectionBlock title={copy.mint} description={copy.mintHint}>
			<UserMessage detail={copy.mintOracleHint} />
			<UserMessage detail={copy.maturityHint} />
			{model.mintPool === undefined ? undefined : <a href={buildPoolsRouteHash({ view: 'operate', securityPoolAddress: model.mintPool, tab: 'vaults' })}>{copy.openPrice}</a>}
			<PortfolioInput label={copy.questionId} value={model.questionId} onChange={model.setQuestionId} disabled={actions.busy !== undefined} />
			{model.mintQuestionLoading ? <UserMessage loading detail={copy.mintQuestionLoading} announcement='polite' /> : undefined}
			{model.mintQuestionError !== undefined ? <UserMessage tone='error' detail={model.mintQuestionError} announcement='polite' /> : undefined}
			<button type='button' className='secondary' disabled={actions.busy !== undefined || model.mintQuestionLoading} onClick={model.retryMintQuestion}>
				{copy.retryMintQuestion}
			</button>
			<MetricGrid>
				<PortfolioInput label={copy.mintAmount} value={model.mintAmount} onChange={model.setMintAmount} disabled={actions.busy !== undefined} numeric />
				<PortfolioInput label={copy.maximumReservationFee} hint={copy.maximumReservationFeeHint} value={model.maximumReservationFee} onChange={model.setMaximumReservationFee} disabled={actions.busy !== undefined} numeric />
				<PortfolioInput label={copy.minimumShares} hint={copy.minimumSharesHint} value={model.minimumShares} onChange={model.setMinimumShares} disabled={actions.busy !== undefined} numeric />
			</MetricGrid>
			<PortfolioInput label={copy.contributors} hint={copy.contributorsHint} value={model.contributors} onChange={model.setContributors} disabled={actions.busy !== undefined} />
			<MetricGrid>
				<MetricField label={copy.estimatedReservationFee} loading={model.reservationFeeLoading}>
					{model.estimatedReservationFee !== undefined ? <CurrencyValue value={model.estimatedReservationFee} suffix={commonCopy.eth} /> : <span aria-label={quoteReason}>{model.reservationFeeLoading ? '—' : copy.reservationFeeUnavailable}</span>}
				</MetricField>
			</MetricGrid>
			<span className='visually-hidden' id={quoteReasonId}>
				{quoteReason}
			</span>
			<UserMessage detail={copy.reservationFeeEstimateHint} />
			<div className='actions'>
				<ActionLauncherButton
					tone='secondary'
					idleLabel={copy.retryReservationFee}
					pendingLabel={copy.reservationFeeLoading}
					showDisabledReason={false}
					describedBy={quoteReasonId}
					availability={{ disabled: actions.busy !== undefined || model.reservationFeeLoading, reason: quoteReason }}
					onClick={model.retryReservationFee}
				/>
				<ActionLauncherButton
					tone='secondary'
					idleLabel={copy.useEstimatedReservationFee}
					pendingLabel={copy.reservationFeeLoading}
					showDisabledReason={false}
					describedBy={quoteReasonId}
					availability={{ disabled: actions.busy !== undefined || model.estimatedReservationFee === undefined, reason: quoteReason }}
					onClick={model.useEstimatedReservationFee}
				/>
			</div>
			<PortfolioButton model={actions} action='mintPortfolioCompleteSet' label={copy.mint} pendingLabel={copy.minting} reason={model.mintReason} onClick={model.mint} />
		</SectionBlock>
	)
}
