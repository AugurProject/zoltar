import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { PortfolioButton, PortfolioInput } from './PortfolioControls.js'
import { usePortfolioPrice, type PortfolioPriceParameters } from '../hooks/usePortfolioPrice.js'
import * as copy from '../../../copy/portfolioPrice.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioPriceReport(parameters: PortfolioPriceParameters) {
	const model = usePortfolioPrice(parameters)
	const observation = model.snapshot?.observation
	const disabled = parameters.actions.busy !== undefined
	const report = model.report
	let reportStatus: string | undefined
	if (report !== undefined) {
		reportStatus = copy.states.pending
		if (model.snapshot !== undefined && model.snapshot.timestamp >= report.eligibleAt) reportStatus = copy.states.settle
		if (report.state.settled) reportStatus = copy.states.recovery
		if (report.outcome === 1n) reportStatus = copy.states.accepted
		if (report.outcome === 2n) reportStatus = copy.states.rejected
	}
	return (
		<WorkflowSubsection title={copy.title}>
			<UserMessage detail={copy.description} />
			{model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />}
			<MetricGrid>
				<MetricField label={copy.reportingDeadline}>
					<TimestampValue timestamp={model.reportingDeadline} relative={false} />
				</MetricField>
				<MetricField label={copy.earliestSettlement}>
					<TimestampValue timestamp={model.earliestSettlement} relative={false} />
				</MetricField>
				<MetricField label={copy.currentPrice} loading={model.loading}>
					<CurrencyValue value={observation?.lastSettlementTimestamp === 0n ? undefined : observation?.lastPrice} />
				</MetricField>
				<MetricField label={copy.validUntil} loading={model.loading}>
					<TimestampValue timestamp={observation === undefined || observation.lastSettlementTimestamp === 0n ? undefined : observation.lastSettlementTimestamp + observation.validitySeconds} relative={false} />
				</MetricField>
			</MetricGrid>
			<PortfolioButton model={parameters.actions} action='preparePortfolioPrice' label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
			<MetricGrid>
				<PortfolioInput label={copy.price} value={model.priceInput} onChange={model.setPrice} disabled={disabled} numeric />
				<PortfolioInput label={copy.weth} hint={copy.wethHint} value={model.wethInput} onChange={model.setWeth} disabled={disabled} numeric />
				<MetricField label={copy.minimumWeth} loading={model.loading}>
					<CurrencyValue value={model.minimumWethAttoEth} suffix={common.weth} />
				</MetricField>
				<MetricField label={copy.requiredRep}>
					<CurrencyValue value={model.funding?.rep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.bounty} loading={model.loading}>
					<CurrencyValue value={observation?.bounty} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.walletWeth} loading={model.loading}>
					<CurrencyValue value={observation?.wethBalanceAttoEth} suffix={common.weth} />
				</MetricField>
				<MetricField label={copy.walletRep} loading={model.loading}>
					<CurrencyValue value={observation?.repBalanceAttoRep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.wrapAmount}>
					<CurrencyValue value={model.funding?.wrap} suffix={common.eth} />
				</MetricField>
			</MetricGrid>
			<PortfolioButton model={parameters.actions} action='wrapPortfolioPrice' label={copy.wrap} pendingLabel={copy.wrapping} reason={model.wrapReason} onClick={model.wrap} />
			<TokenApprovalControl
				actionLabel={copy.request}
				allowanceError={model.fundingReadError}
				allowanceLoading={model.loading}
				approvedAmount={observation?.wethAllowanceAttoEth}
				disabled={disabled}
				guardMessage={model.fundingReason}
				onApprove={amount => {
					if (amount !== undefined) void model.approve('weth', amount)
				}}
				pending={parameters.actions.busy === 'approvePortfolioPriceWeth'}
				pendingLabel={copy.approving}
				requiredAmount={model.funding?.weth}
				resetKey={`${model.snapshot?.feed}:${model.snapshot?.owner}:${model.priceInput}:${model.wethInput}:weth`}
				tokenSymbol={common.weth}
				tokenUnits={18}
			/>
			<TokenApprovalControl
				actionLabel={copy.request}
				allowanceError={model.fundingReadError}
				allowanceLoading={model.loading}
				approvedAmount={observation?.repAllowanceAttoRep}
				disabled={disabled}
				guardMessage={model.fundingReason}
				onApprove={amount => {
					if (amount !== undefined) void model.approve('rep', amount)
				}}
				pending={parameters.actions.busy === 'approvePortfolioPriceRep'}
				pendingLabel={copy.approving}
				requiredAmount={model.funding?.rep}
				resetKey={`${model.snapshot?.feed}:${model.snapshot?.owner}:${model.priceInput}:${model.wethInput}:rep`}
				tokenSymbol={common.rep}
				tokenUnits={18}
			/>
			<UserMessage tone='warning' detail={copy.requestWarning} />
			<PortfolioButton model={parameters.actions} action='requestPortfolioPrice' label={copy.request} pendingLabel={copy.requesting} reason={model.requestReason} onClick={model.request} />
			<PortfolioInput label={copy.reportId} hint={copy.reportHint} value={model.reportInput} onChange={model.setReportId} disabled={disabled} />
			<MetricGrid>
				<MetricField label={copy.reportState}>{reportStatus}</MetricField>
				<MetricField label={copy.settleAt}>
					<TimestampValue timestamp={report?.eligibleAt} relative={false} />
				</MetricField>
				<MetricField label={copy.sponsor}>
					<AddressValue address={report?.sponsor} />
				</MetricField>
				<MetricField label={copy.releasedWeth}>
					<CurrencyValue value={report?.wethCredit} suffix={common.weth} />
				</MetricField>
				<MetricField label={copy.releasedRep}>
					<CurrencyValue value={report?.repCredit} suffix={common.rep} />
				</MetricField>
			</MetricGrid>
			<UserMessage detail={copy.fundingReturnHint} />
			<div className='actions'>
				<PortfolioButton model={parameters.actions} action='settlePortfolioPrice' label={copy.settle} pendingLabel={copy.settling} reason={model.settleReason} onClick={model.settle} />
				<PortfolioButton model={parameters.actions} action='recoverPortfolioPrice' label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
				<PortfolioButton model={parameters.actions} action='withdrawPortfolioPrice' label={copy.withdraw} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: disabled || model.loading, reason: (disabled ? copy.busy : undefined) ?? (model.loading ? copy.loading : undefined) }} onClick={model.refresh} />
			</div>
		</WorkflowSubsection>
	)
}
