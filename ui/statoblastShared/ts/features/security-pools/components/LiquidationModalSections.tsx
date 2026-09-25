import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AddressInfo } from '@zoltar/ui-core-shared/components/AddressInfo.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { TransactionStatusCard } from '@zoltar/ui-core-shared/components/TransactionStatusCard.js'
import { getLiquidationExecutionFailureDetail, type simulateLiquidation } from '../lib/liquidation.js'
import { formatHealthFactorBps, getApprovalStatus, type LiquidationExecutionMode, type QueuedLiquidationOperationView, type QueuedLiquidationStatus } from '../lib/liquidationModalGuards.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type UiRepPriceSource } from '../lib/repPriceSource.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'

export function QueuedLiquidationStatusCard({
	onViewInStagedOperations,
	queuedLiquidationOperation,
	queuedLiquidationStatus,
	securityPoolOverviewResult,
}: {
	onViewInStagedOperations: () => void
	queuedLiquidationOperation: QueuedLiquidationOperationView | undefined
	queuedLiquidationStatus: QueuedLiquidationStatus | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}) {
	if (queuedLiquidationStatus === undefined) return null
	if (queuedLiquidationStatus === 'queued' || queuedLiquidationStatus === 'manual-queued') {
		if (queuedLiquidationOperation === undefined) return null
		return (
			<TransactionStatusCard
				surface='flat'
				title={liquidationCopy.liquidationQueued}
				badge={<Badge tone='warning'>{liquidationCopy.queued}</Badge>}
				metrics={
					<MetricGrid>
						<MetricField label={commonCopy.stagedOperation}>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						{queuedLiquidationOperation.amount === undefined ? null : (
							<MetricField label={liquidationCopy.requestedLiquidationDebt}>
								<CurrencyValue precision='exact' value={queuedLiquidationOperation.amount} suffix={commonCopy.eth} />
							</MetricField>
						)}
					</MetricGrid>
				}
				detail={queuedLiquidationStatus === 'manual-queued' ? commonCopy.manualQueuedOperationDetail : undefined}
				actions={
					<button className='secondary' type='button' onClick={onViewInStagedOperations}>
						{commonCopy.viewInStagedOperations}
					</button>
				}
			/>
		)
	}
	if (queuedLiquidationStatus === 'failed')
		return (
			<TransactionStatusCard
				surface='flat'
				title={commonCopy.liquidationFailed}
				badge={<Badge tone='blocked'>{commonCopy.failed}</Badge>}
				detail={getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? liquidationCopy.immediateLiquidationRejectedDetail}
				secondaryDetail={commonCopy.stagedOperationRetryDetail}
			/>
		)
	if (queuedLiquidationStatus === 'executed') return <TransactionStatusCard surface='flat' title={commonCopy.liquidationExecuted} badge={<Badge tone='ok'>{commonCopy.executed}</Badge>} detail={liquidationCopy.immediateLiquidationSuccessDetail} />
	if (queuedLiquidationStatus === 'missing') return <TransactionStatusCard surface='flat' title={commonCopy.liquidationSubmitted} badge={<Badge tone='warning'>{liquidationCopy.checkState}</Badge>} detail={commonCopy.transactionStateUnavailableDetail} />
	return <TransactionStatusCard surface='flat' title={liquidationCopy.refreshingLiquidationStateTitle} badge={<Badge tone='muted'>{commonCopy.refreshingWithoutEllipsis}</Badge>} detail={liquidationCopy.refreshingLiquidationState} />
}

