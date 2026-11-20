import { formatOutcomeIdentityText } from '../lib/outcomeIdentity.js'

/**
 * Shown after an on-chain outcome label, which can imitate another outcome's label but not its index or child universe.
 * `label` is the raw label beside it, so an index the label already names is not repeated. The leading space is the only gap.
 */
export function OutcomeIdentity({ label, outcomeIndex, universeId }: { label: string; outcomeIndex: bigint; universeId?: bigint | undefined }) {
	const identity = formatOutcomeIdentityText(label, outcomeIndex, universeId)
	if (identity === undefined) return undefined
	return (
		<>
			{' '}
			<span className='outcome-identity'>{identity}</span>
		</>
	)
}
