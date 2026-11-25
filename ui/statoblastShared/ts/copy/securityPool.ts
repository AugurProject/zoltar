import { formatConnectWalletBefore } from '@zoltar/ui-core-shared/copy/common.js'

export const title = 'Security pools'
export const loading = 'Loading security pool…'
export const originPool = 'Origin universe ID'
export const originPoolHint = 'Choose an unforked universe.'
export const deploy = 'Deploy security pool'
export const deploying = 'Deploying security pool…'
export const connect = formatConnectWalletBefore('sending transactions')
export const enterSecurityPool = 'Open a security pool first'
export const enterOrigin = 'Enter a valid origin universe ID'
export const originForked = 'This universe has forked. Choose an unforked universe as the origin.'
export const originForkedAction = 'The origin universe has forked.'
export const ownerRequired = 'Connect the owner’s wallet'
export const addQuestion = 'Register question'
export const confirmed = 'Transaction confirmed'
export const failure = 'Security pool action failed'
export const busy = 'Wait for the current security pool transaction'
export const registerDisabled = 'Enter a valid question ID'
export const horizon = 'Latest question end (days)'
export const horizonHint = 'A question must end within this many days of being registered.'
export const horizonInvalid = 'Enter a positive whole number of days within the supported date range'
export const invalidMaximumMintFee = 'Enter a valid maximum fee.'
export const invalidMinimumMintShares = 'Enter a valid minimum number of complete sets.'
export const invalidMintLimits = 'Enter valid limits for the fee and complete sets.'
export const mintFeeAboveLimit = 'The quoted fee exceeds your maximum fee.'
export const mintSharesBelowLimit = 'The quote is below your minimum complete sets.'
export const mintAmountTooLow = 'This amount would mint no complete sets.'
export const maximumMintAmountUnavailable = 'Couldn’t check the maximum mint amount. Try again.'
export const maximumMintAmountNotFunded = 'No mint amount fits the current wallet funds and pool capacity.'
export const insufficientMintCapacity = 'Insufficient shared REP backing after queued commitment reductions.'
export const mintFeeChanged = 'Purchase fee changed. Review the amount again.'
export const mintSharesChanged = 'The shares received changed. Review the mint amount again.'
export const mintReview = ({ amount, purchaseFee, feeCap, minimum, recovery }: { amount: string; purchaseFee: string | undefined; feeCap: string; minimum: string; recovery: { amount: string; cap: string } | undefined }) =>
	`Mint with ${amount}. The purchase fee is ${purchaseFee === undefined ? '' : `estimated at ${purchaseFee}, `}capped at ${feeCap}. Receive at least ${minimum} of each outcome.${recovery === undefined ? '' : ` The recovery contribution is estimated at ${recovery.amount} REP, capped at ${recovery.cap} REP.`} Queued commitment reductions use their reserved capacity.`

export const estimatedPurchaseFee = 'Purchase fee'
export const admissionMode = 'Which questions can be registered'
export const admissionOpen = 'Any question'
export const admissionFixed = 'Fixed question list'
export const admissionOpenHint = 'Anyone can register an eligible question.'
export const admissionFixedHint = 'The approved list is permanent after deployment.'
export const fixedQuestionIds = 'Approved question IDs'
export const fixedQuestionIdsHint = 'Separate decimal or hexadecimal IDs with commas or spaces.'
export const purchaseFeePercent = 'Purchase fee (%)'
export const deployAdmission = 'Prepare question rules'
export const deployingAdmission = 'Preparing question rules…'
export const deployAdmissionFirst = 'Deploy the selected question rules first'
export const admissionDeployed = 'Question rules deployed'
export const poolAlreadyDeployed = 'Security pool deployed. Continue with setup.'
export const admissionAddressMissing = 'Question rules deployment address unavailable.'
export const openQuestionRulesReview = 'Deploy open question rules. Anyone may add an eligible question.'
export const fixedQuestionRulesReview = (universeId: bigint, questionIds: readonly bigint[]) => `Deploy a fixed question list for universe ${universeId}. Only these question IDs may be backed: ${questionIds.map(id => `0x${id.toString(16)}`).join(', ')}. Nobody can change the list.`
export const fixedQuestionLimit = (maximum: number) => `A fixed question list can hold up to ${maximum} approved questions.`
export const questionRulesDisallowRegistration = 'This question is not allowed by the security pool’s rules.'
export const questionMissingForRegistration = 'This question does not exist.'
export const questionEndedForRegistration = 'This question has ended.'
export const formatQuestionHorizonReason = (seconds: bigint) => {
	const horizon = seconds % 86_400n === 0n ? `${seconds / 86_400n}-day` : `${seconds}-second`
	return `This question ends after the security pool’s ${horizon} question horizon.`
}
export const questionOutcomeRegistrationRequired = 'Only questions with Yes and No outcomes can be registered.'
export const registrationForkThresholdTooLow = 'This universe’s fork threshold is too low to register questions.'
export const formatRegisterQuestionReview = (questionId: string) => `Add question ${questionId} to this security pool.`
export const questionNotLinkedToSecurityPool = 'This question has no security pool.'
export const questionPoolVerificationFailed = 'Could not verify that this question belongs to this security pool.'
export const mintingAfterReportingStarts = 'Minting closes once reporting starts.'
export const creationInvalid = 'Check the security pool configuration.'
export const unsupportedAdmission = 'These question rules are unsupported. Withdrawals and fork recovery remain available.'
export const admissionChecking = 'Checking question rules…'
export const admissionCheckFailed = 'Could not verify the question rules.'

export const readUnavailable = 'Position refresh pending.'
export const positionNeedsConfirmedBlock = 'Reading this position requires a confirmed block.'
export const transactionOwnerRequired = 'Connect the wallet sending this transaction.'
export const setupPoolRequired = 'Deploy or load a security pool first.'
export const checkingSetupProgress = 'Checking setup progress…'
export const retrySavedSetup = 'Try again to verify the saved setup progress.'

export const triggerUniverseFork = 'Trigger universe fork'

export const triggerUniverseForkDescription = 'This unresolved question forks its universe. Security pool owners choose a recovery branch. Reporter balances are copied into every child branch.'

export const registrationOriginRequired = 'Register questions in the unforked origin universe.'
export const forkAdmission = 'Fork the universe'

export const approveForkAdmission = 'Approve fork admission REP'

export const approveForkAdmissionDescription = 'REP supply grew after reporting started. Your wallet pays the difference needed to reach the fork threshold. This REP cannot be reclaimed.'

export const forkAdmissionActionLabel = 'triggering the fork'

export const checkingForkAdmission = 'Checking fork admission…'

export const forkAdmissionApprovalRequired = 'Fork admission REP approval required.'

export const forkAdmissionApproved = 'Fork admission REP approved'

export const universeForkTriggered = 'Universe fork triggered'

export const questionUnavailable = 'Question unavailable'

export const securityMultiplier = 'Security multiplier (%)'

export const securityMultiplierHint = 'REP value required per unit of committed collateral. Position owners can choose a higher health target.'

export const loadForkCostFailed = 'Could not check the REP needed to fork.'
export const approveForkCostAction = 'approving REP for the fork'
export const questionReporting = 'Question reporting'
export const approveForkCostFailed = 'Could not approve REP for the fork.'
export const triggerForkAction = 'triggering a universe fork'
export const triggerForkFailed = 'Could not trigger the universe fork.'
