import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
export {
	entryDepthLead,
	initiallyDepositedLead,
	worthNowLead,
} from './reportingEscalation.js'

export const bidAmountEth = 'Bid amount (ETH)'
export const bidAmount = 'Bid amount'
export const scrollableAuctionBidHistory = 'Scrollable list of current bids'
export const scrollableMyBids = 'Scrollable list of my bids'
export const clearingPrice = 'Clearing price'
export const closed = 'Closed'
export const escalationDepositDetailsUnavailable = 'Escalation deposit details are unavailable for this pool right now.'
export const ethRaisedPerCap = 'ETH raised / cap'
export const cumulativeBidsEth = 'Cumulative bids (ETH)'
export const loadingCurrentChainTime = 'Loading current chain time…'
export const migrateVaultTitle = 'Migrate vault'
export const migratingVault = 'Migrating vault…'
export const migrationTimingIsUnavailable = 'Migration timing is unavailable.'
export const poolMigrationCapacityEmpty = 'No REP backing or underwriting commitments remain to migrate for the connected wallet.'
export const notStarted = 'Not started'
export const walletUnresolvedDepositsEmpty = 'No unresolved parent escalation deposits remain for the connected wallet.'
export const open = 'Open'
export const priceEthPerRep = 'Price (ETH per REP)'
export const depthChartPriceAxis = 'Price (ETH per REP), highest to lowest'
export const startingTruthAuction = 'Starting truth auction…'
export const startTruthAuction = 'Start truth auction'
export const submitBid = 'Submit bid'
export const formatSubmitBidLabel = (amount: CopyTemplateValue, price: CopyTemplateValue) => `Bid ${amount}\u00a0ETH at ${price}\u00a0ETH per REP`
export const bidAmountHintAvailableLead = 'Available: '
export const bidAmountHintMinimumLead = ' · Min bid '
export const bidAmountHintGasReserveLead = ' · Max keeps '
export const bidAmountHintGasReserveTail = ' for gas'
export const formatRoundedBidPriceNotice = (price: CopyTemplateValue) => `Will be submitted at ${price}\u00a0ETH per REP (nearest valid price below).`
export const formatRoundUpBidPrice = (price: CopyTemplateValue) => `Round up to ${price}`
export { loadingWalletEthBalance } from './app.js'
export const walletEthBelowGasReserve = 'Not enough wallet ETH above the gas reserve.'
export const unresolvedDepositDetailsUnavailable = 'Unresolved escalation deposit details are unavailable for this pool right now.'
export const formatCheckingPoolRepMigratedToChildUniverse = (outcomeLabel: CopyTemplateValue) => `Checking whether pool-held REP has already been migrated for the ${outcomeLabel} child universe.`
export const formatEthPerRepValue = (price: CopyTemplateValue) => `${price}\u00a0ETH per REP`
export const attoEthRaised = 'ETH raised'
export const attoRepSold = 'REP sold'
export const minBid = 'Min bid'
export const winningThreshold = 'Winning threshold'
export const reservePrice = 'Reserve price'
export const zeroEth = '0\u00a0ETH'
export const truthAuctionVisibleDepthChart = 'Truth auction visible depth chart'
export const formatDepthChartPointLabel = ({ depth, price, status }: { depth: CopyTemplateValue; price: CopyTemplateValue; status: string | undefined }) => `Select bid price ${price}\u00a0ETH per REP. ${depth}\u00a0ETH bid at or above this price.${status === undefined ? '' : ` ${status}.`}`
export const depthChartClearingStatus = 'Current clearing price'
export const yourBidPrice = 'Your bid price'
export const depthChartClearingAndSelectedStatus = 'Current clearing price and your bid price'
export const formatMissingOutcomePoolDetail = (outcomeLabel: CopyTemplateValue) => `Security pool for the ${outcomeLabel} universe does not exist.`
export const migration = 'Migration'
export const forkTrigger = 'Fork trigger'
export const notChosen = 'Not chosen'
export const systemIsForking = 'System is forking'
export const ethRep = 'ETH per REP'
export const pendingRefund = 'Pending refund'
export const refundWithdrawal = 'Refund withdrawal'
export const withdrawRefund = 'Withdraw refund'
export const withdrawingRefundTruncated = 'Withdrawing refund…'
export const loadingPendingRefund = 'Loading pending refund…'
export const pendingRefundUnavailable = 'Failed to load the pending refund balance.'
export const retryPendingRefund = 'Retry pending refund'
export const noPendingRefund = 'No credited refund is available to withdraw.'
export const settleRefundableBidsFirst = 'Settle your refundable bids above first. Their ETH then appears here to withdraw.'
export const mixedSettlementPreviewDetail = 'Winning bids add REP backing units to your vault, with a matching share of the auctioned underwriting commitments. Refundable bids credit their ETH for withdrawal.'
export const winningSettlementPreviewDetail = 'Winning bids add REP backing units to your vault, with a matching share of the auctioned underwriting commitments.'
export const refundSettlementPreviewDetail = 'Refundable bids credit their ETH for withdrawal. They add no REP backing units or underwriting commitments.'
export const truthAuctionRefundEstimateDetail = 'Estimated ETH refunded includes fully losing bids and any unfilled remainder on partially cleared winning bids.'
export const underfundedWinningClaimUnavailable = 'A claim preview isn’t available for winning bids in a truth auction that missed its ETH target. The final amount appears after settlement.'
export const settlementRoundingNotice = 'These are pre-transaction estimates. Final onchain settlement can differ slightly because claim math is rounded onchain.'
export const selectedBidSettlementPreview = 'Settlement preview.'
export const selectedBids = 'Selected bids'
export const selectedWinningBids = 'Selected winning bids'
export const selectedRefundRows = 'Selected refundable bids'
export const estimatedVaultRepBackingAttoRep = 'Estimated REP backing'
export const estimatedUnderwritingCommitments = 'Estimated underwriting commitments'
export const estimatedRefundedAttoEth = 'Estimated ETH refunded'
export const ownEscalationFork = 'Own escalation fork'
export const parentZoltarFork = 'Parent universe fork'
export const childSecurityPools = 'Child security pools'
export const pendingOutcome = 'Pending outcome'
export const openSecurityPool = 'Open security pool'
export const truthAuctionMigrationPendingDetail = 'Migration is still active. Truth auction can start once migration ends.'
export const migrationWindowEndsTooSoon = 'Migration window ends too soon to submit.'
export const parentMigrationExpiredDetail = 'Migration window has closed for this parent pool.'
export const truthAuctionNoCollateralDetail = 'No parent settlement collateral remains to auction, so this step immediately bypasses bidding and finalizes the child pool.'
export const truthAuctionNoRepDetail = 'No REP was present at fork, so no truth auction is needed for this child universe.'
export const childUniverseFullyMigratedDetail = 'This child universe already has all REP migrated from the parent pool, so no truth auction is needed.'
export const loadingTruthAuction = 'Loading truth auction…'
export const truthAuctionNotStartedReason = 'Truth auction has not started.'
export const truthAuctionFinalizedReason = 'Truth auction is already finalized.'
export const auctionEndTimeUnavailable = 'Truth auction end time is unavailable.'
export const auctionOngoingReason = 'Truth auction is still ongoing.'
export const inactive = 'Inactive'
export const targetReached = 'Target reached'
export const finalized = 'Finalized'
export const shortfall = 'Shortfall'
export const unfilled = 'Unfilled'
export const childPool = 'Child pool'
export const parentBalancesWalletRequired = 'Connect a wallet to inspect your parent-pool balances.'
export const parentVaultBalancesUnavailableDetail = 'Parent-pool vault balances are unavailable for the connected wallet. You can still use the migration actions below if this wallet has parent-pool state to move.'
export const migratedBalancesForThisOutcome = 'Migrated balances for this outcome:'
export const selectedOutcomeRepCollateral = 'Selected outcome REP backing'
export const selectedOutcomeUnderwritingLimitAttoEth = 'Selected outcome underwriting commitments'
export const walletDisputeStakedRepEmpty = 'No parent dispute-staked REP remains available for a direct claim in the child universe by the connected wallet.'
export const startingTruncated = 'Starting…'
export const formatStartsInValue = (duration: CopyTemplateValue) => `Starts in ${duration}`
export const pendingConfirmation = 'Pending confirmation'
export const settleSelectedBids = 'Settle selected bids'
export const winningBidBatchSettlementDetail = 'Select your winning bids to claim them. Each claim adds REP backing units to your vault in this pool, with a matching share of the auctioned underwriting commitments.'
export const refundableBidBatchSettlementDetail = 'Select your refundable bids to credit their ETH for withdrawal.'
export const mixedBidBatchSettlementDetail = 'Select bids to settle. Winning bids add REP backing units to your vault, with a matching share of the auctioned underwriting commitments. Refundable bids credit their ETH for withdrawal.'
export const settlingSelectedBids = 'Settling selected bids…'
export const forkActionWalletRequired = commonCopy.formatConnectWalletBefore('using fork and truth auction actions')
export const auctionEndedTitle = 'Truth auction has ended'
export const auctionEndedReason = 'Truth auction has ended.'
export const auctionEndsTooSoonToBid = 'Truth auction ends too soon to submit a bid.'
export const finalizedSettlementDetail = 'The result is final.'
export const openSettlement = 'Open settlement'
export const truthAuctionFinalizationRequiredDetail = 'Finalize it to lock in the clearing price. Bids can be settled afterwards.'
export const finalizeTruthAuctionReviewDescription = 'Locks in the final clearing price. Afterwards, winning bids can claim REP backing units and losing bids can be refunded in Settlement.'
export const finalizeTruthAuction = 'Finalize truth auction'
export const finalizingTruthAuctionTruncated = 'Finalizing truth auction…'
export const formatTruthAuctionStartDelay = (duration: CopyTemplateValue) => `Truth auction can start in ${duration}, when migration ends.`
export const eligibleDepositsLoading = 'Loading eligible escalation deposits…'
export const useUnresolvedMigrationReason = 'Use the optional cleanup of unresolved parent deposits for this pool instead.'
export const unresolvedMigrationExpiredReason = 'The window for the optional cleanup of unresolved parent deposits has closed.'
export const formatNoClaimableParentEscalationDeposits = (outcomeLabel: CopyTemplateValue) => `No parent deposits on ${outcomeLabel} are currently available for a direct claim by this wallet.`
export const parentEscalationClaimSelectionRequired = 'Select at least one deposit to claim.'
export const unresolvedMigrationUnavailableReason = 'This optional cleanup isn’t available for this pool.'
export const formatPoolRepAlreadyMigrated = (outcomeLabel: CopyTemplateValue) => `Pool-held REP has already been migrated to the ${outcomeLabel} universe.`
export const formatPoolRepStagedForVaultMigration = (outcomeLabel: CopyTemplateValue) => `Pool-held REP for the ${outcomeLabel} universe is already staged and moves into the child pool during vault migration.`
export const formatPoolMigrationRequiredForVault = (outcomeLabel: CopyTemplateValue) => `Migrate pool to the ${outcomeLabel} universe before moving vault balances.`
export const vaultMigrationCompleteReason = 'Vault migration is already complete for this wallet.'
export const combinedUnresolvedMigrationDetail = 'Optionally clear unresolved parent deposits while migrating the remaining REP backing units and underwriting commitments.'
export const bidPrice = 'Bid price'
export const submittingBidTruncated = 'Submitting bid…'
export const truthAuctionAddress = 'Truth auction address'
export const started = 'Started'
export const ended = 'Ended'
export const maxAttoRepBeingSold = 'Max REP being sold'
export const settlementAvailable = 'Settlement available'
export const migrationStatus = 'Migration status'
export const repAtFork = 'REP at fork'
export const formatMigratedAttoRepToOutcome = (outcomeLabel: CopyTemplateValue) => `REP migrated to ${outcomeLabel}`
export const settlementCollateral = 'Settlement collateral'
export const migrationStarted = 'Migration started'
export const migrationEnds = 'Migration ends'
export const forkType = 'Fork type'
export const advancedDiagnostics = 'Advanced diagnostics'
export const totalPoolHeldRepAtForkAttoRep = 'Pool-held REP at fork'
export const escalationChildRepPerSelectedOutcomeAttoRep = 'Dispute-staked REP per selected outcome'
export const escrowSourceRepAtForkAttoRep = 'Dispute-staked REP source at fork'
export const formatSettleSelectedValueForkCarriedDeposits = (outcomeLabel: CopyTemplateValue) => `Settle selected ${outcomeLabel} parent deposits`
export const settlingForkCarriedDepositsTruncated = 'Settling parent deposits…'
export const forkLifecycleStages = 'Fork lifecycle stages'
export const viewing = 'Viewing'
export const triggeredAt = 'Triggered at'
export const forkNotTriggered = 'Fork not triggered'
export const yourMigrationBalances = 'Your migration balances'
export const parentWalletBalancesDescription = 'Wallet-level balances in the parent pool that may still need migration.'
export const clearUnresolvedParentEscalationDepositAccounting = 'Optional: clear unresolved parent deposits'
export const unresolvedMigrationExpiredDetail = `${unresolvedMigrationExpiredReason} Nothing is lost: your child-pool backing and winning claims are unchanged.`
export const unresolvedEscalationMigrationWithVaultDetail = 'Optional. Moves your vault to the selected universe and clears your unresolved parent deposits in one step; the move can’t be undone. You don’t need it to claim winning deposits, and losing parent deposits need no transaction.'
export const unresolvedEscalationMigrationTechnicalDetail =
	'Transfers this wallet’s REP backing units and underwriting commitments to the selected child, checkpoints but retains claimable fees in the parent vault, and routes proportional pool-level settlement collateral. It then clears the three parent outcome totals in constant-size work. It is not required to fund dispute-staked REP backing or to claim a winning parent deposit.'
