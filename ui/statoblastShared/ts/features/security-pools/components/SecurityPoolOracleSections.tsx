import { useLayoutEffect, useId, useState } from 'preact/hooks'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
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
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import type { OracleManagerDetails, StagedOracleOperation } from '@zoltar/ui-core-shared/types/contracts.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getPendingOperationAmountPresentation, getPendingOperationLabel, getStagedOperationExecutionModeLabel } from './SecurityPoolWorkflowPresentation.js'

export type RequestPriceReview = {
	proposedRepPerEthPrice?: bigint | undefined
	requestValueAttoEth: bigint
	managerAddress: Address
	securityPoolAddress: Address
	universeId: bigint
}

export const PRICE_ORACLE_HEADING_ID = 'selected-pool-price-oracle-heading'

function getStagedOperationsRefreshLabel({ loadingManager, managerError, managerLoaded }: { loadingManager: boolean; managerError: string | undefined; managerLoaded: boolean }) {
	if (!managerLoaded && loadingManager && managerError === undefined) return <LoadingText>{securityPoolCopy.loadingStagedOperations}</LoadingText>
	if (!managerLoaded) return securityPoolCopy.retryStagedOperations
	if (loadingManager) return <LoadingText>{securityPoolCopy.refreshingOperations}</LoadingText>
	return securityPoolCopy.refreshStagedOperations
}

export type RequestPriceModalProps = {
	canRequest: boolean
	closeOnSuccessKey: string | undefined
	confirmationGuardMessage: string | undefined
	getReturnFocusTarget?: () => HTMLElement | null
	onClose: () => void
	onConfirm: (review: RequestPriceReview, signal?: AbortSignal) => void | Promise<void>
	pending: boolean
	review: RequestPriceReview | undefined
}

