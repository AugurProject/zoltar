import { useEffect, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { ChildUniversesSection, ChildUniverseStatusBadge } from './ChildUniversesSection.js'
import { ActionLauncherButton } from './ActionLauncherButton.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { MarketDetails, ZoltarChildUniverseSummary } from '../types/contracts.js'
type ScalarDeploymentSectionProps = {
	accountAddress: Address | undefined
	childUniverses: ZoltarChildUniverseSummary[]
	hasForked: boolean
	isMainnet: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	questionDetails: MarketDetails | undefined
	zoltarChildUniverseError: string | undefined
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
}
export function ScalarDeploymentSection({ accountAddress, childUniverses, hasForked, isMainnet, onCreateChildUniverseForOutcomeIndex, questionDetails, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex }: ScalarDeploymentSectionProps) {
	const [scalarOutcomeTick, setScalarOutcomeTick] = useState('0')
	const [scalarOutcomeInvalid, setScalarOutcomeInvalid] = useState(false)
	const [scalarDeployError, setScalarDeployError] = useState<string | undefined>(undefined)
	const [deployModalOpen, setDeployModalOpen] = useState(false)
	if (questionDetails === undefined)
		return (
			<WorkflowSubsection title={UI_STRINGS.scalarDeploymentSection.childUniversesTitle}>
				<p className='detail'>
					<LoadingText>{UI_STRINGS.scalarDeploymentSection.loadingScalarRangeDetail}</LoadingText>
				</p>
			</WorkflowSubsection>
		)
	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? UI_STRINGS.scalarDeploymentSection.selectedTickInvalidLabel : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists
	const deployReason = (() => {
		if (accountAddress === undefined) return UI_STRINGS.scalarDeploymentSection.connectWalletBeforeDeployingChildUniverseReason
		if (!isMainnet) return undefined

		return (() => {
			if (!hasForked) return UI_STRINGS.scalarDeploymentSection.forkBeforeDeployingChildUniversesReason
			if (selectedScalarChildExists) return UI_STRINGS.scalarDeploymentSection.childUniverseAlreadyDeployedReason

			return scalarDeployError
		})()
	})()
	const scalarDeployPending = zoltarChildUniversePendingOutcomeIndex === selectedScalarOutcomeIndex
	const scalarDeployRequirements = [
		{ key: 'forked', label: UI_STRINGS.scalarDeploymentSection.universeIsForkedLabel, resolved: hasForked, ...(hasForked ? {} : { detail: UI_STRINGS.scalarDeploymentSection.forkBeforeDeployingChildUniversesReason }) },
		{ key: 'wallet', label: UI_STRINGS.scalarDeploymentSection.walletConnectedLabel, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: UI_STRINGS.scalarDeploymentSection.connectWalletBeforeDeployingChildUniverseReason }) },
		{ key: 'exists', label: UI_STRINGS.scalarDeploymentSection.childUniverseNotAlreadyDeployedLabel, resolved: !selectedScalarChildExists, ...(selectedScalarChildExists ? { detail: UI_STRINGS.scalarDeploymentSection.childUniverseAlreadyDeployedDetail } : {}) },
	]
	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])
	return (
		<WorkflowSubsection badge={<span className='detail'>{UI_STRINGS.scalarDeploymentSection.scalarForksCanDeployOneOutcomeUniverseAtATimeDetail}</span>} title={UI_STRINGS.scalarDeploymentSection.childUniversesTitle}>
			<ChildUniversesSection
				childUniverses={childUniverses}
				emptyMessage={UI_STRINGS.scalarDeploymentSection.noDeployedChildUniversesMessage}
				headerTitle={UI_STRINGS.scalarDeploymentSection.existingChildUniversesTitle}
				renderBadge={child => <ChildUniverseStatusBadge child={child} />}
				renderBody={child => <ChildUniverseDetails child={child} />}
			/>
			<ScalarOutcomePicker
				action={
					<ActionLauncherButton
						idleLabel={(() => {
							if (selectedScalarChildExists) return UI_STRINGS.scalarDeploymentSection.deployedLabel
							if (scalarOutcomeInvalid) return UI_STRINGS.scalarDeploymentSection.createInvalidUniverseLabel

							return UI_STRINGS.scalarDeploymentSection.createChildUniverseLabel
						})()}
						pendingLabel={UI_STRINGS.scalarDeploymentSection.openingChildUniversePendingLabel}
						onClick={() => {
							try {
								setScalarDeployError(undefined)
								setDeployModalOpen(true)
							} catch (error) {
								setScalarDeployError(error instanceof Error ? error.message : UI_STRINGS.scalarDeploymentSection.selectedTickInvalidReason)
							}
						}}
						pending={false}
						tone='secondary'
						availability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
						showDisabledReason
					/>
				}
				details={{
					maxValueLabel: formatScalarOutcomeLabel(questionDetails, questionDetails.numTicks),
					minValueLabel: formatScalarOutcomeLabel(questionDetails, 0n),
					numTicks: questionDetails.numTicks,
				}}
				isInvalid={scalarOutcomeInvalid}
				label={UI_STRINGS.scalarDeploymentSection.selectChildUniverseLabel}
				onInvalidChange={invalid => {
					setScalarDeployError(undefined)
					setScalarOutcomeInvalid(invalid)
				}}
				onSelectedTickChange={tick => {
					setScalarDeployError(undefined)
					setScalarOutcomeTick(tick)
				}}
				selectedOutcomeLabel={selectedScalarOutcomeLabel}
				selectedTick={clampedScalarOutcomeTick}
				selectedTickLabel={scalarOutcomeInvalid ? UI_STRINGS.scalarDeploymentSection.selectedTickInvalidLabel : UI_STRINGS.shareMigrationTargetsSection.selectedTickLabel(clampedScalarOutcomeTick, questionDetails.numTicks.toString())}
			/>
			<ChildUniverseDeploymentModal
				actionAvailability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
				description={UI_STRINGS.scalarDeploymentSection.executeChildUniverseDeploymentDescription}
				idleLabel={scalarOutcomeInvalid ? UI_STRINGS.scalarDeploymentSection.deployInvalidUniverseLabel : UI_STRINGS.scalarDeploymentSection.deployUniverseLabel}
				isOpen={deployModalOpen}
				onClose={() => setDeployModalOpen(false)}
				onConfirm={() => onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex)}
				pending={scalarDeployPending}
				pendingLabel={UI_STRINGS.scalarDeploymentSection.deployingUniversePendingLabel}
				requirements={scalarDeployRequirements}
				title={UI_STRINGS.scalarDeploymentSection.createChildUniverseTitle}
			>
				{selectedScalarChild === undefined ? undefined : (
					<ChildUniversesSection
						childUniverses={[selectedScalarChild]}
						emptyMessage={UI_STRINGS.scalarDeploymentSection.noChildUniverseSelectedMessage}
						headerTitle={UI_STRINGS.scalarDeploymentSection.childUniverseSelectedTitle}
						renderBadge={child => <ChildUniverseStatusBadge child={child} />}
						renderBody={child => <ChildUniverseDetails child={child} />}
					/>
				)}
			</ChildUniverseDeploymentModal>
			<ErrorNotice message={scalarDeployError} />
			<ErrorNotice message={zoltarChildUniverseError} />
		</WorkflowSubsection>
	)
}