export const walletUnresolvedDepositsLoading = 'Loading unresolved parent deposits for the connected wallet…'
export const capturedEntitlementDetail = 'Unresolved parent deposits were already cleared. Your winning claims in the child pool are unchanged.'
export const formatEntitlementAlreadyMaterialized = (outcomeLabel: CopyTemplateValue) => `This wallet’s unresolved parent deposits are already cleared for the ${outcomeLabel} child universe.`
export const formatNoUnresolvedDeposits = (outcomeLabel: CopyTemplateValue) => `No unresolved deposits remain on ${outcomeLabel} for this wallet.`
export const formatMigrateUnresolvedEscalationToValue = (outcomeLabel: CopyTemplateValue) => `Clear unresolved deposits for ${outcomeLabel}`
export const migratingUnresolvedEscalationTruncated = 'Clearing unresolved deposits…'
export const claimResolvedParentEscalationDeposits = 'Optional: claim parent deposits'
export const resolvedParentDepositClaimDetail = 'Claims the selected winning parent deposits directly as REP in the child universe. You can also settle them later in the child pool.'
export const chooseParentDepositsToClaim = 'Choose deposits to claim'
export const worthNowPendingClaimFinalization = 'Worth now: Pending direct claim'
export const formatClaimSelectedValueParentDeposits = (outcomeLabel: CopyTemplateValue) => `Claim selected ${outcomeLabel} deposits`
export const claimingParentEscalationDepositsTruncated = 'Claiming parent deposits…'
export const migratePoolToUniverse = 'Migrate pool to universe'
export const poolRepMigrationDetail = 'This moves pool-held REP attributed to the selected outcome into the child universe. It affects the outcome pool, not just your vault.'
export const formatMigratePoolToValueUniverse = (outcomeLabel: CopyTemplateValue) => `Migrate pool to ${outcomeLabel} universe`
export const migratingPoolToUniverseTruncated = 'Migrating pool to universe…'
export const formatVaultMigrationDetail = (outcomeLabel: CopyTemplateValue) => `Moves all your vault REP and underwriting commitments to the ${outcomeLabel} universe. This can’t be undone or split across outcomes.`
export const vaultMigrationTechnicalDetail = 'Migrates all remaining pool-held vault REP backing and underwriting commitments from your parent vault into the selected child pool. Escalation deposits are not part of this migration; they carry over separately and are claimed in the child pool.'
export const formatMigrateVaultToValue = (outcomeLabel: CopyTemplateValue) => `Migrate vault to ${outcomeLabel}`
export const truthAuctionStatus = 'Truth auction status'
export const startTruthAuctionDetail = 'Start the ETH-for-REP truth auction once migration closes. Winning bids later claim REP backing units and a share of the auctioned underwriting commitments; losing bids are credited for withdrawal during settlement.'
export const bypassTruthAuction = 'Bypass truth auction'
export const bypassingAuctionTruncated = 'Bypassing truth auction…'
export const settlementStatus = 'Settlement status'
export const forkWorkflowDescription = 'Select a pool to inspect fork progress, migration, and the truth auction.'
export const loadingForkDetails = 'Loading fork details…'
export const forkMigrationTitle = 'Fork & migration'
export const formatMissingChildUniverseDetail = (outcomeLabel: CopyTemplateValue) => `The child universe has not been created for the ${outcomeLabel} outcome.`
export const bidder = 'Bidder'
export const currentBids = 'Current bids'
export const formatShownBidCount = (shownBidCount: CopyTemplateValue, totalBidCount: CopyTemplateValue) => `Showing ${shownBidCount} of ${totalBidCount} bids at the loaded prices.`
export const loadingAuctionBids = 'Loading truth auction bids…'
export const retryCurrentBids = 'Retry current bids'
export const retryMyBids = 'Retry my bids'
export const retryingAuctionBids = 'Retrying truth auction bids…'
export const retryingAuctionDetails = 'Retrying truth auction details…'
export const retryForkWorkflow = 'Retry fork workflow'
export const retryChildUniverse = 'Retry child universe'
export const formatLoadingOutcomePoolDetail = (outcomeLabel: CopyTemplateValue) => `Loading the ${outcomeLabel} child pool…`
export const retryPoolRepReadiness = 'Retry pool-held REP readiness'
export const auctionPriceLevelsEmpty = 'This truth auction has no active bids.'
export const loadedPriceBidsEmpty = 'No bids are loaded for the visible prices.'
export const loadMoreTruthAuctionBids = 'Show more truth auction bids'
export const myBids = 'My bids'
export const walletBidsConnectionRequired = 'Connect a wallet to inspect your submitted truth auction bids.'
export const loadingYourBids = 'Loading your bids…'
export const walletBidsEmpty = 'No bids from this wallet were found for this truth auction.'
export const loadMoreOfMyBids = 'Show more of my bids'
export const currentSize = 'At this price'
export const loadedDepth = 'At or above'
export const loadMorePriceLevels = 'Show more price levels'
export const loadingPriceLevels = 'Loading price levels…'
export const marketDepth = 'Market depth'
export const auctionLiveLevelsEmpty = 'No price levels have active bids in this truth auction.'
export const priceLadder = 'Price ladder'
export const priceLadderHint = 'Select a price to use it as your bid price.'
export const formatBidCountLabel = (bidCount: bigint) => `${bidCount} ${bidCount === 1n ? 'bid' : 'bids'}`
export const visibleDepth = 'Bids at or above each price'

