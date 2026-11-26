export const refreshingBalances = 'Refreshing security pool balances.'
export const newPriceRequired = 'A new accepted REP price is required.'
export const loadPoolFailed = 'Unable to load this security pool position.'
export const poolChanged = 'Security pool context changed. Review again.'
export const relatedLinkSeparator = ' · '

export const deployment = {
	positionReview: (description: string, position: string, wallet: string) => `${description} The auction position is ${position}. Returned collateral, ETH and REP go to ${wallet}.`,
	positionBlockRequired: 'Wait for a confirmed block to check this auction position.',
	positionAuthorityChanged: 'Control of this auction position changed. Review again.',
	securityMultiplierTooLow: 'The security multiplier is below the protocol minimum.',
	priorityFeeRequired: 'Enter a positive oracle priority fee.',
	priorityFeeAboveLimit: 'Oracle priority fee exceeds the report funding limit.',
	collateralUnavailable: 'This collateral token is unavailable on the selected network.',
	reportStakeRequired: (decimals: number) => `Enter a positive minimum report stake with up to ${decimals} decimal places.`,
	poolAddressUnavailable: 'Security pool deployment address unavailable.',
	receiptPending: 'Waiting for the deployment receipt.',
	receiptCheckFailed: 'Could not check the deployment receipt. Try again.',
	walletSendUncertain: 'The wallet hasn’t returned a transaction hash. Check the activity in your wallet.',
	restartAvailable: 'The previous deployment did not confirm. Start a new deployment to continue.',
	progressUnavailable: 'Deployment progress cannot be saved. Keep this tab open until setup is complete.',
	rulesChanged: 'The saved question rules changed. Reopen this page before deploying.',
	setupClosed: 'The origin universe has forked. Setup is closed.',
	stageComplete: 'This setup stage is complete.',
	previousStageRequired: 'Complete the previous setup stage first.',
	prepareModules: 'Prepare security pool modules',
	nextStageRequired: 'Refresh and select the next setup stage.',
	invalidPercentage: (label: string) => `${label} must be a nonnegative percentage with at most two decimal places.`,
	invalidCollateral: (decimals: number) => `Enter a nonnegative amount with up to ${decimals} decimal places.`,
	annualHoldingFee: 'Annual holding fee',
	purchaseFee: 'Purchase fee',
	fixedQuestionsRequired: 'Enter at least one approved question ID.',
	invalidQuestionList: 'Use decimal or hexadecimal question IDs separated by commas or spaces.',
	questionIdTooLarge: 'Question ID must fit uint256.',
	reviewQuestionRules: (mode: 'open' | 'fixed', horizon: string) => `${mode === 'open' ? 'Any eligible question may be registered.' : 'Only questions on the fixed list may be registered.'} Maximum time to the question close is ${horizon}.`,
	reviewFees: (annual: string, purchase: string, floor: string) => `Annual holding fee ${annual}%. Purchase fee ${purchase}% of required backing value, minimum ${floor}.`,
	reviewCommitment: (minimum: string, vesting: string) => `Minimum collateral commitment ${minimum}. Rewards vest over ${vesting}.`,
	reviewDuration: (days: string) => `${days} ${days === '1' ? 'day' : 'days'}`,
	prepareModulesReview: (stage: number, total: number) => `Complete setup stage ${stage} of ${total}. This deploys more pool modules without moving funds.`,
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