export function LiquidationContextSummary({
	accountAddress,
	currentPoolOracleManagerDetails,
	currentTimestamp,
	liquidationSecurityPoolAddress,
	poolOraclePrice,
	poolOracleSettlementTimestamp,
	receiverVaultSummary,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	selectedPool,
	targetVaultSummary,
	trimmedLiquidationReceiverVault,
	trimmedLiquidationTargetVault,
}: {
	accountAddress: Address | undefined
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentTimestamp: bigint | undefined
	liquidationSecurityPoolAddress: Address | undefined
	poolOraclePrice: bigint | undefined
	poolOracleSettlementTimestamp: bigint
	receiverVaultSummary: SecurityPoolVaultSummary | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: UiRepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	selectedPool: ListedSecurityPool | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	trimmedLiquidationReceiverVault: string
	trimmedLiquidationTargetVault: string
}) {
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)
	return (
		<div className='decision-summary'>
			<div className='exchange-preview'>
				<div className='liquidation-party'>
					<p className='detail'>{commonCopy.targetVault}</p>
					<div className='decision-heading'>{trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationTargetVault} />}</div>
				</div>
				<span className='exchange-arrow' aria-hidden='true'>
					→
				</span>
				<div className='liquidation-party'>
					<p className='detail'>{liquidationCopy.receiverVault}</p>
					<div className='decision-heading'>{trimmedLiquidationReceiverVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationReceiverVault} />}</div>
				</div>
			</div>
			<MetricField label={statoblastAppCopy.openOraclePrice} valueTagName='span'>
				<OpenOraclePriceValue
					currentTimestamp={currentTimestamp}
					lastPrice={poolOraclePrice}
					lastSettlementTimestamp={poolOracleSettlementTimestamp}
					pendingReportReadyAtTimestamp={currentPoolOracleManagerDetails?.pendingReportReadyAtTimestamp}
					priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
				/>
			</MetricField>
			<ReadOnlyDetailAccordion title={liquidationCopy.vaultContextDetails}>
				<DataGrid>
					<AddressInfo address={liquidationSecurityPoolAddress} label={liquidationCopy.securityPool} />
					<MetricField label={statoblastAppCopy.statoblastSecurityMultiplierBps}>{selectedPool?.statoblastSecurityMultiplierBps === undefined ? commonCopy.unavailable : `${formatStatoblastSecurityMultiplier(selectedPool.statoblastSecurityMultiplierBps)}${liquidationCopy.multiplierSuffix}`}</MetricField>
					<MetricField label={liquidationCopy.operator}>{accountAddress === undefined ? commonCopy.connectWallet : <AddressValue address={accountAddress} />}</MetricField>

					<MetricField label={liquidationCopy.targetCapacityOwnershipAttoRep}>
						<CurrencyValue value={targetVaultSummary?.capacityOwnershipAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.targetVaultRepBackingAttoRep}>
						<CurrencyValue value={targetVaultSummary?.vaultAttoRepBacking} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.targetDisputeStakedAttoRep}>
						<CurrencyValue value={targetVaultSummary?.disputeStakedAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? commonCopy.unavailable : <CurrencyValue value={repPerEthPrice} suffix={commonCopy.repPerEth} copyable={false} />}
						<RepPriceStatusLabel />
					</MetricField>
					<MetricField label={liquidationCopy.callerCapacityOwnershipAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.capacityOwnershipAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.callerVaultRepBackingAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.vaultAttoRepBacking} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.callerDisputeStakedAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.disputeStakedAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
			</ReadOnlyDetailAccordion>
		</div>
	)
}

export function LiquidationApprovalSummary({ approvalNonceInvalidated, currentTimestamp, liquidationApprovalDetails }: { approvalNonceInvalidated: boolean; currentTimestamp: bigint | undefined; liquidationApprovalDetails: LiquidationApprovalDetails }) {
	return (
		<div className='decision-summary'>
			<p className='detail'>{liquidationCopy.availableApproval}</p>
			<p className='decision-amount'>
				<CurrencyValue exactWhenRoundedToZero value={liquidationApprovalDetails.availableDebtAttoEth} suffix={commonCopy.eth} />
			</p>
			<div className='liquidation-constraints'>
				<MetricField label={liquidationCopy.perLiquidationLimit}>
					<CurrencyValue exactWhenRoundedToZero value={liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth} suffix={commonCopy.eth} />
				</MetricField>
				<MetricField label={liquidationCopy.totalApprovalLimit}>
					<CurrencyValue exactWhenRoundedToZero value={liquidationApprovalDetails.params.maxCumulativeDebtAttoEth} suffix={commonCopy.eth} />
				</MetricField>
				<MetricField label={liquidationCopy.approvalValidAfter}>
					<TimestampValue timestamp={liquidationApprovalDetails.params.validAfter} />
				</MetricField>
				<MetricField label={liquidationCopy.approvalExpiration}>
					<TimestampValue timestamp={liquidationApprovalDetails.params.validUntil} />
				</MetricField>
				<MetricField label={liquidationCopy.minimumPostLiquidationHealth}>{formatHealthFactorBps(liquidationApprovalDetails.params.minPostLiquidationHealthFactorBps)}</MetricField>
				<MetricField label={liquidationCopy.approvalStatus}>{getApprovalStatus(liquidationApprovalDetails.revoked, approvalNonceInvalidated, liquidationApprovalDetails.params.validAfter, liquidationApprovalDetails.params.validUntil, currentTimestamp)}</MetricField>
			</div>
			<ReadOnlyDetailAccordion title={liquidationCopy.approvalUsageDetails}>
				<MetricField label={liquidationCopy.reservedApproval}>
					<CurrencyValue exactWhenRoundedToZero value={liquidationApprovalDetails.reservedDebtAttoEth} suffix={commonCopy.eth} />
				</MetricField>
				<MetricField label={liquidationCopy.consumedApproval}>
					<CurrencyValue exactWhenRoundedToZero value={liquidationApprovalDetails.consumedDebtAttoEth} suffix={commonCopy.eth} />
				</MetricField>
			</ReadOnlyDetailAccordion>
		</div>
	)
}

