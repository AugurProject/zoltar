import { formatConnectWalletBefore } from '@zoltar/ui-core-shared/copy/common.js'

export const title = 'Security pools'
export const setup = 'Open a security pool'
export const manager = 'Security pool address'
export const owner = 'Owner address'
export const ownerHint = 'Holdings load automatically for this wallet or smart account.'
export const loading = 'Loading security pool…'
export const originPool = 'Origin universe ID'
export const originPoolHint = 'Create a security pool directly in an unforked universe. Complete the four setup stages after deployment, then register questions.'
export const deploy = 'Deploy security pool'
export const deploying = 'Deploying security pool…'
export const connect = formatConnectWalletBefore('sending transactions')
export const enterSecurityPool = 'Open a security pool first'
export const enterOrigin = 'Enter a valid origin universe ID'
export const originForked = 'This universe has forked. Choose an unforked universe as the origin.'
export const originForkedAction = 'The origin universe has forked.'
export const ownerRequired = 'Connect the selected owner account'
export const universe = 'Universe'
export const addQuestion = 'Register question'
export const addingQuestion = 'Registering question…'
export const questionId = 'Question ID'
export const questionHint = 'Registration allocates no funds. Registered questions appear in the paged list below.'
export const confirmed = 'Transaction confirmed'
export const failure = 'Security pool action failed'
export const busy = 'Wait for the current security pool transaction'
export const registerDisabled = 'Enter a valid question ID'
export const horizon = 'Maximum question horizon (days)'
export const horizonHint = 'Only questions ending within this interval can enter the security pool. This is not a REP withdrawal deadline.'
export const horizonInvalid = 'Enter a positive whole number of days within the supported date range'
export const mint = 'Mint security pool complete sets'
export const minting = 'Minting complete sets…'
export const mintHint = 'Choose a question and amount. Shared capacity backs all outcomes, delivered to your connected wallet.'
export const mintAmount = 'Collateral'
export const minimumShares = 'Minimum complete sets'
export const mintReview = ({ amount, purchaseFee, feeCap, minimum, recovery }: { amount: string; purchaseFee: string; feeCap: string; minimum: string; recovery: { amount: string; cap: string } | undefined }) =>
	`Mint with ${amount}. The purchase fee is ${purchaseFee}, capped at ${feeCap}. Receive at least ${minimum} of each outcome.${recovery === undefined ? '' : ` The recovery contribution is ${recovery.amount} REP, capped at ${recovery.cap} REP.`} Queued commitment reductions use their reserved capacity.`
export const openQuestionShares = 'Open question shares'

export const maximumPurchaseFee = 'Maximum purchase fee'
export const maximumPurchaseFeeHint = 'Charged on every purchase, including reused backing. Only the actual fee is transferred.'
export const estimatedPurchaseFee = 'Purchase fee'
export const registeredQuestions = 'Question'
export const findQuestionById = 'Find by question ID'
export const retryQuestionDetails = 'Retry question details'
export const formatStaleQuestionDetails = (reason: string) => `Showing the last loaded question details. ${reason}`
export const reviewQuestionDetails = 'Wait for question details before purchasing.'
export const chooseQuestion = 'Choose a question'
export const admissionMode = 'Question rules'
export const admissionOpen = 'Open questions'
export const admissionFixed = 'Fixed question list'
export const admissionOpenHint = 'Anyone may add an eligible question. Authorized commitments automatically back paid purchases.'
export const admissionFixedHint = 'Only the listed questions may receive backing. Nobody can change this list after the policy is deployed.'
export const fixedQuestionIds = 'Approved question IDs'
export const fixedQuestionIdsHint = 'Separate decimal or hexadecimal IDs with commas or spaces. Registration can happen later.'
export const purchaseFeePercent = 'Base purchase fee (%)'
export const minimumPurchaseFee = 'Minimum base purchase fee'
export const immutableEconomics = 'Question rules and pool settings are fixed at deployment. Position owners choose their own health target and commitment.'
export const deployAdmission = 'Prepare question rules'
export const deployingAdmission = 'Preparing question rules…'
export const deployAdmissionFirst = 'Deploy the selected question rules first'
export const admissionDeployed = 'Question rules deployed'
export const admissionAddressMissing = 'Question rules deployment address unavailable.'
export const openQuestionRulesReview = 'Deploy open question rules. Anyone may add an eligible question.'
export const fixedQuestionRulesReview = (universeId: bigint, questionIds: readonly bigint[]) => `Deploy a fixed question list for universe ${universeId}. Only these question IDs may be backed: ${questionIds.map(id => `0x${id.toString(16)}`).join(', ')}. Nobody can change the list.`
export const fixedQuestionLimit = (maximum: number) => `A fixed question list can hold up to ${maximum} approved questions.`
export const questionRulesDisallowRegistration = 'This question is not allowed by the security pool’s rules.'
export const creationInvalid = 'Check the security pool configuration.'
export const unsupportedAdmission = 'These question rules are unsupported. Withdrawals and fork recovery remain available.'
export const admissionCustom = 'Custom policy — underwriting unavailable'
export const admissionChecking = 'Checking question rules…'
export const admissionCheckFailed = 'Could not verify the question rules.'
export const approvedQuestionCount = (count: bigint) => `${count} permanently approved question${count === 1n ? '' : 's'}. Only the current page is listed below.`

export const readUnavailable = 'Account refresh pending.'

export const triggerUniverseFork = 'Trigger universe fork'

export const triggerUniverseForkDescription = 'This unresolved question forks its universe. Security pool owners choose a recovery branch. Reporter balances are copied into every child branch.'

export const forkCost = 'Cost from your wallet'
export const registrationOriginRequired = 'Register questions in the unforked origin universe.'
export const forkAdmission = 'Fork the universe'

export const approveForkAdmission = 'Approve fork admission REP'

export const approveForkAdmissionDescription = 'REP supply grew after this Escalation Game started, so its escrow is below the fork threshold. Your wallet pays the difference; it joins the question escrow without a separate claim.'

export const forkAdmissionActionLabel = 'triggering the fork'

export const checkingForkAdmission = 'Checking fork admission…'

export const forkAdmissionApprovalRequired = 'Fork admission REP approval required.'

export const forkAdmissionApproved = 'Fork admission REP approved'

export const universeForkTriggered = 'Universe fork triggered'

export const loadingQuestion = 'Loading question…'

export const questionUnavailable = 'Question unavailable'

export const securityMultiplier = 'Security multiplier (%)'

export const securityMultiplierHint = 'Minimum backing policy for this security pool. Position owners can choose a higher health target.'

export const oraclePriorityFee = 'Oracle priority fee (nanoETH/gas)'

export const ownerNeeded = 'Connect a wallet or enter an owner address to load this security pool.'

export const ownerAddressNeeded = 'Enter an owner address to load this security pool.'
