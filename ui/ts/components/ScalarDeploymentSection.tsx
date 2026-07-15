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
import {
	UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED,
	UI_STRING_CHILD_UNIVERSE_NOT_ALREADY_DEPLOYED,
	UI_STRING_CHILD_UNIVERSES,
	UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED,
	UI_STRING_CONFIRM_THE_SELECTED_SCALAR_OUTCOME_AND_DEPLOY_ITS_CHILD_UNIVERSE_IN_ONE_BOUNDED_EXECUTION_FLOW,
	UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE,
	UI_STRING_CREATE_CHILD_UNIVERSE,
	UI_STRING_CREATE_CHILD_UNIVERSE_TITLE,
	UI_STRING_CREATE_INVALID_UNIVERSE,
	UI_STRING_DEPLOY_INVALID_UNIVERSE,
	UI_STRING_DEPLOY_UNIVERSE,
	UI_STRING_DEPLOYED,
	UI_STRING_DEPLOYING_UNIVERSE,
	UI_STRING_EXISTING_CHILD_UNIVERSES,
	UI_STRING_INVALID,
	UI_STRING_LOADING_SCALAR_RANGE,
	UI_STRING_NO_CHILD_UNIVERSE_SELECTED,
	UI_STRING_NO_DEPLOYED_CHILD_UNIVERSES,
	UI_STRING_OPENING,
	UI_STRING_SCALAR_FORKS_CAN_DEPLOY_ONE_OUTCOME_UNIVERSE_AT_A_TIME,
	UI_STRING_SELECT_CHILD_UNIVERSE,
	UI_STRING_SELECTED_CHILD_UNIVERSE,
	UI_STRING_SELECTED_TICK_IS_INVALID,
	UI_STRING_UNIVERSE_IS_FORKED,
	UI_STRING_WALLET_CONNECTED,
	UI_TEMPLATE_SELECTED_TICK_LABEL,
} from '../lib/uiStrings.js'
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
			<WorkflowSubsection title={UI_STRING_CHILD_UNIVERSES}>
				<p className='detail'>
					<LoadingText>{UI_STRING_LOADING_SCALAR_RANGE}</LoadingText>
				</p>
			</WorkflowSubsection>
		)
	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? UI_STRING_INVALID : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists
	const deployReason = (() => {
		if (accountAddress === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE
		if (!isMainnet) return undefined

		return (() => {
			if (!hasForked) return UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED
			if (selectedScalarChildExists) return UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED

			return scalarDeployError
		})()
	})()
	const scalarDeployPending = zoltarChildUniversePendingOutcomeIndex === selectedScalarOutcomeIndex
	const scalarDeployRequirements = [
		{ key: 'forked', label: UI_STRING_UNIVERSE_IS_FORKED, resolved: hasForked, ...(hasForked ? {} : { detail: UI_STRING_CHILD_UNIVERSES_UNAVAILABLE_BECAUSE_UNIVERSE_HAS_NOT_FORKED }) },
		{ key: 'wallet', label: UI_STRING_WALLET_CONNECTED, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: UI_STRING_CONNECT_A_WALLET_BEFORE_DEPLOYING_A_CHILD_UNIVERSE }) },
		{ key: 'exists', label: UI_STRING_CHILD_UNIVERSE_NOT_ALREADY_DEPLOYED, resolved: !selectedScalarChildExists, ...(selectedScalarChildExists ? { detail: UI_STRING_CHILD_UNIVERSE_ALREADY_DEPLOYED } : {}) },
	]
	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])
	return (
		<WorkflowSubsection badge={<span className='detail'>{UI_STRING_SCALAR_FORKS_CAN_DEPLOY_ONE_OUTCOME_UNIVERSE_AT_A_TIME}</span>} title={UI_STRING_CHILD_UNIVERSES}>
			<ChildUniversesSection childUniverses={childUniverses} emptyMessage={UI_STRING_NO_DEPLOYED_CHILD_UNIVERSES} headerTitle={UI_STRING_EXISTING_CHILD_UNIVERSES} renderBadge={child => <ChildUniverseStatusBadge child={child} />} renderBody={child => <ChildUniverseDetails child={child} />} />
			<ScalarOutcomePicker
				action={
					<ActionLauncherButton
						idleLabel={(() => {
							if (selectedScalarChildExists) return UI_STRING_DEPLOYED
							if (scalarOutcomeInvalid) return UI_STRING_CREATE_INVALID_UNIVERSE

							return UI_STRING_CREATE_CHILD_UNIVERSE
						})()}
						pendingLabel={UI_STRING_OPENING}
						onClick={() => {
							try {
								setScalarDeployError(undefined)
								setDeployModalOpen(true)
							} catch (error) {
								setScalarDeployError(error instanceof Error ? error.message : UI_STRING_SELECTED_TICK_IS_INVALID)
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
				label={UI_STRING_SELECT_CHILD_UNIVERSE}
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
				selectedTickLabel={scalarOutcomeInvalid ? UI_STRING_INVALID : UI_TEMPLATE_SELECTED_TICK_LABEL(clampedScalarOutcomeTick, questionDetails.numTicks.toString())}
			/>
			<ChildUniverseDeploymentModal
				actionAvailability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
				description={UI_STRING_CONFIRM_THE_SELECTED_SCALAR_OUTCOME_AND_DEPLOY_ITS_CHILD_UNIVERSE_IN_ONE_BOUNDED_EXECUTION_FLOW}
				idleLabel={scalarOutcomeInvalid ? UI_STRING_DEPLOY_INVALID_UNIVERSE : UI_STRING_DEPLOY_UNIVERSE}
				isOpen={deployModalOpen}
				onClose={() => setDeployModalOpen(false)}
				onConfirm={() => onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex)}
				pending={scalarDeployPending}
				pendingLabel={UI_STRING_DEPLOYING_UNIVERSE}
				requirements={scalarDeployRequirements}
				title={UI_STRING_CREATE_CHILD_UNIVERSE_TITLE}
			>
				{selectedScalarChild === undefined ? undefined : (
					<ChildUniversesSection childUniverses={[selectedScalarChild]} emptyMessage={UI_STRING_NO_CHILD_UNIVERSE_SELECTED} headerTitle={UI_STRING_SELECTED_CHILD_UNIVERSE} renderBadge={child => <ChildUniverseStatusBadge child={child} />} renderBody={child => <ChildUniverseDetails child={child} />} />
				)}
			</ChildUniverseDeploymentModal>
			<ErrorNotice message={scalarDeployError} />
			<ErrorNotice message={zoltarChildUniverseError} />
		</WorkflowSubsection>
	)
}
