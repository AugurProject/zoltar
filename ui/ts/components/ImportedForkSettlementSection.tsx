import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { SectionBlock } from './SectionBlock.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, EscalationSide, ReportingOutcomeKey } from '../types/contracts.js'

type ImportedForkSettlementActionRenderProps = {
	guardMessage: string | undefined
	outcome: ReportingOutcomeKey
	sideLabel: string
}

type ImportedForkSettlementSectionProps = {
	activeReportingDetails: ActiveReportingDetails | undefined
	disabled: boolean
	onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void
	renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren
	resolved: boolean
	selectedDepositIndexesByOutcome: Record<ReportingOutcomeKey, bigint[]>
	sides: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>[]
}

export function ImportedForkSettlementSection({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexesByOutcome, sides }: ImportedForkSettlementSectionProps) {
	if (sides.length === 0) return undefined

	return (
		<SectionBlock density='compact' title='Settle Fork-Carried Escalation Deposits'>
			<p className='detail'>Imported from the parent universe. Settle these positions in this child pool after finalization.</p>
			{resolved ? undefined : <p className='detail'>Fork-carried escalation deposits can be settled after this child pool finalizes.</p>}
			{sides.map(side => {
				const selectedDepositIndexes = selectedDepositIndexesByOutcome[side.key]
				const settlementGuardMessage = (() => {
					if (!resolved) return 'Fork-carried escalation deposits can be settled after this child pool finalizes.'
					if (selectedDepositIndexes.length === 0) return `Select at least one ${side.label.toLowerCase()} fork-carried deposit to settle.`
					return undefined
				})()
				return (
					<SectionBlock density='compact' headingLevel={4} key={side.key} title={side.label} variant='embedded'>
						<div className='field'>
							<span>Imported from parent universe</span>
							<div className='escalation-selection-list'>
								{side.importedUserDeposits.map(deposit => {
									const selected = selectedDepositIndexes.includes(deposit.parentDepositIndex)
									const claimAmount = getImportedEscalationDepositClaimAmount(activeReportingDetails, side.key, deposit)
									return (
										<label className='escalation-selection-item' key={deposit.parentDepositIndex.toString()}>
											<input checked={selected} disabled={disabled} onChange={event => onDepositSelectionChange(side.key, deposit.parentDepositIndex, event.currentTarget.checked)} type='checkbox' />
											<div className='escalation-selection-item-copy'>
												<strong>Parent deposit #{deposit.parentDepositIndex.toString()}</strong>
												<span>
													Initially deposited: <CurrencyValue value={deposit.amount} suffix='REP' />
												</span>
												<span>
													{claimAmount === undefined ? (
														'Worth now: Pending final settlement'
													) : (
														<>
															Worth now: <CurrencyValue value={claimAmount} suffix='REP' />
														</>
													)}
												</span>
												<span>
													Imported ordering start: <CurrencyValue value={deposit.cumulativeAmount} suffix='REP' />
												</span>
											</div>
										</label>
									)
								})}
							</div>
						</div>
						<div className='actions'>
							{renderSettlementAction({
								guardMessage: settlementGuardMessage,
								outcome: side.key,
								sideLabel: side.label,
							})}
						</div>
					</SectionBlock>
				)
			})}
		</SectionBlock>
	)
}
