import type { ComponentChildren } from 'preact'
import { OperationModal } from './OperationModal.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import type { ActionAvailability, ReadinessBlocker } from '../types/components.js'

type ChildUniverseDeploymentModalProps = {
	actionAvailability: ActionAvailability
	children?: ComponentChildren
	description: ComponentChildren
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
