import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { UniverseLink } from '@zoltar/ui-core-shared/components/UniverseLink.js'
import type { UserMessagePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { UniverseName } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'

export function SecurityPoolUniverseMismatchNotice({
	activeUniverseId,
	onReturnToCurrentUniverse,
	onSwitchToPoolUniverse,
	selectedPool,
}: {
	activeUniverseId: bigint
	onReturnToCurrentUniverse: (() => void) | undefined
	onSwitchToPoolUniverse: ((universeId: bigint, securityPoolAddress: string) => void) | undefined
	selectedPool: ListedSecurityPool
}) {
	return (
		<SectionBlock title={securityPoolCopy.universeMismatch} tone='critical' variant='embedded'>
			<UserMessage
				className='detail'
				detail={
					<>
						<span>{securityPoolCopy.poolUniverseLead}</span> <UniverseLink universeId={selectedPool.universeId} /> <span>{securityPoolCopy.activeUniverseSeparator}</span>{' '}
						<span>
							<UniverseName universeId={activeUniverseId} />
						</span>
						. <span>{securityPoolCopy.universeMismatchDetail}</span>
					</>
				}
			/>
			<div className='actions'>
				<button className='primary' type='button' onClick={() => onSwitchToPoolUniverse?.(selectedPool.universeId, selectedPool.securityPoolAddress)}>
					{securityPoolCopy.switchToPoolUniverse}
				</button>
				<button className='secondary' type='button' onClick={onReturnToCurrentUniverse}>
					{securityPoolCopy.returnToCurrentUniverse}
				</button>
			</div>
		</SectionBlock>
	)
}

export function SecurityPoolWorkflowEmptyState({
	emptyWorkflowTitle,
	hasSelectedPoolAddress,
	onBrowsePools,
	onCreatePool,
	selectedPoolUniverseMismatch,
	selectedPoolWorkflowLockedPresentation,
}: {
	emptyWorkflowTitle: string | undefined
	hasSelectedPoolAddress: boolean
	onBrowsePools: () => void
	onCreatePool: () => void
	selectedPoolUniverseMismatch: boolean
	selectedPoolWorkflowLockedPresentation: UserMessagePresentation | undefined
}) {
	if (selectedPoolUniverseMismatch) return undefined
	if (!hasSelectedPoolAddress)
		return (
			<EmptyState
				actions={
					<>
						<button className='primary' type='button' onClick={onBrowsePools}>
							{commonCopy.browsePools}
						</button>
						<button className='secondary' type='button' onClick={onCreatePool}>
							{commonCopy.createPool}
						</button>
					</>
				}
				detail={securityPoolCopy.noPoolSelectedHint}
				title={securityPoolCopy.noPoolSelectedBadgeLabel}
			/>
		)
	if (selectedPoolWorkflowLockedPresentation === undefined) return undefined
	return (
		<SectionBlock title={emptyWorkflowTitle} variant='plain'>
			<StateHint presentation={selectedPoolWorkflowLockedPresentation} />
		</SectionBlock>
	)
}
