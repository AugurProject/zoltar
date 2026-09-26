import { parseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import type { OperationModalProps } from '@zoltar/ui-core-shared/types/components.js'
import { useId, useState } from 'preact/hooks'
import { formatCurrencyInputBalance, formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { SecurityVaultDetails, SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { getVaultBackingFactorAdjustmentGuard } from '../lib/securityVault.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export function VaultBackingFactorForm({
	details,
	blocker,
	busy,
	pending,
	repPerEthPrice,
	executionRepPerEthPrice,
	poolSecurityMultiplierBps,
	onCertify,
	certificatePending,
	onAdjust,
}: {
	details: SecurityVaultDetails | undefined
	executionRepPerEthPrice?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	poolSecurityMultiplierBps?: bigint | undefined
	blocker: string | undefined
	busy: boolean
	pending: boolean
	onCertify?: (() => void) | undefined
	certificatePending: boolean
	onAdjust: (limit: string) => void
}) {
	const [limitInput, setLimit] = useState<string | undefined>(undefined)
	const minimumBps = poolSecurityMultiplierBps ?? details?.statoblastSecurityMultiplierBps
	const currentLimit = details?.underwritingLimitAttoEth
	const limit = limitInput ?? (currentLimit !== undefined ? formatCurrencyInputBalance(currentLimit, 18) : '0')
	const descriptionId = useId()
	let nextLimit: bigint | undefined
	let limitAttoEth: bigint | undefined
	let error: string | undefined
	try {
		limitAttoEth = parseEthAmountInput(limit, securityPoolCopy.vaultBackingFactor)
		nextLimit = limitAttoEth
	} catch (cause) {
		error = cause instanceof Error ? cause.message : commonCopy.metricUnavailablePlaceholder
	}
	const prerequisite = blocker ?? getVaultBackingFactorAdjustmentGuard(details, limitAttoEth, executionRepPerEthPrice, poolSecurityMultiplierBps)
	const reason = prerequisite ?? error
	let certificationBlocker = blocker
	if (certificationBlocker === undefined && executionRepPerEthPrice === undefined) certificationBlocker = securityPoolCopy.certificationNeedsPrice
	if (certificationBlocker === undefined && (details?.underwritingLimitAttoEth ?? 0n) === 0n) certificationBlocker = securityPoolCopy.certificationNeedsLimit
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
					<VaultExposureValue capacity={details?.underwritingLimitAttoEth} multiplierBps={minimumBps} repPerEthPrice={repPerEthPrice} />
				</MetricField>
				<MetricField label={securityPoolCopy.resultingCapacity}>
					<VaultExposureValue capacity={nextLimit} multiplierBps={minimumBps} repPerEthPrice={repPerEthPrice} />
				</MetricField>
			</MetricGrid>
			<div className='actions'>
				<TransactionActionButton
					idleLabel={securityPoolCopy.certifyCoverage}
					pendingLabel={securityPoolCopy.certifyingCoverage}
					pending={certificatePending}
					onClick={() => onCertify?.()}
					availability={{
						disabled: busy || onCertify === undefined || blocker !== undefined || executionRepPerEthPrice === undefined || (details?.underwritingLimitAttoEth ?? 0n) === 0n,
						reason: certificationBlocker,
					}}
				/>
				<TransactionActionButton
					idleLabel={securityPoolCopy.setVaultUnderwritingLimit}
					pendingLabel={securityPoolCopy.adjustingVaultBackingFactor}
					pending={pending}
					showDisabledReason={prerequisite !== undefined}
					disabledReasonElementId={descriptionId}
					onClick={() => onAdjust(limit)}
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
