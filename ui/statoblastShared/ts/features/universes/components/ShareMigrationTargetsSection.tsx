import * as tradingCopy from '../../../copy/trading.js'
import type { ComponentChildren } from 'preact'
import { ForkTargetPicker, type ForkTargetOption } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkTargetPicker.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { formatScalarOutcomeIndexLabel, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { MarketDetails, ZoltarChildUniverseSummary, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type ShareMigrationTargetsSectionProps = {
	disabled: boolean
	loading?: boolean
	forkUniverse: ZoltarUniverseSummary | undefined
	onClearOutcomeIndexes: () => void
	onSelectAllOutcomeIndexes: () => void
	onToggleOutcomeIndex: (outcomeIndex: bigint) => void
	selectedOutcomeIndexes: bigint[]
}

function childTargetOption(child: Pick<ZoltarChildUniverseSummary, 'exists' | 'outcomeIndex' | 'outcomeLabel'>): ForkTargetOption {
	return { label: child.outcomeLabel, outcomeIndex: child.outcomeIndex, status: child.exists ? { label: tradingCopy.childDeployed, tone: 'ok' } : { label: tradingCopy.childNotDeployed, tone: 'warning' } }
}

function scalarTargetOption(childUniverseByOutcomeIndex: ReadonlyMap<string, ZoltarChildUniverseSummary>, scalarQuestion: MarketDetails, outcomeIndex: bigint): ForkTargetOption {
	const childUniverse = childUniverseByOutcomeIndex.get(outcomeIndex.toString())
	if (childUniverse !== undefined) return childTargetOption(childUniverse)
	const descriptor = getScalarOutcomeIndexDescriptor(scalarQuestion, outcomeIndex)
	const label = descriptor.kind === 'malformed' ? tradingCopy.formatMalformedOutcomeLabel(outcomeIndex.toString()) : formatScalarOutcomeIndexLabel(scalarQuestion, outcomeIndex)
	return { label, outcomeIndex, status: { label: tradingCopy.childNotDeployed, tone: 'warning' } }
}

function renderUnavailableSection(children: ComponentChildren) {
	return (
		<WorkflowSubsection className='fork-target-picker' title={tradingCopy.targetChildUniverses}>
			<p className='detail'>{children}</p>
		</WorkflowSubsection>
	)
}

export function ShareMigrationTargetsSection({ disabled, loading = false, forkUniverse, onClearOutcomeIndexes, onSelectAllOutcomeIndexes, onToggleOutcomeIndex, selectedOutcomeIndexes }: ShareMigrationTargetsSectionProps) {
	if (forkUniverse === undefined) return renderUnavailableSection(loading ? <LoadingText>{tradingCopy.loadingForkTargetUniverses}</LoadingText> : tradingCopy.forkDetailsUnavailable)
	if (!forkUniverse.hasForked) return renderUnavailableSection(tradingCopy.childTargetsLockedReason)
	if (forkUniverse.forkQuestionDetails === undefined) return renderUnavailableSection(loading ? <LoadingText>{tradingCopy.loadingForkQuestionDetails}</LoadingText> : tradingCopy.forkDetailsUnavailable)

	const clearAction = (
		<button className='quiet' type='button' onClick={onClearOutcomeIndexes} disabled={disabled || selectedOutcomeIndexes.length === 0}>
			{tradingCopy.clear}
		</button>
	)
	if (forkUniverse.forkQuestionDetails.marketType !== 'scalar') {
		const childUniverses = forkUniverse.childUniverses
		return (
			<ForkTargetPicker
				actions={
					<div className='actions'>
						<button className='quiet' type='button' onClick={onSelectAllOutcomeIndexes} disabled={disabled || childUniverses.length === 0}>
							{tradingCopy.selectAll}
						</button>
						{clearAction}
					</div>
				}
				disabled={disabled}
				onToggle={onToggleOutcomeIndex}
				question={{ kind: 'categorical', targets: childUniverses.map(childTargetOption) }}
				selectedOutcomeIndexes={selectedOutcomeIndexes}
				title={tradingCopy.targetChildUniverses}
			/>
		)
	}

	const scalarQuestion = forkUniverse.forkQuestionDetails
	const childUniverseByOutcomeIndex = new Map(forkUniverse.childUniverses.map(child => [child.outcomeIndex.toString(), child]))
	return (
		<ForkTargetPicker
			actions={clearAction}
			disabled={disabled}
			onToggle={onToggleOutcomeIndex}
			question={{
				kind: 'scalar',
				deployedTargets: forkUniverse.childUniverses.filter(child => child.exists).map(childTargetOption),
				details: scalarQuestion,
				resolveTarget: outcomeIndex => scalarTargetOption(childUniverseByOutcomeIndex, scalarQuestion, outcomeIndex),
			}}
			selectedOutcomeIndexes={selectedOutcomeIndexes}
			title={tradingCopy.targetChildUniverses}
		/>
	)
}
