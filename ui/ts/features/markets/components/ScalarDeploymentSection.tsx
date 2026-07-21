import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { ChildUniversesSection, ChildUniverseStatusBadge } from '../../universes/components/ChildUniversesSection.js'
import { ActionLauncherButton } from '../../../components/ActionLauncherButton.js'
import { ChildUniverseDetails } from '../../universes/components/ChildUniverseDetails.js'
import { ChildUniverseDeploymentModal } from '../../universes/components/ChildUniverseDeploymentModal.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { WorkflowSubsection } from '../../../components/WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
import type { MarketDetails, ZoltarChildUniverseSummary } from '../../../types/contracts.js'
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
			<WorkflowSubsection title={marketCopy.childUniverses}>
				<p className='detail'>
					<LoadingText>{marketCopy.loadingScalarRange}</LoadingText>
				</p>
			</WorkflowSubsection>
		)
	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists
	const deployReason = (() => {
		if (accountAddress === undefined) return marketCopy.childDeploymentWalletRequiredReason
		if (!isMainnet) return commonCopy.mainnetRequiredReason

		return (() => {
			if (!hasForked) return marketCopy.childUniversesNotForkedReason
			if (selectedScalarChildExists) return marketCopy.childUniverseDeployedReason

			return scalarDeployError
		})()
	})()
	const scalarDeployPending = zoltarChildUniversePendingOutcomeIndex === selectedScalarOutcomeIndex
	const scalarDeployRequirements = [
		{ key: 'forked', label: marketCopy.universeIsForked, resolved: hasForked, ...(hasForked ? {} : { detail: marketCopy.childUniversesNotForkedReason }) },
		{ key: 'wallet', label: marketCopy.walletConnected, resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: marketCopy.childDeploymentWalletRequiredReason }) },
		{ key: 'exists', label: marketCopy.childUniverseNotAlreadyDeployed, resolved: !selectedScalarChildExists, ...(selectedScalarChildExists ? { detail: marketCopy.childUniverseDeployedReason } : {}) },
	]
	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])
	return (
		<WorkflowSubsection badge={<span className='detail'>{marketCopy.scalarChildDeploymentHint}</span>} title={marketCopy.childUniverses}>
			<ChildUniversesSection childUniverses={childUniverses} emptyMessage={marketCopy.deployedChildUniversesEmpty} headerTitle={marketCopy.existingChildUniverses} renderBadge={child => <ChildUniverseStatusBadge child={child} />} renderBody={child => <ChildUniverseDetails child={child} />} surface='flat' />
			<ScalarOutcomePicker
				action={
					<ActionLauncherButton
						idleLabel={(() => {
							if (selectedScalarChildExists) return commonCopy.deployed
							if (scalarOutcomeInvalid) return marketCopy.createInvalidUniverse

							return marketCopy.createChildUniverse
						})()}
						pendingLabel={commonCopy.opening}
						onClick={() => {
							try {
								setScalarDeployError(undefined)
								setDeployModalOpen(true)
							} catch (error) {
								setScalarDeployError(error instanceof Error ? error.message : marketCopy.selectedTickInvalidError)
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
				label={marketCopy.selectChildUniverse}
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
				selectedTickLabel={scalarOutcomeInvalid ? commonCopy.invalid : commonCopy.formatSelectedTickLabel(clampedScalarOutcomeTick, questionDetails.numTicks.toString())}
			/>
			<ChildUniverseDeploymentModal
				actionAvailability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
				idleLabel={scalarOutcomeInvalid ? marketCopy.deployInvalidUniverse : marketCopy.deployUniverse}
				isOpen={deployModalOpen}
				onClose={() => setDeployModalOpen(false)}
				onConfirm={() => onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex)}
				pending={scalarDeployPending}
				pendingLabel={marketCopy.deployingUniverse}
				requirements={scalarDeployRequirements}
				title={marketCopy.createChildUniverseTitle}
			>
				{selectedScalarChild === undefined ? undefined : (
					<ChildUniversesSection childUniverses={[selectedScalarChild]} emptyMessage={marketCopy.childUniverseSelectionEmpty} headerTitle={marketCopy.selectedChildUniverse} renderBadge={child => <ChildUniverseStatusBadge child={child} />} renderBody={child => <ChildUniverseDetails child={child} />} surface='flat' />
				)}
			</ChildUniverseDeploymentModal>
			<ErrorNotice message={scalarDeployError} />
			<ErrorNotice message={zoltarChildUniverseError} />
		</WorkflowSubsection>
	)
}
