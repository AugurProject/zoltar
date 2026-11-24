import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { useEffect, useId, useState } from 'preact/hooks'
import * as collateralCopy from '../../../copy/collateral.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolPrice, type SecurityPoolPriceParameters } from '../hooks/useSecurityPoolPrice.js'
import { getSecurityPoolPriceWarning } from '../lib/priceWarning.js'
import * as copy from '../../../copy/securityPoolPrice.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function SecurityPoolPriceReport({
	returnFundsOnly = false,
	onFundingStatus,
	hideReportingDeadline = false,
	redesigned = false,
	priceBand,
	openOracleHref,
	onPriceAccepted,
	...parameters
}: SecurityPoolPriceParameters & {
	returnFundsOnly?: boolean
	onFundingStatus?: ((fundsRemain: boolean) => void) | undefined
	hideReportingDeadline?: boolean
	redesigned?: boolean
	priceBand?: { accepted: bigint; health: bigint; liquidation: bigint; validUntil: bigint; timestamp: bigint; decimals: number } | undefined
	openOracleHref?: string | undefined
	onPriceAccepted?: ((universeId: bigint) => void) | undefined
}) {
	const model = useSecurityPoolPrice(parameters)
	const scoped = copy.scopes[parameters.scope]
	// Only a branch has a preparation window and a feed to prepare.
	// Its report sits under a disclosure that already names it, so it carries no heading of its own.
	const branch = parameters.scope === 'branch'
	const priceWarningId = useId()
	const observation = model.snapshot?.observation
	const observedUniverse = model.snapshot?.universeId
	useEffect(() => {
		if (observedUniverse !== undefined && observation !== undefined && observation.lastSettlementTimestamp > 0n) onPriceAccepted?.(observedUniverse)
	}, [observedUniverse, observation?.lastSettlementTimestamp, onPriceAccepted])
	const disabled = parameters.actions.busy !== undefined
	const report = model.report
	const fundsRemain = report !== undefined && (report.wethCredit > 0n || report.repCredit > 0n || !report.state.settled || report.outcome === 0n)
	useEffect(() => {
		if (report !== undefined) onFundingStatus?.(fundsRemain)
	}, [report?.reportId, fundsRemain, onFundingStatus])
	const visible = usePageVisible()
	const chainTime = model.snapshot?.timestamp ?? priceBand?.timestamp
	const [now, setNow] = useState<bigint>()
	useEffect(() => {
		if (chainTime === undefined || !visible) return
		const readAt = Date.now()
		setNow(chainTime)
		const timer = setInterval(() => setNow(chainTime + BigInt(Math.floor((Date.now() - readAt) / 1000))), 1000)
		return () => clearInterval(timer)
	}, [chainTime, visible])
	const accepted = observation !== undefined && observation.lastSettlementTimestamp !== 0n ? observation.lastPrice : priceBand?.accepted
	const priceUnits = 36 - (priceBand?.decimals ?? model.collateral.decimals)
	const healthPrice = priceBand?.health
	const deviation = accepted === undefined || healthPrice === undefined || healthPrice < accepted || healthPrice === 0n ? undefined : ((healthPrice - accepted) * 10_000n + healthPrice / 2n) / healthPrice
	const priceWarning = getSecurityPoolPriceWarning(model.proposedPrice, model.comparisonPrice, model.collateral)
	let reportStatus: string | undefined
	if (report !== undefined) {
		reportStatus = copy.states.pending
		if (model.snapshot !== undefined && model.snapshot.timestamp >= report.eligibleAt) reportStatus = copy.states.settle
		if (report.state.settled) reportStatus = copy.states.recovery
		if (report.outcome === 1n) reportStatus = copy.states.accepted
		if (report.outcome === 2n) reportStatus = copy.states.rejected
	}
	const expiresAt = observation === undefined || observation.lastSettlementTimestamp === 0n ? priceBand?.validUntil : observation.lastSettlementTimestamp + observation.validitySeconds
	const priceStatus = expiresAt === undefined || now === undefined || now >= expiresAt ? copy.priceDue : copy.priceCurrent
	const reportHeading = report === undefined ? copy.currentReport : copy.reportHeading(report.reportId)
	const summary = (
		<MetricGrid>
			{branch && !hideReportingDeadline ? (
				<MetricField label={copy.reportingDeadline}>
					<TimestampValue timestamp={model.reportingDeadline} relative={false} />
				</MetricField>
			) : undefined}
			<MetricField label={copy.earliestSettlement}>
				<TimestampValue timestamp={model.earliestSettlement} relative={false} />
			</MetricField>
			<MetricField label={copy.currentPrice} loading={model.loading}>
				<CurrencyValue value={accepted} units={priceUnits} />
			</MetricField>
			<MetricField label={copy.validUntil} loading={model.loading}>
				<TimestampValue timestamp={expiresAt} relative={now === undefined ? false : 'after'} {...(now === undefined ? {} : { currentTimestamp: now })} />
			</MetricField>
			{deviation !== undefined && <MetricField label={copy.deviation}>{copy.formatDeviation(formatUnits(deviation, 2))}</MetricField>}
		</MetricGrid>
	)
	const funding = (
		<>
			{branch ? <SecurityPoolButton model={parameters.actions} action={model.actionId('prepare')} label={copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} /> : undefined}
			<MetricGrid>
				<div className='initial-price-input'>
					<SecurityPoolInput label={copy.price} value={model.priceInput} onChange={model.setPrice} disabled={disabled} numeric describedBy={priceWarning === undefined ? undefined : priceWarningId} />
					<div aria-live='polite' className='field-error-live-region'>
						{priceWarning === undefined ? undefined : <UserMessage id={priceWarningId} placement='field' tone='warning' detail={priceWarning} />}
					</div>
				</div>
				<SecurityPoolInput label={collateralCopy.reportStake(model.collateral.symbol)} hint={copy.wethHint} value={model.wethInput} onChange={model.setWeth} disabled={disabled} numeric />
				<MetricField label={collateralCopy.minimumReportStake(model.collateral.symbol)} loading={model.loading}>
					<CurrencyValue value={model.minimumWethAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
				</MetricField>
				<MetricField label={scoped.requiredRep}>
					<CurrencyValue value={model.funding?.rep} suffix={common.rep} />
				</MetricField>
				<MetricField label={copy.currentExposure} loading={model.loading}>
					<CurrencyValue value={observation?.currentExposureAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.reportCoverage}>
					<CurrencyValue value={model.funding?.coveredExposureAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.growthHeadroom}>
					<CurrencyValue value={model.funding?.growthHeadroomAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.bounty} loading={model.loading}>
					<CurrencyValue value={observation?.bounty} suffix={common.eth} />
				</MetricField>
				<MetricField label={collateralCopy.walletBalance(model.collateral.symbol)} loading={model.loading}>
					<CurrencyValue value={observation?.wethBalanceAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
				</MetricField>
				<MetricField label={scoped.walletRep} loading={model.loading}>
					<CurrencyValue value={observation?.repBalanceAttoRep} suffix={common.rep} />
				</MetricField>
				{model.collateral.symbol === collateralCopy.weth ? (
					<MetricField label={copy.wrapAmount}>
						<CurrencyValue value={model.funding?.wrap} suffix={common.eth} />
					</MetricField>
				) : undefined}
			</MetricGrid>
			{model.collateral.symbol === collateralCopy.weth ? <SecurityPoolButton model={parameters.actions} action={model.actionId('wrap')} label={copy.wrap} pendingLabel={copy.wrapping} reason={model.wrapReason} onClick={model.wrap} /> : undefined}
			<TokenApprovalControl
				actionLabel={scoped.request}
				allowanceError={model.fundingReadError}
				allowanceLoading={model.loading}
				approvedAmount={observation?.wethAllowanceAttoEth}
				disabled={disabled}
				guardMessage={model.fundingReason}
				onApprove={amount => {
					if (amount !== undefined) void model.approve('weth', amount)
				}}
				pending={parameters.actions.busy === model.actionId('approveWeth')}
				pendingLabel={common.formatApprovingToken(model.collateral.symbol)}
				requiredAmount={model.funding?.weth}
				resetKey={`${model.draftKey}:${model.priceInput}:${model.wethInput}:weth`}
				tokenSymbol={model.collateral.symbol}
				tokenUnits={model.collateral.decimals}
			/>
			<TokenApprovalControl
				actionLabel={scoped.request}
				allowanceError={model.fundingReadError}
				allowanceLoading={model.loading}
				approvedAmount={observation?.repAllowanceAttoRep}
				disabled={disabled}
				guardMessage={model.fundingReason}
				onApprove={amount => {
					if (amount !== undefined) void model.approve('rep', amount)
				}}
				pending={parameters.actions.busy === model.actionId('approveRep')}
				pendingLabel={common.approvingRep}
				requiredAmount={model.funding?.rep}
				resetKey={`${model.draftKey}:${model.priceInput}:${model.wethInput}:rep`}
				tokenSymbol={common.rep}
				tokenUnits={18}
			/>
			<UserMessage tone='warning' detail={scoped.requestWarning} />
			<UserMessage detail={copy.coverageWarning} />
			<SecurityPoolButton model={parameters.actions} action={model.actionId('request')} label={scoped.request} pendingLabel={scoped.requesting} reason={model.requestReason} onClick={model.request} />
		</>
	)
	const reportDetails = (
		<MetricGrid>
			<MetricField label={copy.reportState}>{reportStatus}</MetricField>
			<MetricField label={copy.settleAt}>
				<TimestampValue timestamp={report?.eligibleAt} relative={false} />
			</MetricField>
			{report === undefined ? undefined : (
				<>
					<MetricField label={copy.reportBaseFee}>
						<CurrencyValue value={report.baseFeePerGas} suffix={copy.reportBaseFeeUnit} units={9} precision='exact' />
					</MetricField>
					<MetricField label={copy.reportBaseFeeCeiling}>
						<CurrencyValue value={report.maxSettlementBaseFee} suffix={copy.reportBaseFeeUnit} units={9} precision='exact' />
					</MetricField>
				</>
			)}
			<MetricField label={copy.sponsor}>
				<AddressValue longAbbreviation address={report?.sponsor} />
			</MetricField>
			<MetricField label={collateralCopy.released(model.collateral.symbol)}>
				<CurrencyValue value={report?.wethCredit} suffix={model.collateral.symbol} units={model.collateral.decimals} />
			</MetricField>
			<MetricField label={scoped.releasedRep}>
				<CurrencyValue value={report?.repCredit} suffix={common.rep} />
			</MetricField>
		</MetricGrid>
	)
	const settleActions = (
		<div className='actions'>
			<SecurityPoolButton model={parameters.actions} action={model.actionId('settle')} label={copy.settle} pendingLabel={copy.settling} reason={model.settleReason} onClick={model.settle} />
			<SecurityPoolButton model={parameters.actions} action={model.actionId('withdraw')} label={copy.returnFunds} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
		</div>
	)
	const olderReports = (
		<>
			<SecurityPoolInput label={copy.reportId} hint={copy.reportHint} value={model.reportInput} onChange={model.setReportId} disabled={disabled} />
			<UserMessage detail={copy.fundingReturnHint} />
			{model.canRedirectFunding ? <SecurityPoolInput label={copy.withdrawalRecipient} hint={copy.withdrawalRecipientHint} error={model.recipientError} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} /> : undefined}
			<div className='actions'>
				<SecurityPoolButton model={parameters.actions} action={model.actionId('recover')} label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
				<SecurityPoolButton model={parameters.actions} action={model.actionId('withdrawCollateral')} label={copy.withdrawToken(model.collateral.symbol)} pendingLabel={copy.withdrawingToken(model.collateral.symbol)} reason={model.withdrawCollateralReason} onClick={() => model.withdrawToken('collateral')} />
				<SecurityPoolButton model={parameters.actions} action={model.actionId('withdrawRep')} label={copy.withdrawToken(common.rep)} pendingLabel={copy.withdrawingToken(common.rep)} reason={model.withdrawRepReason} onClick={() => model.withdrawToken('rep')} />
				<ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: disabled || model.refreshReason !== undefined, reason: (disabled ? copy.busy : undefined) ?? model.refreshReason }} onClick={model.refresh} />
			</div>
			{openOracleHref !== undefined && (
				<a href={openOracleHref} target='_blank' rel='noreferrer'>
					{copy.openOracleReport}
				</a>
			)}
		</>
	)
	const notice = model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />
	if (redesigned)
		return (
			<div className='route-view-flow'>
				<SectionBlock title={copy.pricePage} badge={accepted === undefined ? undefined : <Badge tone={priceStatus === copy.priceCurrent ? 'ok' : 'muted'}>{priceStatus}</Badge>}>
					{notice}
					<div className='statoblast-price-summary'>
						{summary}
						{priceBand !== undefined && accepted !== undefined && priceBand.health > 0n && <PriceBand accepted={accepted} health={priceBand.health} liquidation={priceBand.liquidation} units={priceUnits} />}
					</div>
				</SectionBlock>
				<div className='statoblast-price-layout' data-funding={!returnFundsOnly}>
					{!returnFundsOnly && <SectionBlock title={copy.reportNewPrice}>{funding}</SectionBlock>}
					<aside aria-label={copy.currentReport}>
						<SectionBlock title={reportHeading}>
							<ol className='statoblast-price-progress'>
								<li data-done={report !== undefined}>{copy.reportedStep}</li>
								<li data-done={report?.state.settled || (report !== undefined && chainTime !== undefined && chainTime >= report.eligibleAt)}>{copy.disputeStep}</li>
								<li data-done={report?.state.settled}>{copy.settleStep}</li>
								<li data-done={report !== undefined && !fundsRemain}>{copy.fundsReturnedStep}</li>
							</ol>
							{reportDetails}
							{settleActions}
							<details open={returnFundsOnly || undefined}>
								<summary>{copy.olderReports}</summary>
								{olderReports}
							</details>
						</SectionBlock>
					</aside>
				</div>
			</div>
		)
	return (
		<WorkflowSubsection title={branch ? scoped.title : undefined}>
			<UserMessage detail={scoped.description} />
			{notice}
			{summary}
			{!returnFundsOnly && funding}
			{olderReports}
			{reportDetails}
			{settleActions}
		</WorkflowSubsection>
	)
}

