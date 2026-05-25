import { useEffect, useRef, useState } from 'preact/hooks'
import { EntityCard } from './EntityCard.js'
import { TransactionActionStatus } from './TransactionActionStatus.js'
import type { WorkflowTransactionStatusProps } from '../types/components.js'

const dismissedLatestActionKeys = new Set<string>()
const dismissedOutcomeKeys = new Set<string>()

function getPersistedDismissedKey(dismissedKeys: Set<string>, dismissKey: string | undefined) {
	if (dismissKey === undefined || !dismissedKeys.has(dismissKey)) return undefined
	return dismissKey
}

export function WorkflowTransactionStatus({ latestAction, outcome }: WorkflowTransactionStatusProps) {
	const [dismissedLatestActionKey, setDismissedLatestActionKey] = useState<string | undefined>(() => getPersistedDismissedKey(dismissedLatestActionKeys, latestAction?.dismissKey))
	const [dismissedOutcomeKey, setDismissedOutcomeKey] = useState<string | undefined>(() => getPersistedDismissedKey(dismissedOutcomeKeys, outcome?.dismissKey))
	const latestActionKeyRef = useRef(latestAction?.dismissKey)
	const outcomeKeyRef = useRef(outcome?.dismissKey)

	useEffect(() => {
		if (latestAction?.dismissKey === latestActionKeyRef.current) return
		latestActionKeyRef.current = latestAction?.dismissKey
		const nextDismissedLatestActionKey = getPersistedDismissedKey(dismissedLatestActionKeys, latestAction?.dismissKey)
		if (dismissedLatestActionKey === nextDismissedLatestActionKey) return
		setDismissedLatestActionKey(nextDismissedLatestActionKey)
	}, [dismissedLatestActionKey, latestAction?.dismissKey])

	useEffect(() => {
		if (outcome?.dismissKey === outcomeKeyRef.current) return
		outcomeKeyRef.current = outcome?.dismissKey
		const nextDismissedOutcomeKey = getPersistedDismissedKey(dismissedOutcomeKeys, outcome?.dismissKey)
		if (dismissedOutcomeKey === nextDismissedOutcomeKey) return
		setDismissedOutcomeKey(nextDismissedOutcomeKey)
	}, [dismissedOutcomeKey, outcome?.dismissKey])

	const showOutcome = outcome !== undefined && (outcome.dismissKey === undefined || outcome.dismissKey !== dismissedOutcomeKey)
	const showLatestAction = latestAction !== undefined && (latestAction.dismissKey === undefined || latestAction.dismissKey !== dismissedLatestActionKey)

	if (!showLatestAction && !showOutcome) return undefined

	return (
		<div className='workflow-transaction-status'>
			{!showOutcome || outcome === undefined ? undefined : (
				<div className='workflow-status-item'>
					{outcome.dismissKey === undefined ? undefined : (
						<button
							className='quiet modal-close-button workflow-status-close'
							type='button'
							aria-label='Dismiss workflow outcome'
							title='Close'
							onClick={() => {
								if (outcome.dismissKey === undefined) return
								dismissedOutcomeKeys.add(outcome.dismissKey)
								setDismissedOutcomeKey(outcome.dismissKey)
							}}
						>
							&times;
						</button>
					)}
					<TransactionActionStatus
						status={{
							detail:
								outcome.nextStep === undefined ? (
									outcome.detail
								) : (
									<>
										{outcome.detail} Next: {outcome.nextStep}
									</>
								),
							title: outcome.title,
							tone: 'success',
						}}
					/>
				</div>
			)}
			{!showLatestAction || latestAction === undefined ? undefined : (
				<div className='workflow-status-item'>
					{latestAction.dismissKey === undefined ? undefined : (
						<button
							className='quiet modal-close-button workflow-status-close'
							type='button'
							aria-label='Dismiss latest action'
							title='Close'
							onClick={() => {
								if (latestAction.dismissKey === undefined) return
								dismissedLatestActionKeys.add(latestAction.dismissKey)
								setDismissedLatestActionKey(latestAction.dismissKey)
							}}
						>
							&times;
						</button>
					)}
					<EntityCard className={latestAction.embedInCard === true ? 'transaction-status-card embedded' : 'transaction-status-card'} title={latestAction.title} variant='compact'>
						<ul className='status-list hashes'>
							{latestAction.rows.map(row => (
								<li key={row.label}>
									<span>{row.label}</span>
									<strong>{row.value}</strong>
								</li>
							))}
						</ul>
					</EntityCard>
				</div>
			)}
		</div>
	)
}
