import type { ComponentChildren } from 'preact'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import { ErrorNotice } from './ErrorNotice.js'
import { StateHint } from './StateHint.js'

export function RetryAction({ label, onRetry, disabled = false }: { label: ComponentChildren; onRetry(): void; disabled?: boolean }) {
	return (
		<button className='secondary' type='button' disabled={disabled} onClick={onRetry}>
			{label}
		</button>
	)
}

/** The caller decides when to show a failure and whether existing data remains visible. */
export function RetryableNotice({ message, presentation, retryLabel, onRetry, disabled = false }: { message?: string; presentation?: UserMessagePresentation; retryLabel: ComponentChildren; onRetry?: (() => void) | undefined; disabled?: boolean }) {
	const actions = onRetry === undefined ? undefined : <RetryAction label={retryLabel} onRetry={onRetry} disabled={disabled} />
	if (presentation !== undefined) return <StateHint presentation={presentation} actions={actions} />
	if (message === undefined) return undefined
	return (
		<>
			<ErrorNotice message={message} />
			{actions === undefined ? undefined : <div className='actions'>{actions}</div>}
		</>
	)
}