function PriceBand({ accepted, health, liquidation, units }: { accepted: bigint; health: bigint; liquidation: bigint; units: number }) {
	const scaleStart = (liquidation * 9n) / 10n
	const scaleEnd = (health * 11n) / 10n
	const point = (value: bigint) => (getVisualRatio({ value: value - scaleStart, maxValue: scaleEnd - scaleStart }) ?? 0) * 100
	const lower = point(liquidation)
	return (
		<div className='statoblast-price-band'>
			<div className='statoblast-price-band-track' aria-hidden='true'>
				<span style={{ insetInlineStart: `${lower}%`, inlineSize: `${Math.max(0, point(health) - lower)}%` }} />
				<i style={{ insetInlineStart: `${point(accepted)}%` }} />
			</div>
			<dl>
				<div>
					<dt>{copy.liquidationsUse}</dt>
					<dd>
						<CurrencyValue value={liquidation} units={units} />
					</dd>
				</div>
				<div>
					<dt>{copy.acceptedStep}</dt>
					<dd>
						<CurrencyValue value={accepted} units={units} />
					</dd>
				</div>
				<div>
					<dt>{copy.healthUses}</dt>
					<dd>
						<CurrencyValue value={health} units={units} />
					</dd>
				</div>
			</dl>
		</div>
	)
}
