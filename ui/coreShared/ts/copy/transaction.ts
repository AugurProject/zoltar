import { formatActionTense } from './transactionActionTenses.js'
import type { CopyTemplateValue } from './types.js'

export const pool = 'Pool'
export const settleFinalizedRefunds = 'Settle finalized refunds'
export const undefinedValue = 'undefined'
export const nullValue = 'null'
export const circularValue = '[circular value]'
export const contract = 'Contract'
export const to = 'To'
export const functionLabel = 'Function'
export const ethValue = 'ETH Value'
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
export const approvingForkRep = 'Approving fork REP'
export const forkingZoltar = 'Forking universe'
export const forkRepApproved = 'Fork REP approved'
export const zoltarForkSubmitted = 'Universe fork submitted'
export const deployingChildUniverse = 'Deploying child universe'
export const childUniverseDeployed = 'Child universe deployed'
export const migratingRep = 'Migrating REP'
export const repMigratedSuccessDetail = 'Each selected outcome universe minted the migrated REP to your wallet.'
export const migrationOutcomes = 'Outcomes'
export const repMigrated = 'REP migrated'
export const creatingSecurityPool = 'Creating security pool'
export const securityPoolCreation = 'Security pool creation'
export const securityPoolCreatedDetail = 'The new security pool is now available for shares, reporting, and vault operations.'
export const securityPoolCreated = 'Security pool created'
export const formatQueuedOperationAutoExecutionDetail = (operationId: CopyTemplateValue) => `Staged operation #${operationId} was queued for the next oracle settlement.`
export const formatQueuedOperationManualExecutionDetail = (operationId: CopyTemplateValue) => `Staged operation #${operationId} was queued and must be executed manually after a valid oracle price is available.`
export const completeSetBurnSuccessDetail = 'Matching shares were burned and collateral was returned from the selected pool.'
export const parentPoolSharesMigratedDetail = 'Child-universe shares were materialized from the selected parent-pool entitlements.'
export const shareOutcome = 'Share Outcome'
export const targetOutcomeIndexes = 'Target Outcome Indexes'
export const reportingContributionSuccessDetail = 'Your selected REP was committed to the chosen escalation side.'
export const reportingRepApprovalSuccessDetail = 'The escalation game can now transfer the approved REP from your wallet.'
export const escalationDepositsSettledDetail = 'Selected escalation deposits were settled against the current finalized outcome.'
export const submittingLiquidation = 'Submitting liquidation'
export const liquidationRequestSubmittedDetail = 'The liquidation request was submitted successfully.'
export const formatQueuedLiquidationAutoExecutionDetail = (operationId: CopyTemplateValue) => `Liquidation staged as operation #${operationId} for the next oracle settlement.`
export const formatQueuedLiquidationManualExecutionDetail = (operationId: CopyTemplateValue) => `Liquidation staged as operation #${operationId} and must be executed manually after a valid oracle price is available.`
export const liquidationExecutedImmediatelyDetail = 'The liquidation executed immediately.'
export const executingStagedOperation = 'Executing staged operation'
export const requestingPrice = 'Requesting new price…'
export const stagedOperationExecuted = 'Staged operation executed'
export const priceRequested = 'Requested new price'
export const priceRequest = 'Price request'
export const formatFinalizedRefundSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected finalized truth-auction refund rows were settled. Locked ETH was credited for withdrawal without assigning REP backing units or ${capacityOwnershipLabel}.`
export const formatWinningBidSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected truth-auction winning bids were settled. The selected bids received REP backing units plus ${capacityOwnershipLabel}, assigning the remaining capacity ownership.`
export const formatMixedBidSettlementResultDetail = (capacityOwnershipLabel: CopyTemplateValue) => `Selected truth-auction bids were settled. Winning bids received REP backing units plus ${capacityOwnershipLabel}, assigning the remaining capacity ownership; refund-only rows credited locked ETH for withdrawal.`
export const childUniverseLinkedToForkPathDetail = 'The selected child universe was deployed and linked to this fork path.'
export const ownEscalationForkSubmittedDetail = 'This pool submitted its own escalation fork and moved into Fork & Migration.'
export const zoltarUniverseForkSubmittedDetail = 'The selected universe fork was submitted on-chain.'
export const poolReadyForForkMigrationDetail = 'This pool entered fork handling and is ready for migration actions.'
export const parentEscalationDepositsClaimedDetail = 'Selected winning parent deposits were paid directly in child REP. Their carried proofs are now spent in current and later descendants.'
export const claimParentEscalationDeposits = 'Claim parent escalation deposits'
export const poolRepMigrationSuccessDetail = 'Pool-held REP was migrated into the selected child universe.'
export const unresolvedEscalationMigratedDetail = 'The wallet’s unresolved parent escalation-deposit accounting was cleared in constant-size work. Child backing and proof eligibility were already available and are unchanged.'
export const clearUnresolvedParentEscalationDepositAccounting = 'Clear unresolved parent escalation-deposit accounting'
export const vaultMigratedDetail = 'Vault REP backing and capacity ownership were migrated into the selected child universe.'
export const losingBidsRefundedDetail = 'Selected losing truth-auction bids were settled and their ETH was credited for withdrawal.'
export const auctionRefundWithdrawnDetail = 'The connected wallet withdrew its credited truth-auction ETH refund.'
export const forkDepositSettlementSuccessDetail = 'Imported fork-carried escalation deposits were settled.'
export const truthAuctionStartedSuccessDetail = 'Truth auction state was started for the selected child universe.'
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
export const vaultBackedRep = 'Vault-backed REP'
export const completedAction = (title: string) => formatActionTense(title, 'completed')
export const reportingAction = (outcome: string, amount: string) => `Report ${outcome} · ${amount} REP`
export const settleReportNumber = (id: string) => `Settle report #${id}`
export const approveTokenAmount = (amount: string) => `Approve ${amount}`

