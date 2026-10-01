import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { Fragment } from 'preact'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { StatoblastSecurityPoolLink } from '../../security-pools/components/StatoblastSecurityPoolLink.js'
import type { useForkAuctionSectionState } from '../hooks/useForkAuctionSectionState.js'
import { createForkAuctionActionRenderer, ForkAuctionEndedNotice, ForkAuctionOutcomePoolNotice } from './ForkAuctionActionSections.js'
import { ForkAuctionMigrationBalances } from './ForkAuctionMigrationStage.js'
import { renderTruthAuctionPriceValue } from './ForkAuctionPresentation.js'

type ForkAuctionSectionModel = ReturnType<typeof useForkAuctionSectionState>

/** Renders the fork auction view model's display values, notices, and stage action buttons. */
export function renderForkAuctionSectionDisplays(model: ForkAuctionSectionModel) {
	const currentTimestampProps = model.effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: model.effectiveCurrentTimestamp }
	const renderSelectedOutcomeChildPoolNotice = () => (
		<ForkAuctionOutcomePoolNotice error={model.selectedAuctionChildPoolRecoveryError} loading={model.loadingSelectedAuctionChildPoolRecovery} onRetry={model.retrySelectedAuctionChildPoolRecovery} outcomeLabel={model.selectedOutcomeLabel} poolAvailable={model.selectedAuctionChildPool !== undefined} />
	)
	const renderSelectedOutcomeChildPoolLink = () => {
		if (model.selectedAuctionChildPool === undefined) return undefined
		return (
			<StatoblastSecurityPoolLink className='fork-workflow-outcome-link' securityPoolAddress={model.selectedAuctionChildPool.securityPoolAddress} universeId={model.selectedAuctionChildPool.universeId}>
				{forkAuctionCopy.childPool}
			</StatoblastSecurityPoolLink>
		)
	}
	const renderStageActionButton = createForkAuctionActionRenderer(model.stageActionContext)
	const finalizeTruthAuctionAction = renderStageActionButton({
		action: 'finalizeTruthAuction',
		availability: createActionAvailability(model.finalizeTruthAuctionGuardMessage),
		forceEnabled: model.hasSelectedAuctionChildPool,
		idleLabel: forkAuctionCopy.finalizeTruthAuction,
		onClick: model.onFinalizeTruthAuctionForSelectedAuction,
		pendingLabel: forkAuctionCopy.finalizingTruthAuctionTruncated,
		tone: 'primary',
	})
	const { truthAuctionStatus } = model
	return {
		clearingPriceDisplay: (() => {
			if (truthAuctionStatus === undefined) return model.truthAuctionFallback
			return truthAuctionStatus.hitCap ? renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice) : forkAuctionCopy.notYetCleared
		})(),
		endsDisplay: model.endsDisplay.kind === 'text' ? model.endsDisplay.text : <TimestampValue {...currentTimestampProps} timestamp={model.endsDisplay.timestamp} />,
		ethRaisedCapDisplay:
			truthAuctionStatus === undefined ? (
				model.truthAuctionFallback
			) : (
				<Fragment>
					<CurrencyValue value={model.displayedEthRaisedAttoEth} suffix={commonCopy.eth} /> / <CurrencyValue value={truthAuctionStatus.attoEthRaiseCap} suffix={commonCopy.eth} />
				</Fragment>
			),
		migrationBalancesContent: (
			<ForkAuctionMigrationBalances
				accountConnected={model.accountState.address !== undefined}
				connectedWalletVaultSummary={model.connectedWalletVaultSummary}
				effectiveDisputeStakedAttoRep={model.effectiveDisputeStakedAttoRep}
				onSelectedOutcomeChange={selectedOutcome => model.onForkAuctionFormChange({ selectedOutcome })}
				renderSelectedOutcomeChildPoolLink={renderSelectedOutcomeChildPoolLink}
				renderSelectedOutcomeChildPoolNotice={renderSelectedOutcomeChildPoolNotice}
				selectedOutcome={model.forkAuctionForm.selectedOutcome}
				selectedOutcomeMigrationChildPool={model.selectedOutcomeMigrationChildPool}
				selectedOutcomeMigrationChildVault={model.selectedOutcomeMigrationChildVault}
			/>
		),
		migrationStatusBadge: <Badge tone={model.migrationStateBadge.tone}>{model.migrationStateBadge.label}</Badge>,
		renderSelectedOutcomeChildPoolLink,
		renderSelectedOutcomeChildPoolNotice,
		renderStageActionButton,
		startedDisplay: model.startedDisplay.kind === 'text' ? model.startedDisplay.text : <TimestampValue timestamp={model.startedDisplay.timestamp} />,
		truthAuctionEndedNotice:
			truthAuctionStatus === undefined ? undefined : <ForkAuctionEndedNotice actionButton={finalizeTruthAuctionAction} currentTimestamp={model.effectiveCurrentTimestamp} finalized={truthAuctionStatus.finalized} onOpenSettlement={model.openSettlementStage} truthAuctionEndsAt={model.truthAuctionEndsAt} />,
	}
}
