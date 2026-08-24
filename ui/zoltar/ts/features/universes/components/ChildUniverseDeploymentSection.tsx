import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import type { Address } from '@zoltar/shared/ethereum'
import { useState } from 'preact/hooks'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { ChildUniversesSection, ChildUniverseStatusBadge } from './ChildUniversesSection.js'

type ChildUniverseDeploymentSectionProps = {
	accountAddress: Address | undefined
	childUniverses: ZoltarUniverseSummary['childUniverses']
	hasForked: boolean
	isOnActiveAppChain: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	pendingOutcomeIndex: bigint | undefined
}

function getChildDeploymentAvailabilityReason({ accountAddress, exists, hasForked, isOnActiveAppChain }: { accountAddress: Address | undefined; exists?: boolean | undefined; hasForked: boolean; isOnActiveAppChain: boolean }) {
	if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
	if (!isOnActiveAppChain) return getWrongNetworkReason()
	if (!hasForked) return marketCopy.childUniversesNotForkedReason
	if (exists === true) return marketCopy.childUniverseDeployedReason
	return undefined
}

export function ChildUniverseDeploymentSection({ accountAddress, childUniverses, hasForked, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, pendingOutcomeIndex }: ChildUniverseDeploymentSectionProps) {
	const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState<bigint | undefined>(undefined)
	const selectedChildUniverse = childUniverses.find(child => child.outcomeIndex === selectedOutcomeIndex)
	const selectedAvailabilityReason = getChildDeploymentAvailabilityReason({ accountAddress, exists: selectedChildUniverse?.exists, hasForked, isOnActiveAppChain })
	const requirements = [
		{ key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
		{ key: 'selection', label: marketCopy.childUniverseSelected, resolved: selectedChildUniverse !== undefined, ...(selectedChildUniverse === undefined ? { detail: marketCopy.childDeploymentSelectionRequired } : {}) },
		{ key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
		{ key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: selectedChildUniverse?.exists !== true, ...(selectedChildUniverse?.exists === true ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
	]

	return (
		<>
			<ChildUniversesSection
				childUniverses={childUniverses}
				emptyMessage={marketCopy.noChildUniverses}
				headerSubtitle={hasForked ? marketCopy.childUniverseDeploymentHint : undefined}
				headerTitle={marketCopy.childUniverses}
				action={child => {
					const availabilityReason = getChildDeploymentAvailabilityReason({ accountAddress, exists: child.exists, hasForked, isOnActiveAppChain })
					return {
						availability: { disabled: availabilityReason !== undefined, reason: availabilityReason },
						label: child.exists ? commonCopy.deployed : marketCopy.createChildUniverse,
						onClick: () => setSelectedOutcomeIndex(child.outcomeIndex),
						pending: pendingOutcomeIndex === child.outcomeIndex,
						pendingLabel: commonCopy.opening,
					}
				}}
				renderBadge={child => <ChildUniverseStatusBadge child={child} />}
				renderBody={child => <ChildUniverseDetails accountAddress={accountAddress} child={child} isSupportedChain={isOnActiveAppChain} />}
				surface='flat'
			/>
			<ChildUniverseDeploymentModal
				actionAvailability={{
					disabled: selectedChildUniverse === undefined || selectedAvailabilityReason !== undefined,
					reason: selectedChildUniverse === undefined ? marketCopy.childDeploymentSelectionRequired : selectedAvailabilityReason,
				}}
				idleLabel={marketCopy.deployUniverse}
				isOpen={selectedChildUniverse !== undefined}
				onClose={() => setSelectedOutcomeIndex(undefined)}
				onConfirm={() => {
					if (selectedChildUniverse === undefined) return
					onCreateChildUniverseForOutcomeIndex(selectedChildUniverse.outcomeIndex)
				}}
				pending={selectedChildUniverse !== undefined && pendingOutcomeIndex === selectedChildUniverse.outcomeIndex}
				pendingLabel={marketCopy.deployingUniverse}
				requirements={requirements}
				title={marketCopy.createChildUniverseTitle}
			>
				{selectedChildUniverse === undefined ? undefined : (
					<EntityCard className='compact' surface='flat' title={marketCopy.selectedChildUniverse} variant='compact'>
						<ChildUniverseDetails accountAddress={accountAddress} child={selectedChildUniverse} isSupportedChain={isOnActiveAppChain} />
					</EntityCard>
				)}
			</ChildUniverseDeploymentModal>
		</>
	)
}
