export const prepareInheritedClaims = 'Prepare inherited claims'
export const preparingInheritedClaims = 'Preparing inherited claims…'
export const emptyInheritedClaimsDetail = 'No inherited claims for this wallet.'
export const tryAgain = 'Try again'
export const formatClaimRepDeposits = (detail: string | number | bigint, length: string | number | bigint) => `Claim ${detail} REP (${length} deposits)`
export const claimingDeposits = 'Claiming deposits…'
export const checkingInheritedClaims = 'Checking inherited claims.'
export const locateDeposits = 'Locate deposits'
export const locatedStake = 'Located'
export const unlocatedStake = 'Still to locate'
export const rep = 'REP'
export const formatDepositCount = (count: number) => `(${count} ${count === 1 ? 'deposit' : 'deposits'})`
export const formatStakeToLocate = (outcome: string) => `Your REP staked on ${outcome}`
export const unlocatedStakeSafe = 'Your REP is safe. This device is missing some deposit numbers.'
export const depositsCheckedTail = ' deposits checked'
export const manualDepositLookup = 'I know the deposit number'
export const depositNumber = 'Deposit number'
export const checking = 'Checking…'
export const checkDeposit = 'Check deposit'
export const depositCheckTimeout = 'Deposit check timed out.'
export const depositSearchLagging = 'The RPC is behind the last searched block. Try again.'
export const searchFailedError = 'Deposit search could not finish.'
export const formatMissingDepositsDetail = (remaining: string) => `Couldn't find deposits for ${remaining}. Your REP is safe.`
export const searchAgain = 'Search again'

export const keepTabOpen = 'Keep this tab open.'
export const formatDepositSearchProgress = (done: bigint, total: bigint, remaining: string) => `${done} of ${total} checked · about ${remaining} left`

export const inheritedClaimTimeout = 'Preparing claims took too long.'
export const inheritedClaimFailure = 'Unable to prepare inherited claims.'
export const formatInheritedClaimProgress = (done: bigint, total: bigint) => `${done} of ${total}`

export const invalidDepositIndex = 'Enter a valid deposit number.'
export const depositWrongOwner = 'This deposit belongs to another address.'
export const depositAlreadyClaimed = 'This deposit was already claimed.'
export const depositCheckFailed = 'Could not check that deposit.'
export const depositNotFound = (index: bigint, outcome: string) => `There is no deposit #${index} on ${outcome}.`

export const searchTimedOut = 'Deposit search timed out.'
