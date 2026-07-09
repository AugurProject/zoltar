import { useEffect, useState } from 'preact/hooks'
import { Badge } from './Badge.js'
import { OperationModal } from './OperationModal.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type ActionSafetyPrompt = {
	acknowledgeLabel?: string
	checklist: readonly string[]
	confirmLabel?: string
	severity: 'danger' | 'warning'
	summary: string
	title: string
}

type ActionSafetyModalProps = {
	onCancel: () => void
	onConfirm: () => void
	request:
		| {
				onConfirm: () => void
				prompt: ActionSafetyPrompt
		  }
		| undefined
}

export function ActionSafetyModal({ onCancel, onConfirm, request }: ActionSafetyModalProps) {
	const [acknowledged, setAcknowledged] = useState(false)

	useEffect(() => {
		setAcknowledged(false)
	}, [request?.prompt.title])

	if (request === undefined) return undefined

	const { prompt } = request
	const confirmLabel = prompt.confirmLabel ?? TSX_STRINGS.componentsActionSafetyModal.copy001

	return (
		<OperationModal isOpen onClose={onCancel} title={prompt.title} description={prompt.summary}>
			<div className='action-safety-modal-stack'>
				<div className='action-safety-header'>
					<Badge tone={prompt.severity === 'danger' ? 'danger' : 'warning'}>{prompt.severity === 'danger' ? TSX_STRINGS.componentsActionSafetyModal.copy002 : TSX_STRINGS.componentsActionSafetyModal.copy003}</Badge>
				</div>
				<ul className='action-safety-checklist'>
					{prompt.checklist.map(item => (
						<li key={item}>{item}</li>
					))}
				</ul>
				<label className='action-safety-acknowledgement'>
					<input checked={acknowledged} type='checkbox' onInput={event => setAcknowledged(event.currentTarget.checked)} />
					<span>{prompt.acknowledgeLabel ?? TSX_STRINGS.componentsActionSafetyModal.copy004}</span>
				</label>
				<div className='actions'>
					<button className='secondary' type='button' onClick={onCancel}>
						{TSX_STRINGS.componentsActionSafetyModal.copy005}
					</button>
					<button className={prompt.severity === 'danger' ? 'destructive' : 'primary'} type='button' onClick={onConfirm} disabled={!acknowledged}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</OperationModal>
	)
}
