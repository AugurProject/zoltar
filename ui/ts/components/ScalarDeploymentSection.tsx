import { useRef, useState } from 'preact/hooks'
import type { Address } from 'viem'
import { ChildUniversesSection } from './ChildUniversesSection.js'
import { ChildUniverseDetails } from './ChildUniverseDetails.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { ErrorNotice } from './ErrorNotice.js'
import { useEffect } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import { ScalarOutcomePicker } from './ScalarOutcomePicker.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { clampScalarTickIndex, formatScalarOutcomeLabel, getScalarOutcomeIndex } from '../lib/scalarOutcome.js'
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
	const previousPendingOutcomeIndexRef = useRef<bigint | undefined>(undefined)

	if (questionDetails === undefined) {
		return (
			<WorkflowSubsection title='Child Universes'>
				<p className='detail'>
					<LoadingText>Loading scalar range...</LoadingText>
				</p>
			</WorkflowSubsection>
		)
	}

	const selectedScalarTick = BigInt(scalarOutcomeTick)
	const clampedSelectedScalarTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks)
	const clampedScalarOutcomeTick = clampedSelectedScalarTick.toString()
	const selectedScalarOutcomeLabel = scalarOutcomeInvalid ? 'Invalid' : formatScalarOutcomeLabel(questionDetails, clampedSelectedScalarTick)
	const selectedScalarOutcomeIndex = scalarOutcomeInvalid ? 0n : getScalarOutcomeIndex(questionDetails, clampedSelectedScalarTick)
	const selectedScalarChild = childUniverses.find(child => child.outcomeIndex === selectedScalarOutcomeIndex)
	const selectedScalarChildExists = selectedScalarChild?.exists === true
	const canDeployScalarChild = accountAddress !== undefined && isMainnet && hasForked && !selectedScalarChildExists
	const deployReason =
		accountAddress === undefined
			? 'Connect a wallet before deploying a child universe.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before deploying a child universe.'
				: !hasForked
					? 'Fork Zoltar before deploying child universes.'
					: selectedScalarChildExists
						? 'This child universe is already deployed.'
						: scalarDeployError
	const scalarDeployPending = zoltarChildUniversePendingOutcomeIndex === selectedScalarOutcomeIndex
	const scalarDeployRequirements = [
		{ key: 'forked', label: 'Universe is forked', resolved: hasForked, ...(hasForked ? {} : { detail: 'Fork Zoltar before deploying child universes.' }) },
		{ key: 'wallet', label: 'Wallet connected', resolved: accountAddress !== undefined, ...(accountAddress !== undefined ? {} : { detail: 'Connect a wallet before deploying a child universe.' }) },
		{ key: 'mainnet', label: 'Ethereum mainnet selected', resolved: isMainnet, ...(isMainnet ? {} : { detail: 'Switch to Ethereum mainnet before deploying a child universe.' }) },
		{ key: 'exists', label: 'Child universe not already deployed', resolved: !selectedScalarChildExists, ...(selectedScalarChildExists ? { detail: 'This child universe is already deployed.' } : {}) },
	]

	useEffect(() => {
		const nextTick = clampScalarTickIndex(selectedScalarTick, questionDetails.numTicks).toString()
		if (nextTick === scalarOutcomeTick) return
		setScalarOutcomeTick(nextTick)
	}, [questionDetails.numTicks, scalarOutcomeTick, selectedScalarTick])

	useEffect(() => {
		if (previousPendingOutcomeIndexRef.current === undefined || scalarDeployPending) {
			previousPendingOutcomeIndexRef.current = zoltarChildUniversePendingOutcomeIndex
			return
		}
		setDeployModalOpen(false)
		previousPendingOutcomeIndexRef.current = zoltarChildUniversePendingOutcomeIndex
	}, [scalarDeployPending, zoltarChildUniversePendingOutcomeIndex])

	return (
		<WorkflowSubsection badge={<span className='detail'>Scalar forks can deploy one outcome universe at a time.</span>} title='Child Universes'>
			<ChildUniversesSection
				childUniverses={childUniverses}
				emptyMessage='No deployed child universes yet.'
				headerTitle='Existing Child Universes'
				renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
				renderBody={child => <ChildUniverseDetails child={child} />}
			/>
			<ScalarOutcomePicker
				action={
					<TransactionActionButton
						idleLabel={selectedScalarChildExists ? 'Deployed' : scalarOutcomeInvalid ? 'Open Invalid Universe Flow' : 'Open Universe Flow'}
						pendingLabel='Opening...'
						onClick={() => {
							try {
								setScalarDeployError(undefined)
								setDeployModalOpen(true)
							} catch (error) {
								setScalarDeployError(error instanceof Error ? error.message : 'Selected tick is invalid')
							}
						}}
						pending={false}
						tone='secondary'
						availability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
					/>
				}
				details={{
					maxValueLabel: formatScalarOutcomeLabel(questionDetails, questionDetails.numTicks),
					minValueLabel: formatScalarOutcomeLabel(questionDetails, 0n),
					numTicks: questionDetails.numTicks,
				}}
				isInvalid={scalarOutcomeInvalid}
				label='Select Child Universe'
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
				selectedTickLabel={scalarOutcomeInvalid ? 'Invalid' : `${clampedScalarOutcomeTick} / ${questionDetails.numTicks.toString()}`}
			/>
			<ChildUniverseDeploymentModal
				actionAvailability={{ disabled: !canDeployScalarChild || scalarDeployError !== undefined, reason: deployReason }}
				description='Confirm the selected scalar outcome and deploy its child universe in one bounded execution flow.'
				idleLabel={scalarOutcomeInvalid ? 'Deploy Invalid Universe' : 'Deploy Universe'}
				isOpen={deployModalOpen}
				onClose={() => setDeployModalOpen(false)}
				onConfirm={() => onCreateChildUniverseForOutcomeIndex(selectedScalarOutcomeIndex)}
				pending={scalarDeployPending}
				pendingLabel='Deploying universe...'
				requirements={scalarDeployRequirements}
				title='Create Child Universe'
			>
				{selectedScalarChild === undefined ? undefined : (
					<ChildUniversesSection
						childUniverses={[selectedScalarChild]}
						emptyMessage='No child universe selected.'
						headerTitle='Selected Child Universe'
						renderBadge={child => <span className={`badge ${child.exists ? 'ok' : 'pending'}`}>{child.exists ? 'Exists' : 'Not deployed'}</span>}
						renderBody={child => <ChildUniverseDetails child={child} />}
					/>
				)}
			</ChildUniverseDeploymentModal>
			<ErrorNotice message={scalarDeployError} />
			<ErrorNotice message={zoltarChildUniverseError} />
		</WorkflowSubsection>
	)
}
