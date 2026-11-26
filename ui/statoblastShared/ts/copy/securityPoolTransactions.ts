import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { minimumSecurityMultiplierBps } from '@zoltar/statoblast-shared/statoblast/securityPool'

export const refreshingBalances = 'Refreshing security pool balances.'
export const newPriceRequired = 'A new accepted REP price is required.'
export const loadPoolFailed = 'Unable to load this security pool position.'
export const poolChanged = 'Security pool context changed. Review again.'
export const relatedLinkSeparator = ' · '
export const openDeploymentPromptWarning = 'If a deployment request is still open in your wallet, reject it there before starting a new deployment.'
export const pendingDeploymentTransactionWarning = 'This transaction may still be pending in your wallet. Cancel it there before starting a new deployment.'

export const deployment = {
	positionReview: (description: string, position: string, wallet: string) => `${description} The auction position is ${position}. Returned collateral, ETH and REP go to ${wallet}.`,
	positionBlockRequired: 'Wait for a confirmed block to check this auction position.',
	positionAuthorityChanged: 'Control of this auction position changed. Review again.',
	securityMultiplierTooLow: `Security multiplier must be at least ${formatUnits(minimumSecurityMultiplierBps, 2)}%.`,
	priorityFeeRequired: 'Enter a positive oracle priority fee.',
	priorityFeeAboveLimit: 'Oracle priority fee exceeds the report funding limit.',
	originValidationUnavailable: 'Could not check the origin universe. Try again.',
	originMissing: 'The origin universe does not exist.',
	collateralUnavailable: 'This collateral token is unavailable on the selected network.',
	reportStakeRequired: (decimals: number) => `Enter a positive minimum report collateral amount with up to ${decimals} decimal places.`,
	poolAddressUnavailable: 'Security pool deployment address unavailable.',
	receiptPending: 'Check your wallet activity, then check again for the deployment receipt.',
	receiptCheckFailed: 'Could not check the deployment status. Try again.',
	historyUnavailable: 'This RPC can’t check older blocks. Switch to an archive RPC or check your wallet activity.',
	walletSendUncertain: 'Waiting for the wallet. The deployment may still be open in your wallet. Open your wallet to confirm or reject it, then check again.',
	walletTransactionPending: 'The earlier transaction is still pending. Check your wallet activity, then check again.',
	walletNonceUnavailable: 'No transaction nonce was saved. Check your wallet activity before starting a new deployment.',
	transactionWaitingForEarlierNonce: (nonce: bigint) => `This transaction (nonce ${nonce}) is waiting behind an earlier one. Speed up or cancel the earlier transaction in your wallet, then check again.`,
	walletRecoveryUnsupported: 'Statoblast can’t tell whether your wallet sent the earlier transaction. Check your wallet activity before starting a new deployment.',
	missingDeploymentTransaction: 'No deployment transaction or receipt was found. Check your wallet activity before starting a new deployment.',
	droppedDeploymentTransaction: (nonce: bigint, estimated: boolean) => `If your wallet no longer shows this transaction, send or cancel a transaction with nonce ${nonce}${estimated ? ' (or the nonce your wallet shows for it)' : ''}, then check again.`,
	walletFinalityPending: `Earlier transactions from this wallet are still pending or not yet final. Speed up or cancel them in your wallet, or wait about ${15} minutes, then check again.`,
	rulesNonceScanLimit: 'Statoblast checked a limited range of wallet transactions. Check your wallet activity before starting a new deployment.',
	transactionDidNotDeploy: 'The earlier transaction did not deploy this step. Start a new deployment to continue.',
	coordinationUnavailable: 'This browser cannot coordinate deployment across tabs. Open this page in a browser that supports Web Locks.',
	progressWriteFailed: 'Could not save deployment progress. Free up browser storage or check its permissions, then try again.',
	progressUpdateFailed: "Progress couldn't be saved. Keep this tab open until setup finishes, and don't deploy from another tab.",
	factoryCountUnavailable: 'Could not check previous security pool deployments. Try the deployment again.',
	walletRejected: 'I rejected it in my wallet',
	confirmWalletRejection: 'Did you reject this transaction in your wallet? Statoblast will check the chain before unlocking this step.',
	walletActivityChanged: 'Wallet activity changed. Close this review and start it again.',
	restartAvailable: `No deployment was found. ${openDeploymentPromptWarning}`,
	progressUnavailable: 'Keep this tab open. Your browser is blocking storage, so setup cannot resume after a reload.',
	rulesChanged: 'The saved question rules changed. Reopen this page before deploying.',
	setupClosed: 'The origin universe has forked. Setup is closed.',
	stageComplete: 'This setup stage is complete.',
	previousStageRequired: 'Complete the previous setup stage first.',
	prepareModules: 'Prepare security pool contracts',
	nextStageRequired: 'Refresh and select the next setup stage.',
	invalidPercentage: (label: string) => `${label} must be a nonnegative percentage with at most two decimal places.`,
	invalidCollateral: (decimals: number) => `Enter a nonnegative amount with up to ${decimals} decimal places.`,
	annualHoldingFee: 'Annual holding fee',
	purchaseFee: 'Purchase fee',
	fixedQuestionsRequired: 'Enter at least one approved question ID.',
	invalidQuestionList: 'Use decimal or hexadecimal question IDs separated by commas or spaces.',
	questionIdTooLarge: 'Question ID is out of range.',
	reviewOrigin: (universeId: bigint, collateral: string, rules: string) => `Origin universe ${universeId}. Collateral token ${collateral}. Question rules contract ${rules}.`,
	reviewQuestionRules: (mode: 'open' | 'fixed', horizon: string) => `${mode === 'open' ? 'Any eligible question may be registered.' : 'Only questions on the fixed list may be registered.'} Maximum time to the question close is ${horizon}.`,
	reviewFees: (annual: string, purchase: string, floor: string) => `Annual holding fee ${annual}%. Purchase fee ${purchase}% of required backing value, minimum ${floor}.`,
	reviewCommitment: (minimum: string, vesting: string) => `Minimum collateral commitment ${minimum}. Rewards vest over ${vesting}.`,
	reviewDuration: (days: string) => `${days} ${days === '1' ? 'day' : 'days'}`,
	reviewDurationExact: (days: string, seconds: bigint) => `${days} (${seconds} seconds)`,
	reviewBacking: (multiplier: string, minimumPerShare: string) => `Security multiplier ${multiplier}%. Minimum backing per share ${minimumPerShare}.`,
	reviewPriceReport: (minimumStake: string, priorityFee: string) => `Minimum price-report collateral ${minimumStake}. Price-report priority fee ${priorityFee} nanoETH/gas.`,
	prepareModulesReview: (stage: number, total: number) => `Complete setup stage ${stage} of ${total}. This deploys more pool contracts without moving funds.`,
	stageChanged: 'Setup advanced. Refresh and review again.',
}

