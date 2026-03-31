import type { Address } from 'viem'
import { EntityCard } from './EntityCard.js'
import { LoadableValue } from './LoadableValue.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

type ForkZoltarSectionProps = {
	accountAddress: Address | undefined
	isMainnet: boolean
	loadingZoltarForkAccess: boolean
	loadingZoltarUniverse: boolean
	onApproveZoltarForkRep: () => void
	onForkZoltar: () => void
	onLoadZoltarUniverse: () => void
	onZoltarForkQuestionIdChange: (questionId: string) => void
	zoltarForkAllowance: bigint | undefined
	zoltarForkError: string | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalance: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function ForkZoltarSection({ accountAddress, isMainnet, loadingZoltarForkAccess, loadingZoltarUniverse, onApproveZoltarForkRep, onForkZoltar, onLoadZoltarUniverse, onZoltarForkQuestionIdChange, zoltarForkAllowance, zoltarForkError, zoltarForkPending, zoltarForkQuestionId, zoltarForkRepBalance, zoltarUniverse }: ForkZoltarSectionProps) {
	const rootUniverse = zoltarUniverse
	const hasForked = rootUniverse?.hasForked === true
	const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalance !== undefined && zoltarForkRepBalance >= rootUniverse.forkThreshold
	const hasEnoughApproval = rootUniverse !== undefined && zoltarForkAllowance !== undefined && zoltarForkAllowance >= rootUniverse.forkThreshold
	const canFork = accountAddress !== undefined && isMainnet && rootUniverse !== undefined && !hasForked && !zoltarForkPending && zoltarForkQuestionId.trim() !== '' && hasEnoughRep && hasEnoughApproval

	return (
		<>
			<EntityCard
				title="Fork Zoltar"
				badge={<span className={`badge ${ hasForked ? 'blocked' : 'ok' }`}>{hasForked ? 'Already forked' : 'Ready'}</span>}
				actions={
					<button className="secondary" onClick={onLoadZoltarUniverse} disabled={loadingZoltarUniverse}>
						{loadingZoltarUniverse ? 'Loading Universe...' : 'Refresh Fork State'}
					</button>
				}
			>
				<div className="workflow-metric-grid">
					<div>
						<span className="metric-label">Your REP Balance</span>
						<strong>
							<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
								{zoltarForkRepBalance === undefined ? 'Loading...' : `${ formatCurrencyBalance(zoltarForkRepBalance) } REP`}
							</LoadableValue>
						</strong>
					</div>
					<div>
						<span className="metric-label">Fork Threshold</span>
						<strong>
							<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
								{rootUniverse === undefined ? 'Loading...' : `${ formatCurrencyBalance(rootUniverse.forkThreshold) } REP`}
							</LoadableValue>
						</strong>
					</div>
					<div>
						<span className="metric-label">REP Approved To Zoltar</span>
						<strong>
							<LoadableValue loading={loadingZoltarForkAccess} placeholder="Loading...">
								{zoltarForkAllowance === undefined ? 'Loading...' : `${ formatCurrencyBalance(zoltarForkAllowance) } REP`}
							</LoadableValue>
						</strong>
					</div>
				</div>

				<div className="form-grid">
					<label className="field">
						<span>Fork Question ID</span>
						{hasForked ? <strong>{zoltarForkQuestionId === '' ? 'Already forked' : zoltarForkQuestionId}</strong> : <input value={zoltarForkQuestionId} onInput={event => onZoltarForkQuestionIdChange(event.currentTarget.value)} placeholder="0x..." disabled={zoltarForkPending} />}
					</label>

					<div className="actions">
						{hasForked ? undefined : (
							<button className="secondary" onClick={onApproveZoltarForkRep} disabled={accountAddress === undefined || !isMainnet || rootUniverse === undefined || zoltarForkPending || hasEnoughApproval}>
								{zoltarForkPending ? 'Waiting...' : hasEnoughApproval ? 'Threshold Approved' : 'Approve REP Threshold'}
							</button>
						)}
						<button onClick={onForkZoltar} disabled={!canFork}>
							{zoltarForkPending ? 'Waiting...' : 'Fork Zoltar'}
						</button>
					</div>

					{rootUniverse === undefined ? undefined : hasForked ? <p className="detail">Zoltar has already forked. The fork action is disabled.</p> : !hasEnoughRep ? <p className="detail">Need {formatCurrencyBalance(rootUniverse.forkThreshold)} REP.</p> : !hasEnoughApproval ? <p className="detail">Approve {formatCurrencyBalance(rootUniverse.forkThreshold)} REP first.</p> : undefined}
				</div>
			</EntityCard>

			{zoltarForkError === undefined ? undefined : <p className="notice error">{zoltarForkError}</p>}
		</>
	)
}
