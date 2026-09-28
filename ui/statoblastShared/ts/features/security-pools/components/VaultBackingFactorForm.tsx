import { getOracleOperationExecutionMessage, needsOracleInitialPrice } from '../lib/oracleOperationPresentation.js'
import { OracleInitialPriceFields, parseOracleInitialPrice, type OracleInitialPriceInput } from './OracleInitialPriceFields.js'
import { parseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import type { OperationModalProps } from '@zoltar/ui-core-shared/types/components.js'
import { useId, useState } from 'preact/hooks'
import { formatCurrencyInputBalance, formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { OracleManagerDetails, SecurityVaultDetails, SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { getVaultBackingFactorAdjustmentGuard } from '../lib/securityVault.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export function VaultBackingFactorForm({
	oracleManagerDetails,
	details,
	blocker,
	increaseBlocker,
	busy,
	pending,
	executionRepPerEthPrice,
	poolSecurityMultiplierBps,
	onCertify,
	certificatePending,
	onAdjust,
}: {
	details: SecurityVaultDetails | undefined
	oracleManagerDetails: OracleManagerDetails | undefined
	executionRepPerEthPrice?: bigint | undefined
	poolSecurityMultiplierBps?: bigint | undefined
	blocker: string | undefined
	increaseBlocker?: string | undefined
	busy: boolean
	pending: boolean
	onCertify?: (() => void) | undefined
	certificatePending: boolean
	onAdjust: (limit: string, proposedRepPerEthPrice?: bigint) => void
}) {
	const [initialPrice, setInitialPrice] = useState<OracleInitialPriceInput>({ source: 'automatic', price: '' })
	const priceFieldId = useId()
	const needsInitialPrice = needsOracleInitialPrice(oracleManagerDetails, executionRepPerEthPrice !== undefined)
	const { proposedRepPerEthPrice, error: priceError } = parseOracleInitialPrice(needsInitialPrice ? initialPrice : { source: 'automatic', price: '' })
	const executionMessage = getOracleOperationExecutionMessage(oracleManagerDetails, executionRepPerEthPrice !== undefined, details?.vaultAddress)
	const [limitInput, setLimit] = useState<string | undefined>(undefined)
	const minimumBps = poolSecurityMultiplierBps ?? details?.statoblastSecurityMultiplierBps
	const currentLimit = details?.underwritingLimitAttoEth
	const limit = limitInput ?? (currentLimit !== undefined ? formatCurrencyInputBalance(currentLimit, 18) : '0')
	const descriptionId = useId()
	const sharedReasonId = useId()
	let nextLimit: bigint | undefined
	let limitAttoEth: bigint | undefined
	let error: string | undefined
	try {
		limitAttoEth = parseEthAmountInput(limit, securityPoolCopy.vaultBackingFactor)
		nextLimit = limitAttoEth
	} catch (cause) {
		error = cause instanceof Error ? cause.message : commonCopy.metricUnavailablePlaceholder
	}
	const prerequisite = blocker ?? (limitAttoEth !== undefined && currentLimit !== undefined && limitAttoEth > currentLimit ? increaseBlocker : undefined) ?? getVaultBackingFactorAdjustmentGuard(details, limitAttoEth, executionRepPerEthPrice, poolSecurityMultiplierBps)
	const reason = prerequisite ?? error ?? priceError
	let certificationBlocker = blocker ?? increaseBlocker
	if (certificationBlocker === undefined && executionRepPerEthPrice === undefined) certificationBlocker = securityPoolCopy.certificationNeedsPrice
	if (certificationBlocker === undefined && (details?.underwritingLimitAttoEth ?? 0n) === 0n) certificationBlocker = securityPoolCopy.certificationNeedsLimit
	const sharedReason = certificationBlocker === reason ? reason : undefined
	let disabledReasonElementId = sharedReason === undefined ? descriptionId : sharedReasonId
	if (reason === priceError && priceError !== undefined) disabledReasonElementId = priceFieldId
	return (
		<>
			<label className='field'>
				<span>{securityPoolCopy.vaultBackingFactor}</span>
				<FormInput value={limit} inputMode='decimal' disabled={busy} onInput={event => setLimit(event.currentTarget.value)} invalid={error !== undefined} aria-describedby={descriptionId} />
			</label>
			<p className='detail' id={descriptionId}>
				{error ?? securityPoolCopy.vaultBackingFactorHelp}
			</p>
			<MetricGrid>
				<MetricField label={securityPoolCopy.minimumBackingRatio}>{minimumBps === undefined ? commonCopy.metricUnavailablePlaceholder : formatMultiplier(minimumBps, 4)}</MetricField>
				<MetricField label={securityPoolCopy.currentCapacity}>
					<VaultExposureValue capacity={details?.underwritingLimitAttoEth} />
				</MetricField>
				<MetricField label={securityPoolCopy.resultingCapacity}>
					<VaultExposureValue capacity={nextLimit} />
				</MetricField>
			</MetricGrid>
			<InlineHint message={executionMessage} />
			{needsInitialPrice ? <OracleInitialPriceFields value={initialPrice} onChange={setInitialPrice} disabled={busy} fieldId={priceFieldId} /> : undefined}
			{sharedReason === undefined ? undefined : <InlineHint id={sharedReasonId} message={sharedReason} />}
			<div className='actions'>
				<TransactionActionButton
					idleLabel={securityPoolCopy.certifyCoverage}
					pendingLabel={securityPoolCopy.certifyingCoverage}
					pending={certificatePending}
					showDisabledReason={sharedReason === undefined}
					disabledReasonElementId={sharedReason === undefined ? undefined : sharedReasonId}
					onClick={() => onCertify?.()}
					availability={{
						disabled: busy || onCertify === undefined || certificationBlocker !== undefined,
						reason: certificationBlocker,
					}}
				/>
				<TransactionActionButton
					idleLabel={securityPoolCopy.setVaultUnderwritingLimit}
					pendingLabel={securityPoolCopy.adjustingVaultBackingFactor}
					pending={pending}
					showDisabledReason={prerequisite !== undefined && sharedReason === undefined}
					disabledReasonElementId={disabledReasonElementId}
					onClick={() => onAdjust(limit, proposedRepPerEthPrice)}
					availability={{ disabled: busy || reason !== undefined, reason }}
				/>
			</div>
		</>
	)
}

export function VaultBackingFactorModal({ result, error, children, ...props }: Omit<OperationModalProps, 'title' | 'closeOnSuccessKey'> & { result: SecurityVaultActionResult | undefined; error: string | undefined }) {
	return (
		<OperationModal {...props} title={securityPoolCopy.setVaultUnderwritingLimit} closeOnSuccessKey={result?.action === 'setVaultUnderwritingLimit' && result.stagedExecution?.success !== false ? result.hash : undefined}>
			{children}
			<ErrorNotice message={error} />
		</OperationModal>
	)
}
