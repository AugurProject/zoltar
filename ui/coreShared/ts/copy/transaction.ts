import { formatActionTense } from './transactionActionTenses.js'
import { ethWrapped, wrapEthIntoWeth } from './transactionSteps.js'
import type { CopyTemplateValue } from './types.js'

export const pool = 'Pool'
export const settleFinalizedRefunds = 'Settle finalized refunds'
export const undefinedValue = 'undefined'
export const nullValue = 'null'
export const circularValue = '[circular value]'
export const contract = 'Contract'
export const to = 'To'
export const functionLabel = 'Function'
export const ethValue = 'ETH value'
export const argumentListLabel = 'Arguments'
export const formatDeployingValue = (contractLabel: CopyTemplateValue) => `Deploying ${contractLabel}`
export const formatValueDeployed = (contractLabel: CopyTemplateValue) => `${contractLabel} deployed`
export const simulationSubmissionDetail = 'Submitting in browser simulation. No wallet confirmation is required.'
export const walletConfirmationInstruction = 'Confirm the transaction in your wallet.'
export const walletConfirmationReviewDetail = 'Review the prepared transaction, then confirm it in your wallet.'
export const simulationSubmissionReviewDetail = 'Review the prepared transaction before it is submitted.'
export const creatingQuestion = 'Creating question'
export const questionCreation = 'Question creation'
export const questionCreated = 'Question created'
export const approvingForkRep = 'Approving REP'
export const forkingZoltar = 'Forking universe'
export const forkRepApproved = 'REP approved'
export const zoltarForkSubmitted = 'Universe fork submitted'
export const deployingChildUniverse = 'Deploying child universe'
export const childUniverseDeployed = 'Child universe deployed'
export const migratingRep = 'Migrating REP'
export const repMigratedSuccessDetail = 'Each selected child universe minted the migrated REP to your wallet.'
export const repMigrated = 'REP migrated'
export const creatingSecurityPool = 'Creating security pool'
export const securityPoolCreation = 'Security pool creation'
export const securityPoolCreatedDetail = 'The new security pool is now available for shares, reporting, and vault operations.'
export const securityPoolCreated = 'Security pool created'
export const formatQueuedOperationAutoExecutionDetail = (operationId: CopyTemplateValue) => `Staged operation #${operationId} was queued for the next oracle settlement.`
export const formatQueuedOperationManualExecutionDetail = (operationId: CopyTemplateValue) => `Staged operation #${operationId} was queued. Execute it manually after a valid oracle price is available.`
export const completeSetBurnSuccessDetail = 'Matching shares were burned and collateral was returned from the selected pool.'
export const parentPoolSharesMigratedDetail = 'Child universe shares were created from your selected parent-pool shares.'
export const shareOutcome = 'Share outcome'
export const targetOutcomeIndexes = 'Target outcome indexes'
export const reportingContributionSuccessDetail = 'Your selected REP was committed to the chosen escalation side.'
export const reportingRepApprovalSuccessDetail = 'The escalation game can now transfer the approved REP from your wallet.'
export const escalationDepositsSettledDetail = 'Selected escalation deposits were settled against the current finalized outcome.'
export const submittingLiquidation = 'Submitting liquidation'
export const liquidationRequestSubmittedDetail = 'The liquidation request was submitted successfully.'
export const formatQueuedLiquidationAutoExecutionDetail = (operationId: CopyTemplateValue) => `Liquidation queued as staged operation #${operationId} for the next oracle settlement.`
export const formatQueuedLiquidationManualExecutionDetail = (operationId: CopyTemplateValue) => `Liquidation queued as staged operation #${operationId}. Execute it manually after a valid oracle price is available.`
export const liquidationExecutedImmediatelyDetail = 'The liquidation executed immediately.'
export const executingStagedOperation = 'Executing staged operation'
export const requestingPrice = 'Requesting new price'
export const stagedOperationExecuted = 'Staged operation executed'
export const priceRequested = 'Price requested'
export const priceRequest = 'Price request'
export const formatFinalizedRefundSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected finalized truth-auction refund rows were settled. Locked ETH was credited for withdrawal without assigning REP backing units or ${capacityOwnershipLabel}.`
export const formatWinningBidSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected truth-auction winning bids were settled. The selected bids received REP backing units plus ${capacityOwnershipLabel}, assigning the remaining underwriting commitments.`
export const formatMixedBidSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected truth-auction bids were settled. Winning bids received REP backing units plus ${capacityOwnershipLabel}, assigning the remaining underwriting commitments; refund-only rows credited locked ETH for withdrawal.`
export const childUniverseLinkedToForkPathDetail = 'The selected child universe was deployed and linked to this fork path.'
export const ownEscalationForkSubmittedDetail = 'This pool submitted its own escalation fork and moved into Fork & migration.'
export const zoltarUniverseForkSubmittedDetail = 'The selected universe fork was submitted onchain.'
export const poolReadyForForkMigrationDetail = 'This pool entered fork handling and is ready for migration actions.'
export const parentEscalationDepositsClaimedDetail = 'Selected winning parent deposits were paid in child universe REP. They cannot be claimed again in this universe or its descendants.'
export const claimParentEscalationDeposits = 'Claim parent escalation deposits'
export const poolRepMigrationSuccessDetail = 'Pool-held REP was migrated into the selected child universe.'
export const unresolvedEscalationMigratedDetail = 'Your unresolved parent escalation-deposit records were cleared. Your child universe backing and claim eligibility are unchanged.'
export const clearUnresolvedParentEscalationDepositAccounting = 'Clear unresolved parent escalation-deposit accounting'
export const vaultMigratedDetail = 'Vault REP backing and underwriting commitments were migrated into the selected child universe.'
export const losingBidsRefundedDetail = 'Selected losing truth-auction bids were settled and their ETH was credited for withdrawal.'
export const auctionRefundWithdrawnDetail = 'The connected wallet withdrew its credited truth-auction ETH refund.'
export const forkDepositSettlementSuccessDetail = 'Escalation deposits carried over from the fork were settled.'
export const truthAuctionStartedSuccessDetail = 'Truth auction started for the selected child universe.'
export const truthAuctionBidSuccessDetail = 'Truth auction bid submitted. Bid ETH stays committed until settlement.'
export const transactionStatus = 'Transaction status'
export const transactionDetails = 'Transaction details'
export const revertedCheckingDetails = 'Transaction reverted; checking details…'
export const failureReasonUnavailable = 'No failure reason was returned.'
export const preparing = 'Preparing'
export const awaitingWallet = 'Awaiting wallet'
export const confirmed = 'Confirmed'
export const backToForm = 'Back to form'
export const confirmationUnavailableDetail = 'Confirmation unavailable. Checking automatically; do not resubmit.'
export const attention = 'Attention'
export const dismiss = 'Dismiss'

export const paidFrom = 'Paid from'
export const walletRep = 'Wallet REP'
export const vaultBackedRep = 'Pool vault REP'
export const reportingAction = (outcome: string, amount: string) => `Report ${outcome} · ${amount}\u00a0REP`
export const settleReportNumber = (id: string) => `Settle report #${id}`