export const capital = {
	positionRequired: 'Open a security pool position first.',
	newCommitmentsClosed: 'This universe is closed to new commitments.',
	positiveAmountRequired: 'Enter a positive amount.',
	insufficientRep: 'Insufficient wallet REP.',
	approveBeforeDeposit: 'Approve REP before depositing.',
	saveTargetBeforeCommitment: 'Save your health target before authorizing this commitment.',
	reductionRequired: 'No reduction in queue.',
	connectPositionWallet: 'Connect the wallet for this position.',
	positionInactive: 'Position is no longer active.',
	approveDeposit: 'Approve REP deposit',
	approveHealthDeposit: 'Approve REP for health target',
	reviewDepositApproval: (spender: string, rep: string) => `Allow ${spender} to transfer up to ${rep} REP from your wallet. Deposit REP separately.`,
	depositRequired: 'Enter a deposit amount.',
	reviewDeposit: (rep: string) => `Deposit ${rep} REP into your position. It backs your existing commitment.`,
	withdrawalRequired: 'Enter a withdrawal amount.',
	reviewWithdrawal: (rep: string, owner: string, target: string) => `Withdraw ${rep} REP to ${owner}. Keep your ${target}% health target on the remaining commitment.`,
	targetRequired: 'Enter your health target.',
	reviewTarget: (target: string) => `Save a ${target}% health target for withdrawals and new commitments. Raising the target requires enough REP now.`,
	depositAndTargetRequired: 'Enter a deposit and health target.',
	repDepositRequired: 'Enter a REP deposit.',
	commitmentRequired: 'Enter a commitment.',
	priceForLargerCommitment: 'Fund a REP price report for this larger commitment.',
	reviewCommitment: (commitment: string, pledgedRep: string, target: string, reportId: bigint | undefined) => `Authorize ${commitment} backed by ${pledgedRep} REP at your ${target}% health target.${reportId === undefined ? '' : ` Report ${reportId} sets a price floor until a newer accepted report covers the pool.`}`,
	targetChanged: 'Your health target changed. Review the commitment again.',
	pledgedRepChanged: 'Your pledged REP changed. Review the commitment again.',
	reviewClaim: (collateral: string) => `Collect your earned ${collateral} and REP. Your pledged REP stays in the position.`,
	reductionsClosed: 'This universe is closed to commitment reductions.',
	reductionChanged: 'Commitment reduction changed. Review again.',
	freeCapacityChanged: 'Free capacity changed. Refresh the preview and review again.',
	remainingCommitmentRequired: 'Enter a remaining commitment.',
}

export const fork = {
	sourceRequired: 'Enter a valid parent universe.',
	checkingStatus: 'Checking fork status…',
	chooseOutcome: 'Choose a fork outcome.',
	choiceRecorded: 'Your branch choice is already recorded.',
	choiceWindowClosed: 'The fork choice window has closed.',
	noPledgedRep: 'No pledged REP to move.',
	capitalPrepared: 'Capital is already prepared for this branch.',
	waitForChoiceDeadline: 'Wait until the choice deadline.',
	migrationStarted: 'Migration has already started for this branch.',
	contextChanged: 'Fork context changed. Review again.',
	prepareCapitalFirst: 'Prepare branch capital first.',
	waitUntilActivation: 'Wait until the earliest activation time.',
	branchActive: 'This branch is already active.',
	stateUnavailable: 'Fork state unavailable.',
	walletChanged: 'Wallet environment changed. Review again.',
	commitBranch: 'Commit fork branch',
	selectBranch: 'Select a branch.',
	choiceUnavailable: 'Fork choice is no longer available.',
	prepareReview: 'Create this branch’s REP token and shared capital contracts when needed.',
	startReview: 'Move shared REP to this branch and set up its repair auction.',
	activateReview: 'Activate this branch’s collateral and REP claims and the positions that chose it.',
}

export const invalidPoolUniverse = 'Enter a valid universe ID.'
export const poolReadTimeout = 'Security pool read timed out.'
export const poolRpcNetworkChanged = 'Security pool RPC uses another network.'
export const poolNeedsMinedBlock = 'Wait for a confirmed block before refreshing.'
export const poolBatchResponseInvalid = 'The RPC returned an incomplete batch.'
export const poolRefreshChainChanged = 'The chain changed during refresh. Try again.'
