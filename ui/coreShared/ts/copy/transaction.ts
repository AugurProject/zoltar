import { formatActionTense } from './transactionActionTenses.js'
import { ethWrapped, wrapEthIntoWeth } from './transactionSteps.js'
import type { CopyTemplateValue } from './types.js'

export const pool = 'Pool'
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
export const completeSetBurnSuccessDetail = 'Matching shares were burned and collateral was returned from the selected pool.'
export const parentPoolSharesMigratedDetail = 'Child universe shares were created from your selected parent-pool shares.'
export const shareOutcome = 'Share outcome'
export const targetOutcomeIndexes = 'Target outcome indexes'
export const reportingContributionSuccessDetail = 'Your selected REP was committed to the chosen escalation side.'
export const reportingRepApprovalSuccessDetail = 'The escalation game can now transfer the approved REP from your wallet.'
export const escalationDepositsSettledDetail = 'Selected escalation deposits were settled against the current finalized outcome.'
const priceRequested = 'Price requested'
export const transactionStatus = 'Transaction status'
export const transactionDetails = 'Transaction details'
export const revertedCheckingDetails = 'Transaction reverted; checking details…'
export const failureReasonUnavailable = 'No failure reason was returned.'
export const preparing = 'Preparing'
export const awaitingWallet = 'Awaiting wallet'
export const confirmed = 'Confirmed'
export const backToForm = 'Back to form'
export const confirmationUnavailableDetail = 'Not confirmed yet; still checking. Speed it up or cancel it in your wallet instead of sending it again.'
export const waitingForPendingTransaction = 'Waiting for a pending transaction on this item.'
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
	aggregate3: { title: 'Batched transaction', completedTitle: 'Batched transaction completed', description: 'Run several contract calls in one transaction.' },
}
/** The result title of a finished action: the reviewed action's own noun-first title, else the action title in past tense. */
export const completedAction = (title: string) => Object.values(reviewedActions).find(action => action.title === title)?.completedTitle ?? formatActionTense(title, 'completed')
export const closeSymbol = '×'
export const hide = 'Hide'
export const transactionHash = 'Transaction hash'
export const formatViewAddressOnExplorer = (address: CopyTemplateValue) => `View address ${address} on explorer (opens in a new tab)`

export const formatViewTransactionOnExplorer = (hash: CopyTemplateValue) => `View transaction ${hash} on explorer (opens in a new tab)`