export const auctionDetails = 'Truth auction details'

export const notYetCleared = 'Not yet cleared'
export const estimatedResult = 'Estimated result'
export const ethRefundSuffix = 'ETH refund'
export const selectAllBids = 'Select all'
export const clearBidSelection = 'Clear selection'
export const currentClearingPriceLead = 'Current clearing price: '
export const formatUseMinimumWinningPrice = (price: CopyTemplateValue) => `Use lowest winning price (${price}\u00a0ETH per REP)`
export const formatRepPerEthValue = (price: CopyTemplateValue) => `(≈\u00a0${price}\u00a0REP per ETH)`
export const formatBidBelowClearingWarning = (price: CopyTemplateValue) => `This price is below the current clearing price, so the bid would lose and only be refunded. Bid above ${price}\u00a0ETH per REP to win.`
export const bidAtClearingWarning = 'This price equals the clearing price. Earlier bids at this price fill first, so this bid may fill only partly or not at all. Bid higher to win in full.'
export const truthAuctionOpenProgressDetail = 'The ETH target has not been reached, so there is no clearing price yet. Once it is reached, a single clearing price decides which bids win.'
export const truthAuctionClearingProgressDetail = 'Higher bids now raise the clearing price, so less REP is sold.'

export const formatSubmitBidReviewTitle = (amount: CopyTemplateValue, price: CopyTemplateValue) => `Bid ${amount}\u00a0ETH at ${formatEthPerRepValue(price)}`
export const submitBidReviewDescription = 'Locks the ETH shown below in the truth auction at your bid price. Bids can’t be cancelled: the ETH stays locked until the bid wins REP backing in the child pool or is refunded as a losing bid.'
export const formatForkWithOwnEscalationReviewTitle = (amount: CopyTemplateValue) => `Trigger universe fork · ${amount}\u00a0REP`
export const formatForkWithOwnEscalationReviewDescription = (amount: CopyTemplateValue) =>
	`Forks the universe on this pool’s question because escalation ended without a decision. The universe splits into Yes, No, and Invalid, this pool stops operating, and ${amount}\u00a0REP held by the pool and its escalation game moves into fork migration. This can’t be undone.`