export const settleEscalationDeposits = 'Settle escalation deposits'
export const escalationDepositsSettled = 'Escalation deposits settled'

const reportOutcomeReviewDescription = 'Stakes REP on the selected outcome. If that outcome loses, this REP is lost.'
export const reviewedActions: Record<string, { title: string; completedTitle: string; description?: string }> = {
	'Transfer ETH': { title: 'Transfer ETH', completedTitle: 'ETH transferred', description: 'Send ETH from your wallet to the recipient below.' },
	'Fund deterministic proxy deployer signer without surplus': { title: 'Fund proxy deployment', completedTitle: 'Proxy deployment funded', description: 'Provide ETH for deploying the shared proxy. Unused funding is returned in this transaction.' },
	'Broadcast deterministic proxy deployer transaction': { title: 'Deploy shared proxy', completedTitle: 'Shared proxy deployed', description: 'Broadcast the signed proxy deployment. If the signer needs ETH, this attempt sends nothing; fund it and retry in the following steps.' },
	deposit: { title: wrapEthIntoWeth, completedTitle: ethWrapped, description: 'Convert ETH into WETH held in your wallet to fund the oracle report.' },
	requestPrice: { title: 'Request new price', completedTitle: priceRequested, description: 'Fund and start an oracle price report using your approved REP and WETH.' },
	approve: { title: 'Approve token spending', completedTitle: 'Token spending approved', description: 'Authorize the listed spending limit; tokens stay in your wallet.' },
	depositToEscalationGame: { title: 'Report outcome', completedTitle: 'Outcome reported', description: reportOutcomeReviewDescription },
	depositRepOnOutcome: { title: 'Report outcome', completedTitle: 'Outcome reported', description: reportOutcomeReviewDescription },
	depositWalletRepToEscalationGame: { title: 'Report outcome', completedTitle: 'Outcome reported', description: reportOutcomeReviewDescription },
	withdrawFromEscalationGame: { title: settleEscalationDeposits, completedTitle: escalationDepositsSettled, description: 'Settle the selected deposits after resolution.' },
	settle: { title: 'Settle report', completedTitle: 'Report settled', description: 'Settle the completed oracle report.' },
	dispute: { title: 'Dispute report', completedTitle: 'Report disputed', description: 'Fund the counter-report and swap against the current report.' },
	withdrawTo: { title: 'Withdraw oracle balance', completedTitle: 'Oracle balance withdrawn', description: 'Withdraw your available oracle balance to the recipient.' },
	report: { title: 'Create oracle report', completedTitle: 'Oracle report created', description: 'Deposit the approved tokens and start the oracle report.' },
	requestPriceIfNeededAndStageLiquidation: { title: 'Queue liquidation', completedTitle: 'Liquidation queued', description: 'Queue the liquidation and fund a price report if needed. Settlement may execute the queued liquidation.' },
	requestPriceIfNeededAndStageOperation: { title: 'Queue vault operation', completedTitle: 'Vault operation queued', description: 'Queue the vault change and fund a price report if needed. Settlement may execute the queued change.' },
	aggregate3: { title: 'Batched transaction', completedTitle: 'Batched transaction completed', description: 'Run several contract calls in one transaction.' },
}
/** The result title of a finished action: the reviewed action's own noun-first title, else the action title in past tense. */
export const completedAction = (title: string) => Object.values(reviewedActions).find(action => action.title === title)?.completedTitle ?? formatActionTense(title, 'completed')
export const closeSymbol = '×'
export const hide = 'Hide'
export const transactionHash = 'Transaction hash'
export const explorer = 'Explorer'
export const formatViewAddressOnExplorer = (address: CopyTemplateValue) => `View address ${address} on explorer (opens in a new tab)`

export const formatViewTransactionOnExplorer = (hash: CopyTemplateValue) => `View transaction ${hash} on explorer (opens in a new tab)`
