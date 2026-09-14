import { useId, useState } from 'preact/hooks'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { getVaultBackingFactorAdjustmentGuard, parseTargetHealthFactorBps } from '../lib/securityVault.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export function VaultBackingFactorForm({ details, blocker, busy, pending, onAdjust }: { details: SecurityVaultDetails | undefined; blocker: string | undefined; busy: boolean; pending: boolean; onAdjust: (factor: string) => void }) {
	const [factorInput, setFactor] = useState<string | undefined>(undefined)
	const currentFactorBps = details?.poolHeldRepPerCapacityBps
	const factor = factorInput ?? (currentFactorBps !== undefined && currentFactorBps >= 10_000n ? formatCurrencyInputBalance(currentFactorBps, 4) : '2')
	const descriptionId = useId()
	let nextCapacity: bigint | undefined
	let error: string | undefined
	try {
		const factorBps = parseTargetHealthFactorBps(factor, securityPoolCopy.vaultBackingFactor)
		if (details !== undefined) nextCapacity = (details.vaultAttoRepBacking * 10_000n) / factorBps
		if (nextCapacity === 0n) error = securityPoolCopy.positiveCapacityRequired
	} catch (cause) {
		error = cause instanceof Error ? cause.message : commonCopy.metricUnavailablePlaceholder
	}
	const prerequisite = blocker ?? getVaultBackingFactorAdjustmentGuard(details)
	const reason = prerequisite ?? error
	return (
		<>
			<label className='field'>
				<span>{securityPoolCopy.vaultBackingFactor}</span>
				<FormInput value={factor} inputMode='decimal' disabled={busy} onInput={event => setFactor(event.currentTarget.value)} invalid={error !== undefined} aria-describedby={descriptionId} />
			</label>
			<p className='detail' id={descriptionId}>
				{error ?? securityPoolCopy.vaultBackingFactorHelp}
			</p>
			<MetricGrid>
				<MetricField label={securityPoolCopy.currentCapacity}>{details === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={details.capacityOwnershipAttoRep} suffix={securityPoolCopy.capacityUnits} />}</MetricField>
				<MetricField label={securityPoolCopy.resultingCapacity}>{nextCapacity === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={nextCapacity} suffix={securityPoolCopy.capacityUnits} />}</MetricField>
			</MetricGrid>
			<div className='actions'>
				<TransactionActionButton
					idleLabel={securityPoolCopy.adjustVaultBackingFactor}
					pendingLabel={securityPoolCopy.adjustingVaultBackingFactor}
					pending={pending}
					showDisabledReason={prerequisite !== undefined}
					disabledReasonElementId={descriptionId}
					onClick={() => onAdjust(factor)}
					availability={{ disabled: busy || reason !== undefined, reason }}
				/>
			</div>
		</>
	)
}

export function DepositBackingFactorField({ value, error, disabled, onChange }: { value: string; error: string | undefined; disabled: boolean; onChange: (value: string) => void }) {
	const descriptionId = useId()
	return (
		<label className='field'>
			<span>{securityPoolCopy.targetHealthFactor}</span>
			<FormInput aria-describedby={descriptionId} value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} invalid={error !== undefined} />
			<small className='field-help' id={descriptionId}>
				{error ?? securityPoolCopy.targetHealthFactorHelp}
			</small>
		</label>
	)
}
