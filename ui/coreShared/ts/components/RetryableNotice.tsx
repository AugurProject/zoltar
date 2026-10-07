import type { ComponentChildren } from 'preact'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import { ErrorNotice } from './ErrorNotice.js'
import { StateHint } from './StateHint.js'

function RetryAction({ ariaLabel, label, onRetry, disabled = false }: { ariaLabel?: string | undefined; label: ComponentChildren; onRetry(): void; disabled?: boolean }) {
	return (
		<button aria-label={ariaLabel} className='secondary' type='button' disabled={disabled} onClick={onRetry}>
			{label}
		</button>
	)
}

/** The caller decides when to show a failure and whether existing data remains visible. */
export function RetryableNotice({
	actionsClassName,
	message,
	presentation,
	retryAriaLabel,
	retryLabel,
	onRetry,
	disabled = false,
}: {
	actionsClassName?: string
	message?: string | undefined
	presentation?: UserMessagePresentation
	retryAriaLabel?: string
	retryLabel: ComponentChildren
	onRetry?: (() => void) | undefined
	disabled?: boolean
}) {
	const actions = onRetry === undefined ? undefined : <RetryAction ariaLabel={retryAriaLabel} label={retryLabel} onRetry={onRetry} disabled={disabled} />
	// A load failure reads and announces the same whether the caller passes a message or a load_failed presentation.
	const failureMessage = presentation?.key === 'load_failed' && presentation.detail !== undefined ? presentation.detail : message
	if (presentation !== undefined && (presentation.key !== 'load_failed' || failureMessage === undefined)) return <StateHint presentation={presentation} actions={actions} announcement={presentation.key === 'load_failed' ? 'assertive' : undefined} />
	if (failureMessage === undefined) return undefined
	return (
		<>
			<ErrorNotice message={failureMessage} />
			{actions === undefined ? undefined : <div className={actionsClassName === undefined ? 'actions' : `actions ${actionsClassName}`}>{actions}</div>}
		</>
	)
}
