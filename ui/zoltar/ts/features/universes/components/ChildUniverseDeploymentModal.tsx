import type { ComponentChildren } from 'preact'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { RequirementsChecklist } from '@zoltar/ui-core-shared/components/RequirementsChecklist.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { ActionAvailability, ReadinessBlocker } from '../../types.js'

type ChildUniverseDeploymentModalProps = {
	actionAvailability: ActionAvailability
	children?: ComponentChildren
	description?: ComponentChildren
	idleLabel: ComponentChildren
	isOpen: boolean
	onClose: () => void
	onConfirm: () => void
	pending: boolean
	pendingLabel: ComponentChildren
	requirements: ReadinessBlocker[]
	title: ComponentChildren
	tone?: 'primary' | 'secondary'
}

export function ChildUniverseDeploymentModal({ actionAvailability, children, description, idleLabel, isOpen, onClose, onConfirm, pending, pendingLabel, requirements, title, tone = 'secondary' }: ChildUniverseDeploymentModalProps) {
	return (
		<OperationModal isOpen={isOpen} onClose={onClose} title={title} description={description}>
			{children}
			<RequirementsChecklist items={requirements} />
			<div className='actions'>
				<TransactionActionButton idleLabel={idleLabel} pendingLabel={pendingLabel} onClick={onConfirm} pending={pending} tone={tone} availability={actionAvailability} />
			</div>
		</OperationModal>
	)
}
