import type { Address } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import type { OracleManagerDetails, StagedOracleOperation } from '@zoltar/ui-core-shared/types/contracts.js'
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getPendingOperationAmountPresentation, getPendingOperationLabel, getStagedOperationExecutionModeLabel } from './SecurityPoolWorkflowPresentation.js'

export type RequestPriceReview = {
	requestValueAttoEth: bigint
	managerAddress: Address
	questionTitle: string | undefined
	securityPoolAddress: Address
	universeId: bigint
}

function getStagedOperationsRefreshLabel({ loadingManager, managerError, managerLoaded }: { loadingManager: boolean; managerError: string | undefined; managerLoaded: boolean }) {
	if (!managerLoaded && managerError === undefined) return <LoadingText>{securityPoolCopy.loadingStagedOperations}</LoadingText>
	if (!managerLoaded) return securityPoolCopy.retryStagedOperations
	if (loadingManager) return <LoadingText>{securityPoolCopy.refreshingOperations}</LoadingText>
	return securityPoolCopy.refreshStagedOperations
}

export function SecurityPoolRequestPriceModal({
	canRequest,
	closeOnSuccessKey,
	confirmationGuardMessage,
	onClose,
	onConfirm,
	pending,
	review,
}: {
	canRequest: boolean
	closeOnSuccessKey: string | undefined
	confirmationGuardMessage: string | undefined
	onClose: () => void
	onConfirm: (review: RequestPriceReview) => void
	pending: boolean
	review: RequestPriceReview | undefined
}) {
	return (
		<OperationModal
			closeOnSuccessKey={closeOnSuccessKey}
			context={
				review === undefined
					? []
					: [...(review.questionTitle === undefined ? [] : [{ label: commonCopy.question, value: review.questionTitle }]), { label: commonCopy.securityPoolAddress, value: <AddressValue address={review.securityPoolAddress} /> }, { label: transactionReviewCopy.network, value: <TransactionNetworkValue /> }]
			}
			description={securityPoolCopy.requestPriceReviewDescription}
			isOpen={review !== undefined}
			onClose={onClose}
			title={securityPoolCopy.requestNewPriceTitle}
		>
			<TransactionReview primary={[{ label: transactionReviewCopy.youPay, value: <CurrencyValue precision='exact' value={review?.requestValueAttoEth} suffix={commonCopy.eth} /> }]} risks={[securityPoolCopy.requestPricePendingReportRisk, securityPoolCopy.requestPriceFundingRisk]} />
			<div className='actions'>
				<button className='secondary' type='button' onClick={onClose} disabled={pending}>
					{commonCopy.cancel}
				</button>
				<TransactionActionButton
					idleLabel={securityPoolCopy.confirmPriceRequest}
					pendingLabel={securityPoolCopy.requestingNewPrice}
					onClick={() => {
						if (review !== undefined) onConfirm(review)
					}}
					pending={pending}
					availability={{ disabled: review === undefined || !canRequest || confirmationGuardMessage !== undefined, reason: canRequest ? confirmationGuardMessage : undefined }}
				/>
			</div>
		</OperationModal>
	)
}

