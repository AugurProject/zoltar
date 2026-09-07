import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { LoadingAwareText, LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { ActiveReportingDetails, ListedSecurityPool, ReportingDetails, ReportingOutcomeKey, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { EscalationDepositSelectionList } from '@zoltar/ui-zoltar/features/reporting/components/EscalationDepositSelectionList.js'
import { getEscalationDepositClaimAmount } from '@zoltar/ui-zoltar/features/reporting/lib/reportingDomain.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ForkOutcomeMigrationSeedStatus } from '../hooks/useSelectedAuctionReadState.js'
import { renderWorkflowMetricGrid } from './ForkAuctionPresentation.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/lib/actionAvailability.js'
import type { ForkAuctionActionOptions } from './ForkAuctionActionSections.js'

function getUnresolvedMigrationDetail({
	activeReportingDetails,
	hasStoredEscalationMigrationEntitlement,
	hasUnresolvedMigrationDeposits,
	isMigrationExpired,
	loadingReportingDetails,
}: {
	activeReportingDetails: ActiveReportingDetails | undefined
	hasStoredEscalationMigrationEntitlement: boolean
	hasUnresolvedMigrationDeposits: boolean
	isMigrationExpired: boolean
	loadingReportingDetails: boolean
}) {
	if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredDetail
	if (loadingReportingDetails) return forkAuctionCopy.walletUnresolvedDepositsLoading
	if (activeReportingDetails === undefined) return forkAuctionCopy.unresolvedDepositDetailsUnavailable
	if (hasStoredEscalationMigrationEntitlement) return forkAuctionCopy.capturedEntitlementDetail
	if (!hasUnresolvedMigrationDeposits) return forkAuctionCopy.walletUnresolvedDepositsEmpty
	return forkAuctionCopy.unresolvedEscalationMigrationWithVaultDetail
}

export function ForkAuctionMigrationBalances({
	accountConnected,
	connectedWalletVaultSummary,
	effectiveDisputeStakedAttoRep,
	onSelectedOutcomeChange,
	renderSelectedOutcomeChildPoolLink,
	renderSelectedOutcomeChildPoolNotice,
	selectedOutcome,
	selectedOutcomeMigrationChildPool,
	selectedOutcomeMigrationChildVault,
}: {
	accountConnected: boolean
	connectedWalletVaultSummary: SecurityPoolVaultSummary | undefined
	effectiveDisputeStakedAttoRep: bigint | undefined
	onSelectedOutcomeChange: (outcome: ReportingOutcomeKey) => void
	renderSelectedOutcomeChildPoolLink: () => ComponentChildren
	renderSelectedOutcomeChildPoolNotice: () => ComponentChildren
	selectedOutcome: ReportingOutcomeKey
	selectedOutcomeMigrationChildPool: ListedSecurityPool | undefined
	selectedOutcomeMigrationChildVault: SecurityPoolVaultSummary | undefined
}) {
	if (!accountConnected) return <p className='detail'>{forkAuctionCopy.parentBalancesWalletRequired}</p>
	if (connectedWalletVaultSummary === undefined) return <p className='detail'>{forkAuctionCopy.parentVaultBalancesUnavailableDetail}</p>
	return (
		<>
			{renderWorkflowMetricGrid([
				{ label: commonCopy.repCollateral, value: <CurrencyValue value={connectedWalletVaultSummary.vaultAttoRepBacking} suffix={commonCopy.rep} /> },
				{ label: commonCopy.capacityOwnershipAttoRep, value: <CurrencyValue value={connectedWalletVaultSummary.capacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
				{ label: commonCopy.disputeStakedAttoRep, value: <CurrencyValue value={effectiveDisputeStakedAttoRep ?? 0n} suffix={commonCopy.rep} /> },
			])}
			<div className='form-grid fork-workflow-outcome-selector'>
				<label className='field'>
					<span>{commonCopy.outcome}</span>
					<div className='fork-workflow-outcome-selector-row'>
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={selectedOutcome} onChange={onSelectedOutcomeChange} />
						{renderSelectedOutcomeChildPoolLink()}
					</div>
				</label>
			</div>
			{renderSelectedOutcomeChildPoolNotice()}
			{selectedOutcomeMigrationChildPool === undefined ? undefined : (
				<>
					<p className='detail'>{forkAuctionCopy.migratedBalancesForThisOutcome}</p>
					{renderWorkflowMetricGrid([
						{ label: forkAuctionCopy.selectedOutcomeRepCollateral, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.vaultAttoRepBacking ?? 0n} suffix={commonCopy.rep} /> },
						{ label: forkAuctionCopy.selectedOutcomeCapacityOwnershipAttoRep, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.capacityOwnershipAttoRep ?? 0n} suffix={commonCopy.rep} /> },
					])}
				</>
			)}
		</>
	)
}

export function ForkAuctionMigrationStage({
	accountConnected,
	activeReportingDetails,
	claimParentDepositsGuardMessage,
	claimSelectionDisabled,
	connectedWalletVaultSummary,
	disabled,
	hasSelectedParentEscalationClaimDeposits,
	hasStoredEscalationMigrationEntitlement,
	hasUnresolvedMigrationDeposits,
	hasUnresolvedMigrationState,
	hasWalletParentEscalationClaimBalance,
	hasWalletVaultMigrationBalance,
	isMigrationExpired,
	isVaultMigrationComplete,
	loadingReportingDetails,
	loadingSelectedOutcomeMigrationSeedStatus,
	migratePoolGuardMessage,
	migrateUnresolvedGuardMessage,
	migrateVaultGuardMessage,
	migrationBalancesContent,
	migrationSummaryCard,
	onParentDepositSelectionChange,
	onClaimParentDeposits,
	onMigratePool,
	onMigrateUnresolved,
	onMigrateVault,
	renderAction,
	reportingDetails,
	retrySelectedOutcomeMigrationSeedStatus,
	selectedOutcome,
	selectedOutcomeLabel,
	selectedOutcomeMigrationSeedStatus,
	selectedOutcomeMigrationSeedStatusError,
	selectedParentEscalationClaimDeposits,
	selectedParentEscalationClaimDepositIndexes,
	selectedStageAheadMessage,
}: {
	accountConnected: boolean
	activeReportingDetails: ActiveReportingDetails | undefined
	claimParentDepositsGuardMessage: string | undefined
	claimSelectionDisabled: boolean
	connectedWalletVaultSummary: SecurityPoolVaultSummary | undefined
	disabled: boolean
	hasSelectedParentEscalationClaimDeposits: boolean
	hasStoredEscalationMigrationEntitlement: boolean
	hasUnresolvedMigrationDeposits: boolean
	hasUnresolvedMigrationState: boolean
	hasWalletParentEscalationClaimBalance: boolean
	hasWalletVaultMigrationBalance: boolean
	isMigrationExpired: boolean
	isVaultMigrationComplete: boolean
	loadingReportingDetails: boolean
	loadingSelectedOutcomeMigrationSeedStatus: boolean
	migratePoolGuardMessage: string | undefined
	migrateUnresolvedGuardMessage: string | undefined
	migrateVaultGuardMessage: string | undefined
	migrationBalancesContent: ComponentChildren
	migrationSummaryCard: ComponentChildren
	onParentDepositSelectionChange: (depositIndexes: bigint[]) => void
	onClaimParentDeposits: () => void
	onMigratePool: () => void
	onMigrateUnresolved: () => void
	onMigrateVault: () => void
	renderAction: (options: ForkAuctionActionOptions) => ComponentChildren
	reportingDetails: ReportingDetails | undefined
	retrySelectedOutcomeMigrationSeedStatus: () => void
	selectedOutcome: ReportingOutcomeKey
	selectedOutcomeLabel: string
	selectedOutcomeMigrationSeedStatus: ForkOutcomeMigrationSeedStatus | undefined
	selectedOutcomeMigrationSeedStatusError: string | undefined
	selectedParentEscalationClaimDeposits: ActiveReportingDetails['sides'][number]['userDeposits']
	selectedParentEscalationClaimDepositIndexes: bigint[]
	selectedStageAheadMessage: string | undefined
}) {
	const migrateUnresolvedAction = renderAction({
		action: 'migrateUnresolvedEscalation',
		availability: createActionAvailability(migrateUnresolvedGuardMessage),
		idleLabel: forkAuctionCopy.formatMigrateUnresolvedEscalationToValue(selectedOutcomeLabel),
		onClick: onMigrateUnresolved,
		pendingLabel: forkAuctionCopy.migratingUnresolvedEscalationTruncated,
		tone: 'primary',
	})
	const claimParentDepositsAction = renderAction({
		action: 'claimParentEscalationDeposits',
		availability: createActionAvailability(claimParentDepositsGuardMessage),
		idleLabel: forkAuctionCopy.formatClaimSelectedValueParentDeposits(selectedOutcomeLabel),
		onClick: onClaimParentDeposits,
		pendingLabel: forkAuctionCopy.claimingParentEscalationDepositsTruncated,
	})
	const migratePoolAction = renderAction({ action: 'migrateRepToZoltar', availability: createActionAvailability(migratePoolGuardMessage), idleLabel: forkAuctionCopy.formatMigratePoolToValueUniverse(selectedOutcomeLabel), onClick: onMigratePool, pendingLabel: forkAuctionCopy.migratingPoolToUniverseTruncated })
	const migrateVaultAction = renderAction({ action: 'migrateVault', availability: createActionAvailability(migrateVaultGuardMessage), idleLabel: forkAuctionCopy.formatMigrateVaultToValue(selectedOutcomeLabel), onClick: onMigrateVault, pendingLabel: forkAuctionCopy.migratingVault, tone: 'primary' })
	return (
		<fieldset aria-labelledby='fork-workflow-stage-migration' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-migration' role='tabpanel'>
			{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
			{migrationSummaryCard}
			<SectionBlock title={forkAuctionCopy.yourMigrationBalances} variant='embedded' description={forkAuctionCopy.parentWalletBalancesDescription}>
				{migrationBalancesContent}
				{!accountConnected ? undefined : (
					<>
						{hasUnresolvedMigrationState ? (
							<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.clearUnresolvedParentEscalationDepositAccounting} variant='embedded'>
								<p className='detail'>
									<LoadingAwareText>{getUnresolvedMigrationDetail({ activeReportingDetails, hasStoredEscalationMigrationEntitlement, hasUnresolvedMigrationDeposits, isMigrationExpired, loadingReportingDetails })}</LoadingAwareText>
								</p>
								{activeReportingDetails === undefined || hasStoredEscalationMigrationEntitlement
									? undefined
									: activeReportingDetails.sides.map(side => (
											<div className='field' key={side.key}>
												<span>{side.label}</span>
												{side.userDeposits.length === 0 ? (
													<p className='detail'>{forkAuctionCopy.formatNoUnresolvedDeposits(side.label.toLowerCase())}</p>
												) : (
													<EscalationDepositSelectionList
														disabled
														items={side.userDeposits.map(deposit => ({
															deposit,
															details: [
																<>
																	{forkAuctionCopy.initiallyDepositedLead}
																	<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
																</>,
															],
															secondaryDetails: [
																<>
																	{forkAuctionCopy.entryDepthLead}
																	<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
																</>,
															],
														}))}
														onSelectionChange={() => undefined}
														selectedDepositIndexes={side.userDeposits.map(deposit => deposit.depositIndex)}
													/>
												)}
											</div>
										))}
								{isMigrationExpired ? undefined : <div className='actions'>{migrateUnresolvedAction}</div>}
							</SectionBlock>
						) : (
							<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.claimResolvedParentEscalationDeposits} variant='embedded'>
								<p className='detail'>{forkAuctionCopy.resolvedParentDepositClaimDetail}</p>
								{connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? <p className='detail'>{forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail}</p> : undefined}
								{loadingReportingDetails ? (
									<p className='detail'>
										<LoadingText>{forkAuctionCopy.walletEscalationDepositsLoading}</LoadingText>
									</p>
								) : undefined}
								{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>{forkAuctionCopy.escalationDepositDetailsUnavailable}</p>}
								{!loadingReportingDetails && reportingDetails?.status === 'active' && !hasSelectedParentEscalationClaimDeposits ? <p className='detail'>{forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel)}</p> : undefined}
								{!loadingReportingDetails && reportingDetails?.status === 'active' && hasSelectedParentEscalationClaimDeposits ? (
									<div className='field'>
										<span>{forkAuctionCopy.chooseParentDepositsToClaim}</span>
										<EscalationDepositSelectionList
											disabled={claimSelectionDisabled}
											items={selectedParentEscalationClaimDeposits.map(deposit => {
												const claimAmount = getEscalationDepositClaimAmount(reportingDetails, selectedOutcome, deposit)
												return {
													deposit,
													details: [
														<>
															{forkAuctionCopy.initiallyDepositedLead}
															<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
														</>,
														claimAmount === undefined ? (
															forkAuctionCopy.worthNowPendingClaimFinalization
														) : (
															<>
																{forkAuctionCopy.worthNowLead}
																<CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
															</>
														),
													],
													secondaryDetails: [
														<>
															{forkAuctionCopy.entryDepthLead}
															<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
														</>,
													],
												}
											})}
											onSelectionChange={onParentDepositSelectionChange}
											selectedDepositIndexes={selectedParentEscalationClaimDepositIndexes}
										/>
									</div>
								) : undefined}
								<div className='actions'>{claimParentDepositsAction}</div>
							</SectionBlock>
						)}
						<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migratePoolToUniverse} variant='embedded'>
							<p className='detail'>{forkAuctionCopy.poolRepMigrationDetail}</p>
							{loadingSelectedOutcomeMigrationSeedStatus ? (
								<p className='detail'>
									<LoadingText>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</LoadingText>
								</p>
							) : undefined}
							{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : (
								<>
									<ErrorNotice message={selectedOutcomeMigrationSeedStatusError} />
									<div className='actions'>
										<button className='secondary' onClick={retrySelectedOutcomeMigrationSeedStatus} type='button'>
											{forkAuctionCopy.retryPoolRepReadiness}
										</button>
									</div>
								</>
							)}
							{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
								<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalanceAttoRep > 0n ? forkAuctionCopy.poolRepAlreadyMigratedDetail : forkAuctionCopy.poolRepStagedForVaultMigrationDetail}</p>
							)}
							<div className='actions'>{migratePoolAction}</div>
						</SectionBlock>
						<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migrateVaultTitle} variant='embedded'>
							<p className='detail'>{forkAuctionCopy.vaultMigrationDetail}</p>
							{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>{forkAuctionCopy.poolMigrationCapacityEmpty}</p> : undefined}
							{loadingSelectedOutcomeMigrationSeedStatus ? (
								<p className='detail'>
									<LoadingText>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</LoadingText>
								</p>
							) : undefined}
							<div className='actions'>{migrateVaultAction}</div>
							{isVaultMigrationComplete ? <p className='detail'>{forkAuctionCopy.alreadyMigratedStatus}</p> : undefined}
						</SectionBlock>
					</>
				)}
			</SectionBlock>
		</fieldset>
	)
}
