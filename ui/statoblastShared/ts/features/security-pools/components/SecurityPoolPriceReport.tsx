import { usePageVisible } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import * as collateralCopy from '../../../copy/collateral.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { formatDuration, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatOldDataCheck } from '@zoltar/ui-core-shared/copy/transaction.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { SecurityPoolButton, SecurityPoolInput } from './SecurityPoolControls.js'
import { useSecurityPoolPrice, type SecurityPoolPriceParameters } from '../hooks/useSecurityPoolPrice.js'
import { getSecurityPoolPriceWarning } from '../lib/priceWarning.js'
import * as copy from '../../../copy/securityPoolPrice.js'
import { deadlineChecking, followWithAutoRefresh } from '../../../copy/questionPage.js'
import { priceWindowEndedChecking, tryAgain } from '../../../copy/securityPoolPage.js'
import { deadlineRetryDelays } from '../../../lib/deadlineRefresh.js'
import { useStatoblastPageRefresh, type RegisterStatoblastPageRefresh, type ReportStatoblastReadStatus } from '../../useStatoblastPageRefresh.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function SecurityPoolPriceReport({
	returnFundsOnly = false,
	hideReportingDeadline = false,
	redesigned = false,
	priceWindowChecking = false,
	autoRefresh = false,
	registerPageRefresh,
	onReadStatus,
	priceBand,
	openOracleHref,
	onPriceAccepted,
	...parameters
}: SecurityPoolPriceParameters & {
	returnFundsOnly?: boolean
	hideReportingDeadline?: boolean
	redesigned?: boolean
	priceWindowChecking?: boolean
	autoRefresh?: boolean
	registerPageRefresh?: RegisterStatoblastPageRefresh | undefined
	onReadStatus?: ReportStatoblastReadStatus | undefined
	priceBand?: { accepted: bigint; health: bigint; liquidation: bigint; validUntil: bigint; timestamp: bigint; decimals: number; symbol?: string | undefined; readAt?: number | undefined } | undefined
	openOracleHref?: string | undefined
	onPriceAccepted?: ((universeId: bigint) => void) | undefined
}) {
	const model = useSecurityPoolPrice(parameters)
	useStatoblastPageRefresh(registerPageRefresh, model.refreshAndWait)
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
	const visible = usePageVisible()
	const [wallTime, setWallTime] = useState(Date.now)
	useEffect(() => {
		if (!visible) return
		setWallTime(Date.now())
		const timer = setInterval(() => setWallTime(Date.now()), 1_000)
		return () => clearInterval(timer)
	}, [visible])
	const chainTime = model.snapshot?.timestamp ?? model.savedReportTimestamp ?? priceBand?.timestamp
	const chainReadAt = model.snapshotReadAt ?? model.savedReportAt ?? priceBand?.readAt
	const now = chainTime === undefined ? undefined : chainTime + elapsedSeconds(wallTime, chainReadAt)
	const accepted = observation !== undefined && observation.lastSettlementTimestamp !== 0n ? observation.lastPrice : priceBand?.accepted
	const priceUnits = 36 - (priceBand?.decimals ?? model.collateral.decimals)
	const healthPrice = priceBand?.health
	const deviation = accepted === undefined || healthPrice === undefined || healthPrice < accepted || healthPrice === 0n ? undefined : ((healthPrice - accepted) * 10_000n + healthPrice / 2n) / healthPrice
	const priceWarning = getSecurityPoolPriceWarning(model.proposedPrice, model.comparisonPrice, model.collateral)
	let reportStatus: string | undefined
	if (report !== undefined) {
		reportStatus = copy.states.pending
		const reportTimestamp = model.savedReportTimestamp ?? model.snapshot?.timestamp
		if (reportTimestamp !== undefined && reportTimestamp >= report.eligibleAt) reportStatus = copy.states.settle
		if (report.state.settled) reportStatus = copy.states.recovery
		if (report.outcome === 1n) reportStatus = copy.states.accepted
		if (report.outcome === 2n) reportStatus = copy.states.rejected
	}
	const expiresAt = observation === undefined || observation.lastSettlementTimestamp === 0n ? priceBand?.validUntil : observation.lastSettlementTimestamp + observation.validitySeconds
	const priceIsCurrent = expiresAt !== undefined && now !== undefined && now < expiresAt
	const confirmedPriceStatus = priceIsCurrent ? copy.priceCurrent : copy.priceDue
	const priceStatus = priceWindowChecking ? priceWindowEndedChecking : confirmedPriceStatus
	const reportHeading = report === undefined ? copy.currentReport : copy.reportHeading(report.reportId)
	const settlementReady = reportStatus === copy.states.settle
	const disputeIdentity = redesigned && reportStatus === copy.states.pending && report !== undefined ? `${model.draftKey}:${report.reportId}:${report.eligibleAt}` : undefined
	const disputeCheck = useDisputeDeadlineCheck(disputeIdentity, now !== undefined && report !== undefined && now >= report.eligibleAt, !visible || model.loading || model.reportLoading, model.refresh)
	const disputeChecking = disputeCheck.checking
	const acceptedPriceAge = elapsedSeconds(wallTime, observation !== undefined ? model.snapshotReadAt : priceBand?.readAt)
	const reportAge = elapsedSeconds(wallTime, model.reportReadAt)
	const priceReadAt = model.snapshotReadAt ?? priceBand?.readAt
	const displayedAt = model.reportReadAt === undefined || priceReadAt === undefined ? (model.reportReadAt ?? priceReadAt) : Math.min(priceReadAt, model.reportReadAt)
	useEffect(() => onReadStatus?.(displayedAt, undefined), [displayedAt, onReadStatus])
	const recoveryComplete = report?.outcome === 1n || report?.outcome === 2n
	const fundsReturned = report !== undefined && !fundsRemain
	const wethApproved = model.funding !== undefined && observation !== undefined && observation.wethAllowanceAttoEth >= model.funding.weth
	const repApproved = model.funding !== undefined && observation !== undefined && observation.repAllowanceAttoRep >= model.funding.rep
	const showWrap = model.collateral.symbol === collateralCopy.weth
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
			<MetricField label={copy.currentPrice(model.collateral.symbol)} loading={model.loading}>
				<CurrencyValue value={accepted} units={priceUnits} />
			</MetricField>
			<MetricField label={copy.validUntil} loading={model.loading}>
				<TimestampValue timestamp={expiresAt} relative={now === undefined ? false : 'after'} {...(now === undefined ? {} : { currentTimestamp: now })} />
			</MetricField>
			{deviation !== undefined && <MetricField label={copy.deviation}>{copy.formatDeviation(formatUnits(deviation, 2))}</MetricField>}
		</MetricGrid>
	)
	const prepare = <SecurityPoolButton model={parameters.actions} action={model.actionId('prepare')} label={redesigned && model.prepareReason === scoped.prepared ? copy.preparedStep : copy.prepare} pendingLabel={copy.preparing} reason={model.prepareReason} onClick={model.prepare} />
	const wrap = <SecurityPoolButton model={parameters.actions} action={model.actionId('wrap')} label={copy.wrap} pendingLabel={copy.wrapping} reason={model.wrapReason} onClick={model.wrap} />
	const reportPrice = <SecurityPoolButton model={parameters.actions} action={model.actionId('request')} label={scoped.request} pendingLabel={scoped.requesting} reason={model.requestReason} onClick={model.request} />
	const priceField = (
		<div className='initial-price-input'>
			<SecurityPoolInput
				label={(redesigned ? copy.priceDraftLabel : copy.price)(model.collateral.symbol)}
				value={model.priceInput}
				onChange={model.setPrice}
				disabled={disabled}
				numeric
				describedBy={priceWarning === undefined ? undefined : priceWarningId}
				hint={redesigned && model.comparisonPrice !== undefined ? (branch && !observation?.lastSettlementTimestamp ? copy.branchReferencePrice : copy.referencePrice)(formatRoundedCurrencyBalance(model.comparisonPrice, priceUnits)) : undefined}
			/>
			<div aria-live='polite' className='field-error-live-region'>
				{priceWarning === undefined ? undefined : <UserMessage id={priceWarningId} placement='field' tone='warning' detail={priceWarning} />}
			</div>
		</div>
	)
	const minimumStake = model.minimumWethAttoEth ?? observation?.minimumWethAttoEth
	let stakeHint = copy.wethHint
	if (minimumStake !== undefined) {
		const minimum = formatRoundedCurrencyBalance(minimumStake, model.collateral.decimals, 4, 'up')
		stakeHint = model.funding !== undefined && model.wethInput.trim() === '' ? copy.suggestedStake(minimum, formatRoundedCurrencyBalance(model.funding.weth, model.collateral.decimals, 4, 'up'), model.collateral.symbol) : copy.minimumStake(minimum, model.collateral.symbol)
	}
	const stakeField = <SecurityPoolInput label={collateralCopy.reportStake(model.collateral.symbol)} hint={redesigned ? stakeHint : copy.wethHint} value={model.wethInput} onChange={model.setWeth} disabled={disabled} numeric />
	const wethApproval = (
		<TokenApprovalControl
			compact={redesigned}
			customAmountDisclosureLabel={redesigned ? copy.adjustAmount : undefined}
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
	)
	const repApproval = (
		<TokenApprovalControl
			compact={redesigned}
			customAmountDisclosureLabel={redesigned ? copy.adjustAmount : undefined}
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
	)
	const funding = (
		<>
			{branch ? prepare : undefined}
			<MetricGrid>
				{priceField}
				{stakeField}
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
				<MetricField label={copy.extraCoverage}>
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
			{showWrap ? wrap : undefined}
			{wethApproval}
			{repApproval}
			<UserMessage tone='warning' detail={scoped.requestWarning} />
			<UserMessage detail={copy.coverageWarning} />
			{reportPrice}
		</>
	)
	const reportDetails = (
		<>
			{model.savedReportAt !== undefined && (
				<p className='detail'>
					{copy.savedReport} <UpdatedAgo updatedAt={model.savedReportAt} />
				</p>
			)}
			<MetricGrid>
				{!redesigned && <MetricField label={copy.reportState}>{reportStatus}</MetricField>}
				{!redesigned && (
					<MetricField label={copy.settleAt}>
						<TimestampValue timestamp={report?.eligibleAt} relative={false} />
					</MetricField>
				)}
				{report === undefined || redesigned ? undefined : (
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
		</>
	)
	const settleReport = <SecurityPoolButton model={parameters.actions} action={model.actionId('settle')} label={copy.settle} pendingLabel={copy.settling} reason={model.settleReason} onClick={model.settle} />
	const recoverReport = <SecurityPoolButton model={parameters.actions} action={model.actionId('recover')} label={copy.recover} pendingLabel={copy.recovering} reason={model.recoverReason} onClick={model.recover} />
	const returnFunds = <SecurityPoolButton model={parameters.actions} action={model.actionId('withdraw')} label={copy.returnFunds} pendingLabel={copy.withdrawing} reason={model.withdrawReason} onClick={model.withdraw} />
	const settleActions = (
		<div className='actions'>
			{settleReport}
			{recoverReport}
			{returnFunds}
		</div>
	)
	const olderReports = (
		<>
			<SecurityPoolInput label={copy.reportId} hint={redesigned ? copy.latestReportHint : copy.reportHint} value={model.reportInput} onChange={model.setReportId} disabled={disabled} />
			{!redesigned && <UserMessage detail={copy.fundingReturnHint} />}
			{model.canRedirectFunding ? <SecurityPoolInput label={copy.withdrawalRecipient} hint={copy.withdrawalRecipientHint} error={model.recipientError} value={model.recipientInput} onChange={model.setRecipient} disabled={disabled} /> : undefined}
			<div className='actions'>
				<SecurityPoolButton model={parameters.actions} action={model.actionId('withdrawCollateral')} label={copy.withdrawToken(model.collateral.symbol)} pendingLabel={copy.withdrawingToken(model.collateral.symbol)} reason={model.withdrawCollateralReason} onClick={() => model.withdrawToken('collateral')} />
				<SecurityPoolButton model={parameters.actions} action={model.actionId('withdrawRep')} label={copy.withdrawToken(common.rep)} pendingLabel={copy.withdrawingToken(common.rep)} reason={model.withdrawRepReason} onClick={() => model.withdrawToken('rep')} />
				{!redesigned && <ActionLauncherButton tone='secondary' idleLabel={copy.refresh} pendingLabel={copy.refreshing} availability={{ disabled: disabled || model.refreshReason !== undefined, reason: (disabled ? copy.busy : undefined) ?? model.refreshReason }} onClick={model.refresh} />}
			</div>
			{openOracleHref !== undefined && (
				<a href={openOracleHref} target='_blank' rel='noreferrer'>
					{copy.openOracleReport}
				</a>
			)}
		</>
	)
	const notice = model.error === undefined ? undefined : <UserMessage tone='error' detail={model.error} />
	const fundingSteps = (
		<ol className='statoblast-price-actions'>
			{showWrap && (
				<PriceActionStep title={copy.wrapStep} complete={model.wrapReason === copy.noWrap}>
					<MetricGrid>
						<MetricField label={copy.wrapAmount}>
							<CurrencyValue value={model.funding?.wrap} suffix={common.eth} />
						</MetricField>
						<MetricField label={collateralCopy.walletBalance(model.collateral.symbol)} loading={model.loading}>
							<CurrencyValue value={observation?.wethBalanceAttoEth} suffix={model.collateral.symbol} units={model.collateral.decimals} />
						</MetricField>
					</MetricGrid>
					{wrap}
				</PriceActionStep>
			)}
			<PriceActionStep title={copy.approveStep(model.collateral.symbol)} complete={wethApproved}>
				{wethApproval}
			</PriceActionStep>
			<PriceActionStep title={copy.approveStep(common.rep)} complete={repApproved}>
				{repApproval}
			</PriceActionStep>
			<PriceActionStep title={scoped.request}>{reportPrice}</PriceActionStep>
		</ol>
	)
	const recoverySteps = (
		<ol className='statoblast-price-actions'>
			<PriceActionStep title={report === undefined ? copy.settleStep : copy.settleReportStep(report.reportId)} complete={report?.state.settled} detail={report?.bounty === undefined || report.state.settled ? undefined : copy.settleEarns(<CurrencyValue value={report.bounty} suffix={common.eth} />)}>
				{settleReport}
			</PriceActionStep>
			<PriceActionStep title={copy.recoverStep} complete={recoveryComplete}>
				{recoverReport}
			</PriceActionStep>
			<PriceActionStep title={copy.returnFunds} complete={fundsReturned}>
				{returnFunds}
			</PriceActionStep>
		</ol>
	)
	const priceSummary = (
		<MetricGrid>
			<MetricField label={copy.acceptedPrice} loading={accepted === undefined && model.loading}>
				<span className='statoblast-price-accepted-value'>
					<CurrencyValue value={accepted} units={priceUnits} />
					<span className='detail'>
						{[copy.priceUnits(priceBand?.symbol ?? model.collateral.symbol), model.acceptedReportId === undefined ? undefined : copy.reportHeading(model.acceptedReportId), deviation === undefined ? undefined : copy.deviationLabel(formatUnits(deviation, 2))].filter(item => item !== undefined).join(' · ')}
					</span>
				</span>
			</MetricField>
			<MetricField label={copy.validUntil} loading={expiresAt === undefined && model.loading}>
				<TimestampValue timestamp={expiresAt} relative={now === undefined ? false : 'first'} {...(now === undefined ? {} : { currentTimestamp: now })} />
			</MetricField>
		</MetricGrid>
	)
	const compactFunding = (
		<>
			{branch && (
				<ol className='statoblast-price-actions'>
					<PriceActionStep title={copy.prepare} complete={model.prepareReason === scoped.prepared}>
						{prepare}
					</PriceActionStep>
				</ol>
			)}
			<MetricGrid>
				{priceField}
				{stakeField}
			</MetricGrid>
			<PriceCoverage exposure={observation?.currentExposureAttoEth} coverage={model.funding?.coveredExposureAttoEth} headroom={model.funding?.growthHeadroomAttoEth} collateral={model.collateral} />
			<dl className='statoblast-price-bounty'>
				<dt>{copy.bountyPaidByYou}</dt>
				<dd>
					<CurrencyValue value={model.funding?.bounty ?? observation?.nextBlockBounty} suffix={common.eth} />
				</dd>
			</dl>
			<UserMessage tone='warning' detail={copy.disputeTip} />
			<details>
				<summary>{copy.howReportWorks}</summary>
				<p className='detail'>{copy.coverageTip}</p>
			</details>
			{fundingSteps}
		</>
	)
	const reportSection = branch ? ({ variant: 'embedded', headingLevel: 4 } as const) : undefined
	if (redesigned)
		return (
			<div className='route-view-flow'>
				<SectionBlock {...reportSection} title={copy.pricePage} description={acceptedPriceAge > 60n ? copy.asOf(formatDuration(acceptedPriceAge)) : undefined} badge={accepted === undefined ? undefined : <Badge tone={priceStatus === copy.priceCurrent ? 'ok' : 'muted'}>{priceStatus}</Badge>}>
					{notice}
					<div className='statoblast-price-summary'>
						{branch ? summary : priceSummary}
						{priceBand !== undefined && accepted !== undefined && priceBand.health > 0n && <PriceBand accepted={accepted} health={priceBand.health} liquidation={priceBand.liquidation} units={priceUnits} />}
					</div>
				</SectionBlock>
				<div className='statoblast-price-layout' data-funding={!branch && !returnFundsOnly}>
					{!returnFundsOnly && (
						<SectionBlock {...reportSection} title={copy.reportNewPrice} description={acceptedPriceAge > 60n ? formatOldDataCheck(formatDuration(acceptedPriceAge)) : undefined}>
							{compactFunding}
						</SectionBlock>
					)}
					<aside aria-label={copy.currentReport}>
						<SectionBlock
							{...reportSection}
							title={reportHeading}
							description={reportAge > 60n ? copy.asOf(formatDuration(reportAge)) : undefined}
							badge={reportStatus === undefined ? undefined : <Badge tone={settlementReady || reportStatus === copy.states.accepted ? 'ok' : 'muted'}>{disputeChecking ? deadlineChecking : reportStatus}</Badge>}
						>
							<ol className='statoblast-price-progress'>
								<li data-done={report !== undefined}>
									{copy.reportedStep}
									<TimestampValue className='detail' timestamp={report?.reportedAt} relative={false} />
								</li>
								<li data-done={report?.state.settled || settlementReady}>
									{copy.disputeStep}
									<TimestampValue className='detail' timestamp={report?.eligibleAt} relative={false} />
								</li>
								<li data-done={report?.state.settled} aria-current={settlementReady ? 'step' : undefined}>
									{copy.settleStep}
									{settlementReady && <span className='detail'>{copy.now}</span>}
								</li>
								<li data-done={fundsReturned}>
									{copy.fundsReturnedStep}
									<span className='detail'>{copy.fundsRecipient}</span>
								</li>
							</ol>
							{disputeCheck.failed && (
								<button type='button' className='secondary' onClick={disputeCheck.retry}>
									{tryAgain}
								</button>
							)}
							{!autoRefresh && reportStatus === copy.states.pending && !disputeChecking && <p className='detail'>{followWithAutoRefresh}</p>}
							{reportDetails}
							{reportAge > 60n && <p className='detail'>{formatOldDataCheck(formatDuration(reportAge))}</p>}
							{recoverySteps}
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

function elapsedSeconds(now: number, readAt: number | undefined) {
	return readAt === undefined ? 0n : BigInt(Math.max(0, Math.floor((now - readAt) / 1000)))
}

function useDisputeDeadlineCheck(identity: string | undefined, deadlinePassed: boolean, reading: boolean, refresh: () => void) {
	const [state, setState] = useState<{ ended: string; attempts: number }>()
	const ended = deadlinePassed || state?.ended === identity ? identity : undefined
	const attempts = state?.ended === ended ? (state?.attempts ?? 0) : 0
	const currentRefresh = useRef(refresh)
	currentRefresh.current = refresh
	useEffect(() => {
		const delay = deadlineRetryDelays[attempts]
		if (ended === undefined || reading || delay === undefined) return
		const timer = setTimeout(() => {
			setState({ ended, attempts: attempts + 1 })
			currentRefresh.current()
		}, delay)
		return () => clearTimeout(timer)
	}, [ended, reading, attempts])
	return {
		checking: ended !== undefined,
		failed: ended !== undefined && !reading && attempts >= deadlineRetryDelays.length,
		retry: () => {
			if (ended !== undefined) setState({ ended, attempts: 0 })
		},
	}
}

function PriceActionStep({ title, complete, detail, children }: { title: string; complete?: boolean | undefined; detail?: ComponentChildren; children: ComponentChildren }) {
	return (
		<li data-complete={complete === true}>
			<div className='statoblast-price-action-heading'>
				{complete && (
					<span className='statoblast-step-done' aria-label={copy.stepComplete}>
						✓
					</span>
				)}
				<strong>{title}</strong>
			</div>
			{detail !== undefined && <p className='detail'>{detail}</p>}
			{children}
		</li>
	)
}

function PriceCoverage({ exposure, coverage, headroom, collateral }: { exposure: bigint | undefined; coverage: bigint | undefined; headroom: bigint | undefined; collateral: { decimals: number; symbol: string } }) {
	const used = getVisualRatio({ value: exposure, maxValue: coverage })
	return (
		<div className='statoblast-price-coverage'>
			<dl>
				<dt>{copy.coverLabel}</dt>
				<dd>
					<CurrencyValue value={coverage} units={collateral.decimals} suffix={collateral.symbol} />
				</dd>
			</dl>
			{used !== undefined && (
				<div className='statoblast-price-coverage-track' aria-hidden='true'>
					<span style={{ inlineSize: `${used * 100}%` }} />
				</div>
			)}
			<MetricGrid>
				<MetricField label={copy.exposureNow}>
					<CurrencyValue value={exposure} units={collateral.decimals} suffix={collateral.symbol} />
				</MetricField>
				<MetricField label={copy.extraCoverage}>
					<CurrencyValue value={headroom} units={collateral.decimals} suffix={collateral.symbol} />
				</MetricField>
			</MetricGrid>
		</div>
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
				<i className='statoblast-price-liquidation-pin' style={{ insetInlineStart: `${lower}%` }} />
				<i style={{ insetInlineStart: `${point(accepted)}%` }} />
				<i className='statoblast-price-health-pin' style={{ insetInlineStart: `${point(health)}%` }} />
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
