import { OracleOperationActions } from './OracleOperationActions.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { usePreparedOracleOperation } from '../hooks/usePreparedOracleOperation.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { OracleInitialPriceFields, parseOracleInitialPrice, type OracleInitialPriceInput } from './OracleInitialPriceFields.js'
import { getOracleOperationExecutionMessage, needsOracleInitialPrice } from '../lib/oracleOperationPresentation.js'
import { parseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import type { OperationModalProps, WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import { useId, useState } from 'preact/hooks'
import { formatCurrencyInputBalance, formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import type { OracleManagerDetails, SecurityVaultDetails, SecurityVaultActionResult } from '../../../types/contracts.js'
import { getVaultBackingFactorAdjustmentGuard, getMaximumHealthyCommitment } from '../lib/securityVault.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export function VaultBackingFactorForm({
	details,
	oracleManagerDetails,
	blocker,
	increaseBlocker,
	busy,
	pending,
	executionRepPerEthPrice,
	repPerEthPrice,
	poolSecurityMultiplierBps,
	onAdjust,
	onCompleted,
	onCancel,
	walletBlocker,
	directExecution = false,
}: {
	details: SecurityVaultDetails | undefined
	oracleManagerDetails?: OracleManagerDetails | undefined
	repPerEthPrice?: bigint | undefined
	executionRepPerEthPrice?: bigint | undefined
	poolSecurityMultiplierBps?: bigint | undefined
	blocker: string | undefined
	increaseBlocker?: string | undefined
	busy: boolean
	pending: boolean
	onAdjust: (limit: string, proposedRepPerEthPrice?: bigint) => void | Promise<void>
	onCompleted?: (() => void) | undefined
	onCancel?: (() => void) | undefined
	/** The wallet prerequisite, when it is the `blocker`. */
	walletBlocker?: WalletActionBlocker | undefined
	/** After resolution the change is sent straight to the pool, so no oracle price or report is involved. */
	directExecution?: boolean
}) {
	const [initialPrice, setInitialPrice] = useState<OracleInitialPriceInput>({ price: '' })
	const priceFieldId = useId()
	const needsInitialPrice = !directExecution && needsOracleInitialPrice(oracleManagerDetails, executionRepPerEthPrice !== undefined)
	const { proposedRepPerEthPrice, error: priceError } = parseOracleInitialPrice(needsInitialPrice ? initialPrice : undefined)
	const executionMessage = directExecution ? securityPoolCopy.commitmentDirectExitDetail : getOracleOperationExecutionMessage(oracleManagerDetails, executionRepPerEthPrice !== undefined, details?.vaultAddress)
	const [limitInput, setLimit] = useState<string | undefined>(undefined)
	const minimumBps = poolSecurityMultiplierBps ?? details?.statoblastSecurityMultiplierBps
	const currentLimit = details?.underwritingLimitAttoEth
	const limit = limitInput ?? (currentLimit !== undefined ? formatCurrencyInputBalance(currentLimit, 18) : '0')
	const errorId = useId()
	const [errorRevealed, setErrorRevealed] = useState(false)
	let nextLimit: bigint | undefined
	let limitAttoEth: bigint | undefined
	let error: string | undefined
	try {
		limitAttoEth = parseEthAmountInput(limit, securityPoolCopy.vaultBackingFactor)
		nextLimit = limitAttoEth
	} catch (cause) {
		error = cause instanceof Error ? cause.message : commonCopy.metricUnavailablePlaceholder
	}
	const unchangedLimit = limitAttoEth !== undefined && currentLimit !== undefined && limitAttoEth === currentLimit ? securityPoolCopy.commitmentUnchanged : undefined
	const prerequisite = blocker ?? (limitAttoEth !== undefined && currentLimit !== undefined && limitAttoEth > currentLimit ? increaseBlocker : undefined) ?? unchangedLimit ?? getVaultBackingFactorAdjustmentGuard(details, limitAttoEth, executionRepPerEthPrice, poolSecurityMultiplierBps)
	// The increase guard checks the execution oracle price, so Max and the risk warning use it too; the UI price is only a fallback estimate.
	const maximumRepPerEthPrice = executionRepPerEthPrice ?? repPerEthPrice
	// After resolution the commitment can only be lowered, so no healthy maximum is offered or reported.
	const maximum = directExecution ? undefined : getMaximumHealthyCommitment(details, maximumRepPerEthPrice, minimumBps)
	const riskKey = `${details?.securityPoolAddress}:${details?.vaultAddress}:${limitAttoEth}:${maximumRepPerEthPrice}:${maximum}`
	const [acknowledgedRisk, setAcknowledgedRisk] = useState<string | undefined>(undefined)
	const unsafe = maximum !== undefined && limitAttoEth !== undefined && limitAttoEth > maximum && (currentLimit === undefined || limitAttoEth > currentLimit)
	const riskReason = unsafe && acknowledgedRisk !== riskKey ? securityPoolCopy.commitmentRiskRequired : undefined
	const reason = prerequisite ?? error ?? priceError ?? riskReason
	const fieldErrorShown = prerequisite === undefined && errorRevealed && error !== undefined
	const priceErrorShown = reason === priceError && priceError !== undefined && initialPrice.price !== ''
	let disabledReasonElementId = fieldErrorShown ? errorId : undefined
	if (priceErrorShown) disabledReasonElementId = `${priceFieldId}-error`
	const preparationKey = `${details?.securityPoolAddress}:${details?.vaultAddress}:${details?.managerAddress}:${limit}:${proposedRepPerEthPrice}:${acknowledgedRisk}`
	const prepared = usePreparedOracleOperation({ key: preparationKey, enabled: !directExecution && reason === undefined, busy, onPrepare: () => onAdjust(limit, proposedRepPerEthPrice), onCompleted })
	const fieldsLocked = prepared.sending || (busy && !prepared.preparing)
	return (
		<>
			{needsInitialPrice ? <InlineHint message={securityPoolCopy.commitmentNeedsOracleReport} /> : undefined}
			{needsInitialPrice ? <OracleInitialPriceFields managerAddress={details?.managerAddress} value={initialPrice} onChange={setInitialPrice} disabled={fieldsLocked} fieldId={priceFieldId} /> : undefined}
			<AmountField
				fillMax={directExecution ? undefined : { amount: maximum }}
				allowZero
				disabled={fieldsLocked}
				error={error}
				errorId={errorId}
				errorRevealed={errorRevealed}
				hint={securityPoolCopy.vaultBackingFactorHelp}
				label={securityPoolCopy.commitmentLimit}
				onChange={setLimit}
				onErrorRevealedChange={setErrorRevealed}
				unit={commonCopy.eth}
				value={limit}
			/>
			<MetricGrid>
				{directExecution ? undefined : <MetricField label={securityPoolCopy.minimumBackingRatio}>{minimumBps === undefined ? commonCopy.metricUnavailablePlaceholder : formatMultiplier(minimumBps, 4)}</MetricField>}
				<MetricField label={securityPoolCopy.currentCapacity}>
					<VaultExposureValue capacity={details?.underwritingLimitAttoEth} />
				</MetricField>
				<MetricField label={securityPoolCopy.resultingCapacity}>
					<VaultExposureValue capacity={nextLimit} />
				</MetricField>
				{directExecution ? undefined : (
					<MetricField label={securityPoolCopy.maximumHealthyCommitment}>
						{/* Rounded down so typing the shown figure back never crosses the healthy limit; Max still fills the exact value. */}
						<CurrencyValue rounding='down' value={maximum} suffix={commonCopy.eth} />
						{executionRepPerEthPrice === undefined ? <RepPriceStatusLabel refreshable /> : undefined}
					</MetricField>
				)}
			</MetricGrid>
			{maximum === undefined && !directExecution ? <UserMessage className='detail' detail={securityPoolCopy.commitmentPriceUnavailable} /> : undefined}
			{unsafe ? (
				<>
					<UserMessage className='detail' tone='warning' detail={securityPoolCopy.commitmentRiskWarning} />
					<label className='commitment-risk-confirmation'>
						<input type='checkbox' checked={acknowledgedRisk === riskKey} disabled={fieldsLocked} onChange={event => setAcknowledgedRisk(event.currentTarget.checked ? riskKey : undefined)} />
						<span>{securityPoolCopy.commitmentRiskAcknowledgement}</span>
					</label>
				</>
			) : undefined}
			<InlineHint message={executionMessage} />
			<OracleOperationActions
				prepared={prepared}
				operationKey={preparationKey}
				actionLabel={securityPoolCopy.setVaultUnderwritingLimit}
				pendingLabel={securityPoolCopy.settingCommitmentLimitPending}
				requiresReportFunding={needsInitialPrice}
				directExecution={directExecution}
				busy={busy}
				pending={pending}
				reason={reason}
				onExecute={() => onAdjust(limit, proposedRepPerEthPrice)}
				onCancel={onCancel}
				walletBlocker={walletBlocker}
				disabledReasonElementId={disabledReasonElementId}
				showDisabledReason={!fieldErrorShown && !priceErrorShown}
			/>
		</>
	)
}

export function VaultBackingFactorModal({ result, error, children, ...props }: Omit<OperationModalProps, 'title' | 'closeOnSuccessKey'> & { result: SecurityVaultActionResult | undefined; error: string | undefined }) {
	return (
		<OperationModal
			{...props}
			closeDisabled={props.closeDisabled || (props.embedTransactionSteps === false && transactionSteps.value?.steps.some(step => step.phase === 'wallet') === true)}
			title={securityPoolCopy.setVaultUnderwritingLimit}
			closeOnSuccessKey={result?.action === 'setVaultUnderwritingLimit' && result.stagedExecution?.success !== false ? result.hash : undefined}
		>
			{children}
			<ErrorNotice message={error} />
		</OperationModal>
	)
}
