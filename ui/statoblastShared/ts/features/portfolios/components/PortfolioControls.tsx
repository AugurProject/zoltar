import { useId } from 'preact/hooks'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as copy from '../../../copy/portfolio.js'
import type { usePortfolioActions } from '../hooks/usePortfolioActions.js'

export type PortfolioActions = ReturnType<typeof usePortfolioActions>

export function PortfolioInput({ label, value, onChange, disabled = false, hint, numeric = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; hint?: string; numeric?: boolean }) {
	const id = useId()
	return (
		<div className='field'>
			<label htmlFor={id}>{label}</label>
			<FormInput id={id} value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} hint={hint} inputMode={numeric ? 'decimal' : 'text'} autoComplete='off' />
		</div>
	)
}

export function PortfolioButton({ model, action, label, pendingLabel, reason, onClick }: { model: Pick<PortfolioActions, 'scope' | 'busy'>; action: string; label: string; pendingLabel: string; reason?: string | undefined; onClick: () => Promise<void> }) {
	const disabledReason = model.busy !== undefined && model.busy !== action ? copy.busy : reason
	return <TransactionActionButton scope={model.scope} idleLabel={label} pendingLabel={pendingLabel} pending={model.busy === action} availability={{ disabled: disabledReason !== undefined, reason: disabledReason }} onClick={() => void onClick()} />
}
