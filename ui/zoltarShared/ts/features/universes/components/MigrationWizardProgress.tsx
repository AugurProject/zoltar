import * as zoltarCopy from '../../../copy/zoltar.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { migrationWizardStepIds, type MigrationWizardStep, type MigrationWizardStepId, type MigrationWizardStepStatus } from '../lib/migrationWizard.js'

export function getMigrationStepTitle(stepId: MigrationWizardStepId) {
	switch (stepId) {
		case 'outcomes':
			return zoltarCopy.migrationStepChooseOutcomes
		case 'amount':
			return zoltarCopy.migrationStepAmount
		case 'approve':
			return zoltarCopy.migrationStepApprove
		case 'review':
			return zoltarCopy.migrationStepReview
		default:
			return assertNever(stepId)
	}
}

function getStatusLabel(status: MigrationWizardStepStatus) {
	switch (status) {
		case 'complete':
			return zoltarCopy.migrationStepDone
		case 'notNeeded':
			return zoltarCopy.migrationStepNotNeeded
		case 'ready':
			return zoltarCopy.migrationStepReady
		case 'incomplete':
			return zoltarCopy.migrationStepToDo
		case 'loading':
			return zoltarCopy.migrationStepLoading
		case 'blocked':
			return zoltarCopy.migrationStepBlocked
		default:
			return assertNever(status)
	}
}

type MigrationWizardProgressProps = {
	currentStepId: MigrationWizardStepId
	disabled: boolean
	onSelectStep: (stepId: MigrationWizardStepId) => void
	reachableStepId: MigrationWizardStepId
	steps: readonly MigrationWizardStep[]
	/** Short value shown under a finished step, such as the chosen outcomes or amount. */
	summaries: Partial<Record<MigrationWizardStepId, string>>
}

/** Numbered step list for the migration wizard. Steps up to the furthest reachable one can be reopened. */
export function MigrationWizardProgress({ currentStepId, disabled, onSelectStep, reachableStepId, steps, summaries }: MigrationWizardProgressProps) {
	const reachableIndex = migrationWizardStepIds.indexOf(reachableStepId)
	return (
		<nav aria-label={zoltarCopy.migrationProgress} className='migration-wizard-progress'>
			<ol className='migration-wizard-steps'>
				{steps.map((step, index) => {
					const current = step.id === currentStepId
					const finished = step.status === 'complete' || step.status === 'notNeeded'
					const summary = finished ? summaries[step.id] : undefined
					const statusLabel = current ? undefined : getStatusLabel(step.status)
					return (
						<li className={`migration-wizard-step is-${step.status}${current ? ' is-current' : ''}`} key={step.id}>
							<button aria-current={current ? 'step' : undefined} className='migration-wizard-step-button' disabled={disabled || index > reachableIndex} onClick={() => onSelectStep(step.id)} type='button'>
								<span aria-hidden='true' className='migration-wizard-step-marker'>
									{finished && !current ? '✓' : (index + 1).toString()}
								</span>
								<span className='migration-wizard-step-copy'>
									<span className='migration-wizard-step-title'>{getMigrationStepTitle(step.id)}</span>
									<span className='migration-wizard-step-status'>{summary ?? statusLabel ?? zoltarCopy.migrationStepCurrent}</span>
								</span>
							</button>
						</li>
					)
				})}
			</ol>
		</nav>
	)
}
