import * as marketCopy from '../../../copy/market.js'
import { useId } from 'preact/hooks'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'

type UseForForkActionProps = {
	hasForked: boolean
	onUse: () => void
	questionId: string
	questionTitle: string
	/** Why this question cannot be chosen for the fork yet; undefined when it can. */
	reason: string | undefined
	/** Points at a reason already shown once for a whole list instead of repeating it beside the button. */
	reasonElementId?: string | undefined
}

/** Chooses a question for the selected universe's fork. It stays in place while unavailable, disabled with its reason. */
export function UseForForkAction({ hasForked, onUse, questionId, questionTitle, reason, reasonElementId }: UseForForkActionProps) {
	const ownReasonId = useId()
	if (hasForked)
		return (
			<button aria-label={marketCopy.formatUniverseAlreadyForkedLabel(questionTitle, questionId)} className='secondary' disabled type='button'>
				{marketCopy.universeAlreadyForked}
			</button>
		)
	const showOwnReason = reason !== undefined && reasonElementId === undefined
	return (
		<span className='question-fork-handoff'>
			<button aria-describedby={reason === undefined ? undefined : (reasonElementId ?? ownReasonId)} aria-label={marketCopy.formatUseForForkLabel(questionTitle, questionId)} className='secondary' disabled={reason !== undefined} onClick={onUse} type='button'>
				{marketCopy.useForFork}
			</button>
			{showOwnReason ? <UserMessage as='span' className='question-fork-handoff-reason' detail={reason} id={ownReasonId} placement='field' /> : undefined}
		</span>
	)
}
