import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { Badge } from './Badge.js'
import { OutcomeSelectionList } from './OutcomeSelectionList.js'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { escapeOnChainText } from '../lib/onChainText.js'
import { OnChainText } from './OnChainText.js'
import { OutcomeIdentity } from './OutcomeIdentity.js'
import { formatLabelWithIdentity } from '../lib/outcomeIdentity.js'

/** `identity` shows the immutable outcome index and child universe ID beside the label, which on-chain text can imitate. */
type Outcome = { key: string; exists?: boolean; label: string; identity?: Readonly<{ outcomeIndex: bigint; universeId: bigint }>; selected?: boolean; disabled?: boolean; pendingLabel?: string | undefined; details?: ComponentChildren; actions?: ComponentChildren; onSelect: () => void }

/**
 * Outcome names and deployment status stay consistent while navigation and selection keep their own semantics. Labels are
 * untrusted on-chain text: they render bidi-isolated with hidden characters escaped.
 * `pendingLabel` replaces the row label and accessible name without adding a progress row. The caller disables pending controls.
 * Unknown deployment status omits its badge; callers may disable navigation explicitly while it is pending.
 * `notDeployedDetail` explains a not-yet-deployed child beside its badge, inside the row's description, so a disabled row says why.
 */
export function OutcomeUniverseList({ outcomes, selection = false, emptyMessage, className = '', notDeployedDetail }: { outcomes: readonly Outcome[]; selection?: boolean; emptyMessage?: ComponentChildren; className?: string; notDeployedDetail?: ComponentChildren }) {
	const statusId = useId()
	return (
		<OutcomeSelectionList
			className={className}
			emptyMessage={emptyMessage}
			items={outcomes.map(outcome => {
				const name = outcome.identity === undefined ? escapeOnChainText(outcome.label) : formatLabelWithIdentity(outcome.label, outcome.identity.outcomeIndex, outcome.identity.universeId)
				return {
					key: outcome.key,
					ariaLabel: outcome.pendingLabel ?? (selection ? name : universeCopy.formatOpenChildUniverse(name)),
					...(outcome.exists === undefined ? {} : { describedById: `${statusId}-${outcome.key}` }),
					label: (
						<>
							{selection ? (
								<span aria-hidden='true' className='migration-outcome-checkbox'>
									{outcome.selected ? '✓' : ''}
								</span>
							) : undefined}
							{outcome.pendingLabel ?? <OnChainText text={outcome.label} />}
							{outcome.identity === undefined || outcome.pendingLabel !== undefined ? undefined : <OutcomeIdentity label={outcome.label} outcomeIndex={outcome.identity.outcomeIndex} universeId={outcome.identity.universeId} />}
							{!selection && outcome.exists !== false && outcome.pendingLabel === undefined ? <span aria-hidden='true'>{universeCopy.openOutcomeArrowTail}</span> : undefined}
						</>
					),
					details:
						outcome.exists === undefined && outcome.details === undefined ? undefined : (
							<>
								{outcome.exists === undefined ? undefined : (
									<span className={!outcome.exists && notDeployedDetail !== undefined ? 'migration-outcome-status-detail' : undefined} id={`${statusId}-${outcome.key}`}>
										{/* The slot reserves the other status label's width (drawn invisibly by CSS, outside the DOM text), so the metrics beside it align across rows. */}
										<span className='outcome-status-slot' data-reserve={outcome.exists ? commonCopy.notDeployed : commonCopy.deployed}>
											<Badge tone={outcome.exists ? 'ok' : 'muted'}>{outcome.exists ? commonCopy.deployed : commonCopy.notDeployed}</Badge>
										</span>
										{outcome.exists || notDeployedDetail === undefined ? undefined : <span className='detail'> {notDeployedDetail}</span>}
									</span>
								)}
								{outcome.details}
							</>
						),
					disabled: outcome.disabled ?? outcome.exists === false,
					...(selection && outcome.selected !== undefined ? { selected: outcome.selected } : {}),
					actions: outcome.actions,
					onSelect: outcome.onSelect,
				}
			})}
		/>
	)
}