export function SecurityPoolStagedOperationsSection({
	activeOperationCount,
	canExecute,
	executeGuardMessage,
	executionPending,
	loadingManager,
	managerAddress,
	managerDetails,
	managerError,
	manualOperationId,
	onExecute,
	onLoadManager,
	onManualOperationIdChange,
	pendingSettlementOperationIds,
	resolvedOperationId,
	securityPoolAddress,
	stagedOperations,
	suggestedOperationId,
	universeId,
}: {
	activeOperationCount: bigint
	canExecute: boolean
	executeGuardMessage: string | undefined
	executionPending: boolean
	loadingManager: boolean
	managerAddress: Address
	managerDetails: OracleManagerDetails | undefined
	managerError: string | undefined
	manualOperationId: string
	onExecute: (managerAddress: Address, operationId: bigint, securityPoolAddress: Address, universeId: bigint) => void
	onLoadManager: (managerAddress: Address) => void
	onManualOperationIdChange: (value: string) => void
	pendingSettlementOperationIds: bigint[]
	resolvedOperationId: bigint | undefined
	securityPoolAddress: Address
	stagedOperations: StagedOracleOperation[]
	suggestedOperationId: bigint
	universeId: bigint
}) {
	return (
		<SectionBlock density='compact' title={securityPoolCopy.stagedOperations} variant='plain'>
			<ErrorNotice message={managerError} />
			<SectionBlock density='compact' variant='embedded'>
				{stagedOperations.map(operation => (
					<WarningSurface key={operation.operationId.toString()} as='article' className='warning-entity-card' surface='flat' variant='compact'>
						<div className='entity-card-header'>
							<div className='entity-card-copy'>
								<h3>{getPendingOperationLabel(operation.operation)}</h3>
								<p className='detail'>{getStagedOperationExecutionModeLabel(operation.operationId, pendingSettlementOperationIds)}</p>
							</div>
						</div>
						<MetricGrid className='entity-card-body'>
							<MetricField label={securityPoolCopy.operationId}>{operation.operationId.toString()}</MetricField>
							<MetricField label={securityPoolCopy.initiator}>
								<AddressValue address={operation.operator} />
							</MetricField>
							<MetricField label={commonCopy.targetVault}>
								<AddressValue address={operation.targetVault} />
							</MetricField>
							<MetricField label={getPendingOperationAmountPresentation(operation.operation).label}>
								<CurrencyValue precision='exact' value={operation.amount} suffix={getPendingOperationAmountPresentation(operation.operation).suffix} />
							</MetricField>
						</MetricGrid>
					</WarningSurface>
				))}
				{activeOperationCount > BigInt(stagedOperations.length) ? <p className='detail'>{securityPoolCopy.formatShowingActiveStagedOperationsLabel(stagedOperations.length.toString(), activeOperationCount.toString())}</p> : null}
				{managerDetails === undefined || stagedOperations.length > 0 ? null : <StateHint presentation={{ key: 'empty', badgeLabel: securityPoolCopy.noneQueued, badgeTone: 'muted', detail: securityPoolCopy.stagedOperationsEmpty }} />}
			</SectionBlock>
			{managerDetails === undefined ? undefined : (
				<label className='field'>
					<span>{securityPoolCopy.stagedOperationId}</span>
					<FormInput value={manualOperationId} onInput={event => onManualOperationIdChange(event.currentTarget.value)} placeholder={suggestedOperationId > 0n ? suggestedOperationId.toString() : securityPoolCopy.zeroPlaceholder} />
				</label>
			)}
			<div className='actions'>
				<button className='secondary' onClick={() => onLoadManager(managerAddress)} disabled={loadingManager || (managerDetails === undefined && managerError === undefined)}>
					{getStagedOperationsRefreshLabel({ loadingManager, managerError, managerLoaded: managerDetails !== undefined })}
				</button>
				{managerDetails === undefined ? undefined : (
					<TransactionActionButton
						idleLabel={securityPoolCopy.executeStagedOperation}
						pendingLabel={securityPoolCopy.executingStagedOperationLabel}
						onClick={() => {
							if (resolvedOperationId !== undefined) onExecute(managerAddress, resolvedOperationId, securityPoolAddress, universeId)
						}}
						pending={executionPending}
						tone='secondary'
						availability={{ disabled: !canExecute || executeGuardMessage !== undefined, reason: canExecute ? executeGuardMessage : undefined }}
					/>
				)}
			</div>
		</SectionBlock>
	)
}

export function SecurityPoolPriceOracleSection({
	canRequest,
	currentTimestamp,
	loadingManager,
	managerAddress,
	managerDetails,
	managerError,
	metricValues,
	onLoadManager,
	onOpenRequestReview,
	onViewPendingReport,
	requestGuardMessage,
	requestPending,
	requestValueAttoEth,
}: {
	canRequest: boolean
	currentTimestamp: bigint | undefined
	loadingManager: boolean
	managerAddress: Address
	managerDetails: OracleManagerDetails | undefined
	managerError: string | undefined
	metricValues: Pick<OracleManagerDetails, 'lastPrice' | 'lastSettlementTimestamp'> | undefined
	onLoadManager: (managerAddress: Address) => void
	onOpenRequestReview: () => void
	onViewPendingReport: (reportId: bigint) => void
	requestGuardMessage: string | undefined
	requestPending: boolean
	requestValueAttoEth: bigint | undefined
}) {
	const priceValues = managerDetails ?? metricValues
	return (
		<SectionBlock density='compact' title={securityPoolCopy.poolPriceOracle} variant='plain'>
			<MetricGrid>
				<MetricField label={statoblastAppCopy.openOraclePrice} valueTagName='span'>
					<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={priceValues?.lastPrice} lastSettlementTimestamp={priceValues?.lastSettlementTimestamp ?? 0n} priceValidUntilTimestamp={managerDetails?.priceValidUntilTimestamp} />
				</MetricField>
				{managerDetails === undefined ? undefined : (
					<MetricField label={securityPoolCopy.requestCost}>
						<CurrencyValue value={managerDetails.requestPriceCostAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				)}
				{managerDetails?.pendingReportId === undefined || managerDetails.pendingReportId === 0n ? undefined : (
					<MetricField label={securityPoolCopy.pendingRequest}>
						<button className='link' type='button' onClick={() => onViewPendingReport(managerDetails.pendingReportId)}>
							{securityPoolCopy.formatPendingReportLabel(managerDetails.pendingReportId.toString())}
						</button>
					</MetricField>
				)}
			</MetricGrid>
			<ErrorNotice message={managerError} />
			<div className='actions'>
				<button className='secondary' onClick={() => onLoadManager(managerAddress)} disabled={loadingManager}>
					{loadingManager ? <LoadingText>{securityPoolCopy.refreshingOracle}</LoadingText> : securityPoolCopy.refreshOracle}
				</button>
				<TransactionActionButton
					idleLabel={securityPoolCopy.requestNewPrice}
					pendingLabel={securityPoolCopy.requestingNewPrice}
					onClick={onOpenRequestReview}
					pending={requestPending}
					tone='secondary'
					availability={{ disabled: !canRequest || requestValueAttoEth === undefined || requestGuardMessage !== undefined, reason: canRequest ? requestGuardMessage : undefined }}
				/>
			</div>
		</SectionBlock>
	)
}