export function LiquidationTransactionReview({
	receiverHealthy,
	liquidationExecutionMode,
	liquidationFundingPreview,
	liquidationSimulation,
	selectedPool,
	walletBalanceAttoEth,
}: {
	receiverHealthy: boolean | undefined
	liquidationExecutionMode: LiquidationExecutionMode
	liquidationFundingPreview: LiquidationFundingPreview | undefined
	liquidationSimulation: ReturnType<typeof simulateLiquidation> | undefined
	selectedPool: ListedSecurityPool | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	return (
		<TransactionReview
			context={[{ label: commonCopy.question, value: selectedPool?.marketDetails.title ?? commonCopy.unavailable }]}
			className='liquidation-outcome-review'
			primary={[
				{ label: liquidationCopy.securityBondDebtMoved, value: <CurrencyValue exactWhenRoundedToZero value={liquidationSimulation?.debtMovedAttoEth} suffix={commonCopy.eth} /> },
				{ label: liquidationCopy.repMoved, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.vaultAttoRepBackingToTransfer} suffix={commonCopy.rep} /> },
				{ label: liquidationCopy.estimatedReceiverHealth, value: receiverHealthy === undefined ? commonCopy.unavailable : <Badge tone={receiverHealthy ? 'ok' : 'blocked'}>{receiverHealthy ? liquidationCopy.meetsRequiredHealth : liquidationCopy.belowRequiredHealth}</Badge> },
			]}
			details={[
				...(liquidationSimulation !== undefined && liquidationSimulation.badDebtAttoEth > 0n ? [{ label: liquidationCopy.residualBadDebt, value: <CurrencyValue exactWhenRoundedToZero value={liquidationSimulation.badDebtAttoEth} suffix={commonCopy.eth} /> }] : []),
				...(liquidationExecutionMode === 'queue' ? [{ label: liquidationCopy.totalWalletEthRequiredAttoEth, value: <CurrencyValue exactWhenRoundedToZero value={liquidationFundingPreview?.totalWalletEthRequiredAttoEth} suffix={commonCopy.eth} /> }] : []),
			]}
			disclosures={[
				{
					title: liquidationCopy.accountingDetails,
					rows: [
						{ label: liquidationCopy.capacityOwnershipMoved, value: <CurrencyValue value={liquidationSimulation?.capacityOwnershipMovedAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.grossRepAwardAttoRep, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.grossRepAwardAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.targetAccruedFeesRetained, value: <CurrencyValue compactWhenOverflow exactWhenRoundedToZero value={liquidationSimulation?.targetAccruedFeesRetained} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.resultingCallerRep, value: <CurrencyValue value={liquidationSimulation?.callerAfter.vaultAttoRepBacking} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.resultingReceiverCapacityOwnership, value: <CurrencyValue value={liquidationSimulation?.callerAfter.capacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
					],
				},
				...(liquidationExecutionMode === 'queue'
					? [
							{
								title: liquidationCopy.fundingDetails,
								rows: [
									{ label: liquidationCopy.bufferedQueueCost, value: <CurrencyValue exactWhenRoundedToZero value={liquidationFundingPreview?.queueOperationValueAttoEth} suffix={commonCopy.eth} /> },
									{ label: liquidationCopy.ethWrappedToWeth, value: <CurrencyValue exactWhenRoundedToZero value={liquidationFundingPreview?.wethShortfallAttoEth} suffix={commonCopy.eth} /> },
									{ label: liquidationCopy.repLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportRepRequiredAttoRep} suffix={commonCopy.rep} /> },
									{ label: liquidationCopy.wethLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportWethRequiredAttoEth} suffix={commonCopy.weth} /> },
									{
										label: liquidationCopy.resultingWalletEth,
										value: (
											<CurrencyValue
												value={liquidationFundingPreview === undefined || walletBalanceAttoEth === undefined || liquidationFundingPreview.totalWalletEthRequiredAttoEth > walletBalanceAttoEth ? undefined : walletBalanceAttoEth - liquidationFundingPreview.totalWalletEthRequiredAttoEth}
												suffix={commonCopy.eth}
											/>
										),
									},
									{
										label: liquidationCopy.resultingWalletRep,
										value: (
											<CurrencyValue
												value={liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportRepRequiredAttoRep > liquidationFundingPreview.currentRepBalanceAttoRep ? undefined : liquidationFundingPreview.currentRepBalanceAttoRep - liquidationFundingPreview.initialReportRepRequiredAttoRep}
												suffix={commonCopy.rep}
											/>
										),
									},
									{
										label: liquidationCopy.resultingWalletWeth,
										value: (
											<CurrencyValue
												value={
													liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportWethRequiredAttoEth > liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth
														? undefined
														: liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth - liquidationFundingPreview.initialReportWethRequiredAttoEth
												}
												suffix={commonCopy.weth}
											/>
										),
									},
								],
							},
						]
					: []),
			]}
			risks={[liquidationCopy.liquidationStateRisk, ...(liquidationExecutionMode === 'queue' ? [liquidationCopy.queuedLiquidationRisk, liquidationCopy.queuedFundingSequenceRisk] : [])]}
		/>
	)
}
