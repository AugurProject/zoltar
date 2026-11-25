import { useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { OnChainText } from '@zoltar/ui-core-shared/components/OnChainText.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { useUniverseName } from '@zoltar/ui-core-shared/components/UniverseNames.js'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import { formatUniverseIdHex } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { SecurityPoolForkSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { securityPoolUnsignedId } from '../lib/draft.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'
import { invalid } from '../../../copy/forkRecovery.js'
import * as copy from '../../../copy/securityPoolForkDiagram.js'

type KnownChild = Pick<ZoltarChildUniverseSummary, 'outcomeIndex' | 'universeId' | 'exists'>
type BranchChoice = { outcomeIndex: bigint; label: string }

const branchPageSize = 6n

function branchLabel(question: MarketDetails, outcomeIndex: bigint) {
	if (outcomeIndex === 0n) return invalid
	if (question.marketType === 'scalar') {
		const outcome = getScalarOutcomeIndexDescriptor(question, outcomeIndex)
		return outcome.kind === 'tick' ? formatScalarOutcomeLabel(question, outcome.tickIndex) : undefined
	}
	return outcomeIndex <= BigInt(question.outcomeLabels.length) ? question.outcomeLabels[Number(outcomeIndex) - 1] : undefined
}

function BranchNodes({ question, selected, confirmed, knownChildren, branch }: { question: MarketDetails; selected: bigint | undefined; confirmed: boolean; knownChildren: readonly KnownChild[]; branch: SecurityPoolForkSnapshot['branch'] }) {
	const [page, setPage] = useState<{ start: bigint; selected: bigint | undefined }>()
	const scalar = question.marketType === 'scalar'
	const total = scalar ? question.numTicks + 2n : BigInt(question.outcomeLabels.length + 1)
	let selectedOffset = selected ?? 0n
	if (scalar && selected !== undefined) {
		const outcome = getScalarOutcomeIndexDescriptor(question, selected)
		selectedOffset = outcome.kind === 'tick' ? outcome.tickIndex + 1n : 0n
	}
	const initialStart = selectedOffset < total ? (selectedOffset / branchPageSize) * branchPageSize : 0n
	const start = page !== undefined && page.selected === selected ? page.start : initialStart
	const choices: BranchChoice[] = []
	for (let index = start; index < start + branchPageSize && index < total; index++) {
		const outcomeIndex = scalar && index > 0n ? getScalarOutcomeIndex(question, index - 1n) : index
		const label = branchLabel(question, outcomeIndex)
		if (label !== undefined) choices.push({ outcomeIndex, label })
	}
	return (
		<>
			<ul className='statoblast-fork-diagram-branches'>
				{choices.map(({ outcomeIndex, label }) => {
					const child = knownChildren.find(candidate => candidate.outcomeIndex === outcomeIndex)
					const matchingBranch = branch?.outcomeIndex === outcomeIndex ? branch : undefined
					const exists = matchingBranch?.prepared || child?.exists
					const universeId = matchingBranch?.universeId ?? (child?.exists === true ? child.universeId : undefined)
					return (
						<li key={outcomeIndex.toString()} data-chosen={outcomeIndex === selected}>
							<strong>
								<OnChainText text={label} />
							</strong>
							{outcomeIndex === selected && <small>{confirmed ? copy.committed : copy.selected}</small>}
							{universeId !== undefined && <IdentifierValue abbreviated value={formatUniverseIdHex(universeId)} />}
							{exists !== undefined && <small>{exists ? copy.created : copy.notCreated}</small>}
						</li>
					)
				})}
			</ul>
			<PaginationControls
				hasPreviousPage={start > 0n}
				hasNextPage={start + branchPageSize < total}
				onPreviousPage={() => setPage({ start: start - branchPageSize, selected })}
				onNextPage={() => setPage({ start: start + branchPageSize, selected })}
				summary={copy.pageRange(start + 1n, start + BigInt(choices.length), total)}
			/>
		</>
	)
}

export function SecurityPoolForkDiagram({ state, snapshot, question, outcomeInput, childUniverses = [] }: { state: SecurityPoolForkSnapshot | undefined; snapshot: SecurityPoolAccountSnapshot | undefined; question: MarketDetails | undefined; outcomeInput: string; childUniverses?: readonly KnownChild[] | undefined }) {
	const universeId = state?.universeId ?? snapshot?.universeId
	const source = useUniverseName(universeId ?? 0n)
	const forkTime = state?.forkTime ?? snapshot?.forkTime ?? 0n
	if (universeId === undefined || forkTime === 0n) return undefined
	const confirmed = state?.choice.recorded === true
	const selected = confirmed ? state.choice.outcomeIndex : securityPoolUnsignedId(outcomeInput)
	const label = question === undefined || selected === undefined ? undefined : branchLabel(question, selected)
	const branch = state?.branch
	const position = snapshot?.positions.find(position => position.id === snapshot.ownerAccount.positionId)
	const now = state?.timestamp ?? snapshot?.timestamp
	const deadline = state?.choiceDeadline ?? snapshot?.forkChoiceDeadline
	const showMove = !confirmed && position !== undefined && position.rep > 0n && position.commitment > 0n && now !== undefined && deadline !== undefined && now < deadline
	const feesEth = snapshot?.claimableEarnings?.attoEth ?? snapshot?.accruedFeesAttoEth
	const feesRep = snapshot?.claimableEarnings?.attoRep ?? snapshot?.accruedFeesAttoRep
	const unpledgedRep = snapshot?.ownerAccount.freeAttoRep ?? 0n
	return (
		<figure className='statoblast-fork-diagram' aria-label={copy.diagram}>
			<div className='statoblast-fork-diagram-flow'>
				<div className='statoblast-fork-diagram-source'>
					<small>{copy.source}</small>
					<strong>
						<OnChainText text={source} />
					</strong>
				</div>
				<div className='statoblast-fork-diagram-destination' data-selected={selected !== undefined}>
					<small>{copy.destination}</small>
					{label === undefined ? (
						<span>{copy.choose}</span>
					) : (
						<strong>
							<OnChainText text={label} />
						</strong>
					)}
					{showMove && (
						<div className='statoblast-fork-diagram-amounts'>
							<small>{copy.moved}</small>
							<CurrencyValue value={position.rep} suffix={common.rep} />
							<CurrencyValue value={position.commitment} units={snapshot?.collateral.decimals ?? 0} suffix={snapshot?.collateral.symbol ?? ''} />
						</div>
					)}
				</div>
				<div className='statoblast-fork-diagram-stays'>
					<small>{copy.stays}</small>
					<strong>{copy.fees}</strong>
					<div className='statoblast-fork-diagram-amounts'>
						<CurrencyValue value={feesEth} units={snapshot?.collateral.decimals ?? 0} suffix={snapshot?.collateral.symbol ?? ''} />
						<CurrencyValue value={feesRep} suffix={common.rep} />
					</div>
					{unpledgedRep > 0n && (
						<div className='statoblast-fork-diagram-amounts'>
							<small>{copy.unpledged}</small>
							<CurrencyValue value={unpledgedRep} suffix={common.rep} />
						</div>
					)}
				</div>
			</div>
			{question !== undefined && <BranchNodes key={`${universeId}:${question.questionId}`} question={question} selected={selected} confirmed={confirmed} knownChildren={childUniverses} branch={branch} />}
		</figure>
	)
}
