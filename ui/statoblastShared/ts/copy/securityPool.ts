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
export const openQuestionShares = 'Open question shares'

export const maximumPurchaseFee = 'Maximum purchase charge'
export const maximumPurchaseFeeHint = 'Charged on every purchase, including reused backing. Only the actual fee is transferred.'
export const estimatedPurchaseFee = 'Purchase charge (fee + premium)'
export const registeredQuestions = 'Question'
export const findQuestionById = 'Find by question ID'
export const retryQuestionDetails = 'Retry question details'
export const reviewQuestionDetails = 'Wait for question details before purchasing.'
export const chooseQuestion = 'Choose a question'
export const admissionMode = 'Question admission'
export const admissionOpen = 'Open questions'
export const admissionFixed = 'Fixed question list'
export const admissionOpenHint = 'Anyone may add an eligible question. Authorized commitments automatically back paid purchases.'
export const admissionFixedHint = 'Only the listed questions may receive backing. Nobody can change this list after the policy is deployed.'
export const fixedQuestionIds = 'Approved question IDs'
export const fixedQuestionIdsHint = 'Separate decimal or hexadecimal IDs with commas or spaces. Registration can happen later.'
export const purchaseFeePercent = 'Base purchase fee (%)'
export const minimumPurchaseFee = 'Minimum base purchase fee'
export const immutableEconomics = 'Admission and economic settings are fixed at security pool creation. Each owner chooses their own health target and commitment.'
export const deployAdmission = 'Deploy admission policy'
export const deployingAdmission = 'Deploying admission policy…'
export const deployAdmissionFirst = 'Deploy the selected admission policy first'
export const admissionDeployed = 'Admission policy deployed'
export const admissionAddressMissing = 'Admission policy deployment address unavailable.'
export const creationInvalid = 'Check the security pool configuration.'
export const unsupportedAdmission = 'This admission policy is not supported by this interface. Withdrawals and fork recovery remain available.'
export const admissionCustom = 'Custom policy — underwriting unavailable'
export const admissionChecking = 'Checking question admission…'
export const admissionCheckFailed = 'Could not verify the question admission policy.'
export const approvedQuestionCount = (count: bigint) => `${count} permanently approved question${count === 1n ? '' : 's'}. Only the current page is listed below.`

export const readUnavailable = 'Account refresh pending.'

export const triggerUniverseFork = 'Trigger universe fork'

export const triggerUniverseForkDescription = 'This unresolved question forks its universe. Security pool owners choose a recovery branch. Reporter balances are copied into every child branch.'

export const forkAdmission = 'Fork admission'

export const approveForkAdmission = 'Approve fork admission REP'

export const approveForkAdmissionDescription = 'REP supply grew after this Escalation Game started, so its escrow is below the fork threshold. Your wallet pays the difference; it joins the question escrow without a separate claim.'

export const forkAdmissionShortfallDetail = 'REP supply grew after this game started; your wallet pays the escrow shortfall. The default approval adds 1 REP for further growth.'

export const forkAdmissionActionLabel = 'triggering the fork'

export const checkingForkAdmission = 'Checking fork admission…'

export const forkAdmissionApprovalRequired = 'Fork admission REP approval required.'

export const forkAdmissionApproved = 'Fork admission REP approved'

export const universeForkTriggered = 'Universe fork triggered'

export const loadingQuestion = 'Loading question…'

export const questionUnavailable = 'Question unavailable'

export const selectRegisteredQuestion = 'Select a registered question from its security pool.'

export const securityPoolQuestions = 'Security pool questions'

export const securityPoolQuestionsDescription = 'Each question has separate outcome shares and reporting. Its security pool provides the backing.'

export const loadingQuestions = 'Loading questions…'

export const noRegisteredQuestions = 'No registered questions'

export const registerQuestionsHint = 'Create a security pool and register its questions.'

export const securityMultiplier = 'Security multiplier (%)'

export const securityMultiplierHint = 'Minimum backing policy for this security pool. Vault owners can choose a higher health setting.'

export const oraclePriorityFee = 'Oracle priority fee (nanoETH/gas)'

export const openSecurityPools = 'Open security pools'

export const questionColumn = 'Question'

export const securityPoolColumn = 'Security pool'

export const securityPoolsInUniverse = 'Security pools in this universe'

export const loadingSecurityPools = 'Loading security pools…'

export const securityPoolsError = 'Unable to load security pools.'

export const noSecurityPoolsInUniverse = 'No security pools in this universe yet.'

export const noSecurityPoolsHint = 'Enter a security pool address to open it.'

export const ownerNeeded = 'Connect a wallet or enter an owner address to load this security pool.'

export const ownerAddressNeeded = 'Enter an owner address to load this security pool.'

export const formatRegisteredQuestions = (count: number) => {
	if (count === 0) return 'No registered questions'
	return count === 1 ? '1 registered question' : `${count} registered questions`
}

export const openSecurityPool = 'Open'

export const securityPoolSelected = 'Selected'

export const formatOpenSecurityPoolLabel = (securityPool: string) => `Open security pool ${securityPool}`

export const formatSelectedSecurityPoolLabel = (securityPool: string) => `Security pool ${securityPool} is selected`

export const outcomeColumn = 'Outcome'

export const manageBackingAndRecovery = 'Manage security pool backing and fork recovery'