export function SecurityPoolRequestPriceModal({ canRequest, closeOnSuccessKey, confirmationGuardMessage, getReturnFocusTarget, onClose, onConfirm, pending, review }: RequestPriceModalProps) {
	const manualPriceFieldId = useId()
	const [priceSource, setPriceSource] = useState<'automatic' | 'manual'>('automatic')
	const [manualPrice, setManualPrice] = useState('')
	useLayoutEffect(() => {
		setPriceSource('automatic')
		setManualPrice('')
	}, [review])
	const parsedPrice = tryParseDecimalInput(manualPrice)
	const proposedRepPerEthPrice = priceSource === 'manual' ? parsedPrice : undefined
	const manualPriceError = priceSource === 'manual' && (parsedPrice === undefined || parsedPrice <= 0n || parsedPrice >= 2n ** 256n) ? securityPoolCopy.manualInitialPriceError : undefined
	return (
		<OperationModal closeOnSuccessKey={closeOnSuccessKey} getReturnFocusTarget={getReturnFocusTarget} isOpen={review !== undefined} onClose={onClose} title={securityPoolCopy.requestNewPriceTitle}>
			<ViewTabs
				ariaLabel={securityPoolCopy.initialPriceSource}
				variant='segmented'
				value={priceSource}
				onChange={setPriceSource}
				options={[
					{ value: 'automatic', label: securityPoolCopy.automaticUniswapPrice, disabled: pending },
					{ value: 'manual', label: securityPoolCopy.manualInitialPrice, disabled: pending },
				]}
			/>
			{priceSource === 'manual' ? (
				<label className='field' id={manualPriceFieldId}>
					<span>{securityPoolCopy.manualRepPerEth}</span>
					<FormInput aria-label={securityPoolCopy.manualRepPerEth} value={manualPrice} inputMode='decimal' disabled={pending} onInput={event => setManualPrice(event.currentTarget.value)} error={manualPriceError} hint={securityPoolCopy.manualInitialPriceHint} />
				</label>
			) : undefined}
			<TransactionReview variant='inline' primary={[{ label: transactionReviewCopy.youPay, value: <CurrencyValue precision='exact' value={review?.requestValueAttoEth} suffix={commonCopy.eth} /> }]} risks={[securityPoolCopy.requestPricePendingReportRisk, securityPoolCopy.requestPriceFundingRisk]} />
			<div className='actions oracle-actions'>
				<TransactionActionButton
					disabledReasonElementId={manualPriceError === undefined ? undefined : manualPriceFieldId}
					showDisabledReason={confirmationGuardMessage !== undefined || manualPriceError === undefined}
					idleLabel={securityPoolCopy.confirmPriceRequest}
					pendingLabel={securityPoolCopy.requestingNewPrice}
					onClick={() => {
						if (review !== undefined && manualPriceError === undefined && !pending && canRequest && confirmationGuardMessage === undefined) void onConfirm({ ...review, proposedRepPerEthPrice })
					}}
					pending={pending}
					availability={{ disabled: review === undefined || !canRequest || confirmationGuardMessage !== undefined || manualPriceError !== undefined, reason: canRequest ? (confirmationGuardMessage ?? manualPriceError) : undefined }}
				/>
				<button className='secondary' type='button' onClick={onClose} disabled={pending}>
					{commonCopy.cancel}
				</button>
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
	const selectedOperationListed = stagedOperations.some(operation => operation.operationId === resolvedOperationId)
	const executionAction =
		managerDetails === undefined ? undefined : (
			<TransactionActionButton
				idleLabel={securityPoolCopy.executeStagedOperation}
				pendingLabel={securityPoolCopy.executingStagedOperationLabel}
				onClick={() => {
					if (resolvedOperationId !== undefined) onExecute(managerAddress, resolvedOperationId, securityPoolAddress, universeId)
				}}
				pending={executionPending}
				tone='primary'
				availability={{ disabled: !canExecute || executeGuardMessage !== undefined, reason: canExecute ? executeGuardMessage : undefined }}
			/>
		)
	return (
		<SectionBlock density='compact' title={securityPoolCopy.stagedOperations} variant='plain'>
			<ErrorNotice message={managerError} />
			<SectionBlock density='compact' variant='embedded'>
				<div className='decision-card-list'>
					{stagedOperations.map(operation => {
						const amount = getPendingOperationAmountPresentation(operation.operation)
						const selected = operation.operationId === resolvedOperationId
						return (
							<article key={operation.operationId.toString()} className={'staged-operation-card' + (selected ? ' selected' : '')}>
								<div className='entity-card-header'>
									<div className='entity-card-copy'>
										<h3>{getPendingOperationLabel(operation.operation)}</h3>
										<p className='detail'>{getStagedOperationExecutionModeLabel(operation.operationId, pendingSettlementOperationIds)}</p>
									</div>
								</div>
								<div className='decision-summary'>
									<p className='decision-amount'>
										<CurrencyValue precision='exact' value={operation.amount} decimals={amount.decimals} suffix={amount.suffix} />
									</p>
									{amount.summaryLabel === undefined ? undefined : <p className='detail'>{amount.summaryLabel}</p>}
									<div className='inline-facts'>
										<span>{commonCopy.targetVault}</span>
										<AddressValue address={operation.targetVault} />
									</div>
									<div className='actions'>
										<button type='button' className='secondary' aria-pressed={selected} disabled={executionPending} onClick={() => onManualOperationIdChange(operation.operationId.toString())}>
											{selected ? commonCopy.selected : securityPoolCopy.selectOperation}
										</button>
										{selected ? executionAction : undefined}
									</div>
									<ReadOnlyDetailAccordion title={securityPoolCopy.operationDetails}>
										<MetricField label={securityPoolCopy.operationId}>{operation.operationId.toString()}</MetricField>
										<MetricField label={securityPoolCopy.initiator}>
											<AddressValue address={operation.operator} />
										</MetricField>
									</ReadOnlyDetailAccordion>
								</div>
							</article>
						)
					})}
				</div>
				{activeOperationCount > BigInt(stagedOperations.length) ? <p className='detail'>{securityPoolCopy.formatShowingActiveStagedOperationsLabel(stagedOperations.length.toString(), activeOperationCount.toString())}</p> : null}
				{managerDetails === undefined || stagedOperations.length > 0 ? null : <StateHint presentation={{ key: 'empty', badgeLabel: securityPoolCopy.noneQueued, badgeTone: 'muted', detail: securityPoolCopy.stagedOperationsEmpty }} />}
			</SectionBlock>
			{managerDetails === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={securityPoolCopy.openOperationById}>
					<label className='field'>
						<span>{securityPoolCopy.stagedOperationId}</span>
						<FormInput value={manualOperationId} onInput={event => onManualOperationIdChange(event.currentTarget.value)} placeholder={suggestedOperationId > 0n ? suggestedOperationId.toString() : securityPoolCopy.zeroPlaceholder} />
					</label>
				</ReadOnlyDetailAccordion>
			)}
			<div className='actions oracle-actions'>
				<button className='secondary' onClick={() => onLoadManager(managerAddress)} disabled={loadingManager || (managerDetails === undefined && managerError === undefined)}>
					{getStagedOperationsRefreshLabel({ loadingManager, managerError, managerLoaded: managerDetails !== undefined })}
				</button>
				{selectedOperationListed ? undefined : executionAction}
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
		<SectionBlock density='compact' headingId={PRICE_ORACLE_HEADING_ID} title={securityPoolCopy.poolPriceOracle} variant='plain'>
			<MetricGrid>
				<MetricField label={statoblastAppCopy.openOraclePrice} valueTagName='span'>
					<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={priceValues?.lastPrice} lastSettlementTimestamp={priceValues?.lastSettlementTimestamp ?? 0n} pendingReportReadyAtTimestamp={managerDetails?.pendingReportReadyAtTimestamp} priceValidUntilTimestamp={managerDetails?.priceValidUntilTimestamp} />
					<button className='quiet metric-label-refresh' type='button' onClick={() => onLoadManager(managerAddress)} disabled={loadingManager} aria-label={securityPoolCopy.refreshOracle} aria-busy={loadingManager} title={securityPoolCopy.refreshOracle}>
						{loadingManager ? <span className='spinner' aria-hidden='true' /> : <span aria-hidden='true'>↻</span>}
					</button>
				</MetricField>
				{managerDetails === undefined ? undefined : (
					<MetricField label={securityPoolCopy.requestCost}>
						<CurrencyValue exactWhenRoundedToZero value={managerDetails.requestPriceCostAttoEth} suffix={commonCopy.eth} />
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
			<div className='actions oracle-actions'>
				<TransactionActionButton
					idleLabel={securityPoolCopy.requestNewPrice}
					pendingLabel={securityPoolCopy.requestingNewPrice}
					onClick={onOpenRequestReview}
					pending={requestPending}
					tone='primary'
					availability={{ disabled: !canRequest || requestValueAttoEth === undefined || requestGuardMessage !== undefined, reason: canRequest ? requestGuardMessage : undefined }}
				/>
			</div>
		</SectionBlock>
	)
}