const formatRepAmountSuffix = (amount: CopyTemplateValue | undefined) => (amount === undefined ? '' : ` · ${amount}\u00a0REP`)
export const formatMigratePoolReviewTitle = (outcomeLabels: CopyTemplateValue, amount?: CopyTemplateValue) => `Migrate pool-held REP to ${outcomeLabels}${formatRepAmountSuffix(amount)}`
export const formatMigratePoolReviewDescription = (outcomeLabels: CopyTemplateValue, amount?: CopyTemplateValue) =>
	`Moves this pool’s ${amount === undefined ? 'REP' : `${amount}\u00a0REP`} attributed to ${outcomeLabels} into the matching child universe. It affects the whole pool, not just your vault, and can’t be undone.`
export const formatMigrateVaultReviewTitle = (outcomeLabel: CopyTemplateValue, amount?: CopyTemplateValue) => `Migrate vault to ${outcomeLabel}${formatRepAmountSuffix(amount)}`
export const formatMigrateVaultReviewDescription = (outcomeLabel: CopyTemplateValue, amounts?: { rep: CopyTemplateValue | undefined; eth: CopyTemplateValue }) =>
	`Moves all your vault REP${amounts?.rep === undefined ? '' : ` (${amounts.rep}\u00a0REP)`} and underwriting commitments${amounts === undefined ? '' : ` (${amounts.eth}\u00a0ETH)`} from this pool to the ${outcomeLabel} universe. This can’t be undone or split across outcomes.`