export const amount = 'Amount'
export const settleEscalationDeposits = 'Settle escalation deposits'
export const escalationDepositsSettled = 'Settled escalation deposits'

export const reviewedActions: Record<string, { title: string; description?: string }> = {
	'Transfer ETH': { title: 'Transfer ETH', description: 'Send ETH from your wallet to the recipient below.' },
	'Fund deterministic proxy deployer signer without surplus': { title: 'Fund proxy deployment', description: 'Provide ETH for deploying the shared proxy. Unused funding is returned in this transaction.' },
	'Broadcast deterministic proxy deployer transaction': { title: 'Deploy shared proxy', description: 'Broadcast the signed proxy deployment. If the signer needs ETH, this attempt sends nothing; fund it and retry in the following steps.' },
	deposit: { title: 'Wrap ETH into WETH', description: 'Convert ETH into WETH held in your wallet to fund the oracle report.' },
	requestPrice: { title: 'Request new price', description: 'Fund and start an oracle price report using your approved REP and WETH.' },
	approve: { title: 'Approve token spending', description: 'Authorize the listed spending limit; tokens stay in your wallet.' },
	depositToEscalationGame: { title: 'Report outcome' },
	depositRepOnOutcome: { title: 'Report outcome' },
	withdrawFromEscalationGame: { title: 'Settle escalation deposits', description: 'Settle the selected deposits after resolution.' },
	settle: { title: 'Settle report', description: 'Settle the completed oracle report.' },
	dispute: { title: 'Dispute report', description: 'Fund the counter-report and swap against the current report.' },
	withdrawTo: { title: 'Withdraw oracle balance', description: 'Withdraw your available oracle balance to the recipient.' },
	report: { title: 'Create oracle report', description: 'Deposit the approved tokens and start the oracle report.' },
	requestPriceIfNeededAndStageLiquidation: { title: 'Queue liquidation', description: 'Queue the liquidation and fund a price report if needed. Settlement may execute the queued liquidation.' },
	requestPriceIfNeededAndStageOperation: { title: 'Queue vault operation', description: 'Queue the vault change and fund a price report if needed. Settlement may execute the queued change.' },
	aggregate3: { title: 'Batched transaction', description: 'Run several contract calls in one transaction.' },
}
export const closeSymbol = '×'
export const hide = 'Hide'
export const transactionHash = 'Transaction hash'
export const explorer = 'Explorer'
export const formatViewAddressOnExplorer = (address: CopyTemplateValue) => `View address ${address} on explorer`

export const formatViewTransactionOnExplorer = (hash: CopyTemplateValue) => `View transaction ${hash} on explorer (opens in a new tab)`
