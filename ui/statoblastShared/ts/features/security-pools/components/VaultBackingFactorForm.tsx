import { VaultExposureValue } from './VaultExposureValue.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import type { OperationModalProps } from '@zoltar/ui-core-shared/types/components.js'
import { useId, useState } from 'preact/hooks'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { SecurityVaultDetails, SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { getVaultBackingFactorAdjustmentGuard, parseTargetHealthFactorBps } from '../lib/securityVault.js'
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
	onAdjust,
}: {
	details: SecurityVaultDetails | undefined
	executionRepPerEthPrice?: bigint | undefined
	repPerEthPrice?: bigint | undefined
	poolSecurityMultiplierBps?: bigint | undefined
	blocker: string | undefined
	busy: boolean
	pending: boolean
	onAdjust: (factor: string) => void
}) {
	const [factorInput, setFactor] = useState<string | undefined>(undefined)
	const minimumBps = poolSecurityMultiplierBps ?? details?.statoblastSecurityMultiplierBps
	const currentFactorBps = details?.targetBackingFactorBps || minimumBps
	const factor = factorInput ?? (currentFactorBps !== undefined && currentFactorBps >= 10_000n ? formatCurrencyInputBalance(currentFactorBps, 4) : '2')
	const errorId = useId()
	const [errorRevealed, setErrorRevealed] = useState(false)
	let nextCapacity: bigint | undefined
	let factorBps: bigint | undefined
	let error: string | undefined
	try {
		factorBps = parseTargetHealthFactorBps(factor, securityPoolCopy.vaultBackingFactor, minimumBps)
		if (details !== undefined && minimumBps !== undefined) nextCapacity = (details.vaultAttoRepBacking * minimumBps) / factorBps
		if (nextCapacity === 0n) error = securityPoolCopy.positiveCapacityRequired
	} catch (cause) {
		error = cause instanceof Error ? cause.message : commonCopy.metricUnavailablePlaceholder
	}
	const prerequisite = blocker ?? getVaultBackingFactorAdjustmentGuard(details, factorBps, executionRepPerEthPrice, poolSecurityMultiplierBps)
	const reason = prerequisite ?? error
	const fieldErrorShown = prerequisite === undefined && errorRevealed && error !== undefined
	return (
		<>
			<AmountField decimals={4} disabled={busy} error={error} errorId={errorId} errorRevealed={errorRevealed} hint={securityPoolCopy.vaultBackingFactorHelp} label={securityPoolCopy.vaultBackingFactor} onChange={setFactor} onErrorRevealedChange={setErrorRevealed} unit={commonCopy.multiplierUnit} value={factor} />
			<MetricGrid>
				<MetricField label={securityPoolCopy.minimumBackingRatio}>{minimumBps === undefined ? commonCopy.metricUnavailablePlaceholder : `${formatCurrencyInputBalance(minimumBps, 4)}×`}</MetricField>
				<MetricField label={securityPoolCopy.currentExposureSupported}>
					<VaultExposureValue capacity={details?.capacityOwnershipAttoRep} multiplierBps={minimumBps} repPerEthPrice={repPerEthPrice} />
				</MetricField>
				<MetricField label={securityPoolCopy.resultingExposureSupported}>
					<VaultExposureValue capacity={nextCapacity} multiplierBps={minimumBps} repPerEthPrice={repPerEthPrice} />
				</MetricField>
			</MetricGrid>
			<details>
				<summary>{commonCopy.technicalDetails}</summary>
				<MetricGrid>
					<MetricField label={securityPoolCopy.currentCapacity}>
						<CurrencyValue value={details?.capacityOwnershipAttoRep} suffix={securityPoolCopy.capacityUnits} />
					</MetricField>
					<MetricField label={securityPoolCopy.resultingCapacity}>
						<CurrencyValue value={nextCapacity} suffix={securityPoolCopy.capacityUnits} />
					</MetricField>
				</MetricGrid>
			</details>
			<div className='actions'>
				<TransactionActionButton
					idleLabel={securityPoolCopy.adjustVaultBackingFactor}
					pendingLabel={securityPoolCopy.adjustingVaultBackingFactor}
					pending={pending}
					showDisabledReason={!fieldErrorShown}
					disabledReasonElementId={fieldErrorShown ? errorId : undefined}
					onClick={() => onAdjust(factor)}
					availability={{ disabled: busy || reason !== undefined, reason }}
				/>
			</div>
		</>
	)
}

export function DepositBackingFactorField({
	value,
	error,
	errorRevealed,
	disabled,
	minimumBps,
	onChange,
	onErrorRevealedChange,
}: {
	value: string
	minimumBps?: bigint | undefined
	error: string | undefined
	errorRevealed: boolean
	disabled: boolean
	onChange: (value: string) => void
	onErrorRevealedChange: (revealed: boolean) => void
}) {
	return (
		<AmountField
			decimals={4}
			disabled={disabled}
			error={error}
			errorRevealed={errorRevealed}
			onErrorRevealedChange={onErrorRevealedChange}
			hint={securityPoolCopy.formatTargetHealthFactorHint(minimumBps === undefined ? commonCopy.metricUnavailablePlaceholder : `${formatCurrencyInputBalance(minimumBps, 4)}${commonCopy.multiplierUnit}`)}
			label={securityPoolCopy.targetHealthFactor}
			onChange={onChange}
			unit={commonCopy.multiplierUnit}
			value={value}
		/>
	)
}

export function VaultBackingFactorModal({ result, error, children, ...props }: Omit<OperationModalProps, 'title' | 'closeOnSuccessKey'> & { result: SecurityVaultActionResult | undefined; error: string | undefined }) {
	return (
		<OperationModal {...props} title={securityPoolCopy.adjustVaultBackingFactor} closeOnSuccessKey={result?.action === 'adjustVaultBackingFactor' && result.stagedExecution?.success !== false ? result.hash : undefined}>
			{children}
			<ErrorNotice message={error} />
		</OperationModal>
	)
}
