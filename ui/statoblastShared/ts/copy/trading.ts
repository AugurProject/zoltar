import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
export const migrateShares = 'Migrate shares'
export const mintCompleteSets = 'Mint complete sets'
export const redeemCompleteSets = 'Redeem complete sets'
export const estimatedRedemptionCollateral = 'Estimated collateral received'
export const estimatedRedemptionRep = 'Estimated REP received'
export const redeemSharesReview = 'Redeem your winning shares for collateral and any REP available in this universe.'
export const redeemSetsReview = 'Redeem the selected complete sets for collateral and any REP available in this universe.'
export const redemptionNeedsBlock = 'Couldn’t check the redemption at a confirmed block. Try again.'
export const redemptionInsufficientShares = 'Your balance is too low for this redemption. Review the available shares and try again.'
export const redemptionEstimate = (shares: string, collateral: string, rep: string) => `Redeem ${shares} for approximately ${collateral} and ${rep} in this universe.`
export const childDeployed = 'Created'
export const childNotDeployed = 'Not created yet'
export const clear = 'Clear'
export const loadingForkQuestionDetails = 'Loading fork question details…'
export const loadingForkTargetUniverses = 'Loading child universes…'
export const loadingShareMigrationTargetPools = 'Loading this question in child universes…'
export const shareMigrationTargetPoolsUnavailable = 'This question is unavailable in child universes. Refresh to retry.'
export const missingChildPoolBlocker = 'This selection includes a child universe where this question is not registered yet. Migrate into each such child universe separately.'
export const formatSharesAlreadyMigratedReason = (outcomeLabel: string) => `Your ${outcomeLabel} shares are already migrated into the selected child universes.`
export const formatSharesMigratedIntoEveryChildReason = (outcomeLabel: string) => `Your ${outcomeLabel} shares are already migrated into every child universe.`
export const noChildPoolForBatchMigration = 'This question is not registered in any child universe yet. Select one child universe; migrating into it registers the question there.'
export const formatMalformedOutcomeLabel = (outcomeIndex: string) => `Malformed (${outcomeIndex})`
export const selectAll = 'Select all'
export const childTargetsLockedReason = 'Child universe targets unlock after this universe forks.'
export const redeemCompleteSetsAmount = 'Complete sets to redeem'
export const availableRecoveryRep = 'REP available to redeem'
export const expectedRepPayout = 'Expected REP payout'
export const redeemCompleteSetsFeeDetail = 'The security pool deducts accrued holding fees before redeeming, so you may receive slightly less collateral than shown. Max redeems every complete set you hold.'
export const shareMigrationWalletRequiredReason = commonCopy.formatConnectWalletBefore('migrating shares')
export const completeSetMintWalletRequiredReason = commonCopy.formatConnectWalletBefore('minting complete sets')
export const completeSetBurnWalletRequiredReason = commonCopy.formatConnectWalletBefore('redeeming complete sets')
export const shareRedemptionWalletRequiredReason = commonCopy.formatConnectWalletBefore('redeeming shares')
export const loadingWalletShareBalances = 'Loading wallet share balances…'
export const shareMigrationPoolRequiredReason = 'Select a question before migrating shares.'
export const completeSetMintPoolRequiredReason = 'Select a question before minting complete sets.'
export const completeSetBurnPoolRequiredReason = 'Select a question before redeeming complete sets.'
export const shareRedemptionPoolRequiredReason = 'Select a question before redeeming shares.'
export const forkTargetsRefreshRequired = 'Refresh the child universes.'
export const shareMigrationRequiresFork = 'Available only after this universe forks.'
export const mintCapacityUnavailable = 'Mint capacity unavailable. Refresh to retry.'
export const migrateForkedShares = 'Migrate forked shares'
export const migratingShares = 'Migrating shares…'
export const mintCompleteSetsAmount = 'Collateral amount'
export const mintingCompleteSets = 'Minting complete sets…'
export const mintCapacityEmpty = 'No mint capacity remaining.'
export const formatNoSharesAvailableToMigrateReason = (outcomeLabel: string) => `You hold no ${outcomeLabel} shares to migrate.`
export const redeemingCompleteSets = 'Redeeming complete sets…'
export const redeemResolvedShares = 'Redeem winning shares'
export const redeemingShares = 'Redeeming shares…'
export const completeSetBalanceLimitDetail = 'Limited by your smallest Yes, No, or Invalid balance.'
export const redeemableCompleteSets = 'Redeemable complete sets'
export const walletBalancesUnavailable = 'Wallet balances are still loading.'
export const shareOutcomeToMigrate = 'Share outcome to migrate'
export const poolResolutionRequired = 'Wait for the selected question to resolve before redeeming shares.'
export const yourHoldings = 'Your holdings'
export const noSharesHeld = 'You hold no shares for this question.'

export const forkDetailsUnavailable = 'Fork details unavailable. Refresh to retry.'
export const shareBalancesUnavailable = 'Share balances unavailable. Refresh to retry.'

export const actionUnavailableReason = 'This action is unavailable in the current question state.'
export const formatMaxKeepsGasReserveHint = (gasReserve: string) => `Max keeps ${gasReserve} in your wallet for gas.`
export const mintingPausedDuringDispute = 'Minting is closed for this question once reporting starts.'
export const formatNoWinningSharesReason = (outcomeLabel: string) => `You hold no winning ${outcomeLabel} shares to redeem.`
export const formatWinningOutcomeShares = (outcomeLabel: string) => `Winning ${outcomeLabel} shares`
export const expectedCollateralPayout = 'Expected collateral payout'
export const resolvedShareRedemptionFeeDetail = 'Burns every winning share you hold. The security pool deducts accrued holding fees first, so the payout may be slightly lower.'
export const availableToRedeem = 'Available to redeem'
export const setsUnit = 'sets'
export const sharesUnit = 'shares'
export const formatShareOutcomeOption = (outcomeLabel: string, amount: string) => `${outcomeLabel} (${amount} shares)`
export const formatMigratingShares = (amount: string, outcomeLabel: string) => `Migrating ${amount} ${outcomeLabel} shares`
export const shareMigrationIrreversible = 'Migration cannot be undone.'
export const formatMigrateSharesReviewTitle = (outcomeLabel: string) => `Migrate ${outcomeLabel} shares`
export const formatOutcomeShares = (outcomeLabel: string) => `${outcomeLabel} shares`
export const formatMigrateSharesReviewDescription = (outcomeLabel: string) => `Creates your whole ${outcomeLabel} balance in each selected child universe and keeps the source balance locked. ${shareMigrationIrreversible}`
export const mintAmountRequired = 'Enter a mint amount.'
export const redeemAmountRequired = 'Enter a redeem amount.'
export const redeemCollateralLoading = 'Loading collateral details…'

export const mintingClosedAtQuestionEnd = 'Minting closed when the question ended.'

export const shareActions = 'Share actions'
export const mintSets = 'Mint sets'
export const redeemSets = 'Redeem sets'
export const onlyWinningOutcome = 'Only one outcome wins.'
export const howSharesWork = 'How shares work'
export const shareBasics = 'Mint a set with collateral. Redeem a complete set for collateral minus holding fees. After resolution, only winning shares pay.'

export const limits = 'Limits'
export const maximumMintFee = 'Max fee'
export const minimumMintShares = 'Min complete sets'
export const mintCollateral = 'Collateral'
export const mintFee = 'Fee'
export const youPay = 'You pay'
export const sharesOfEachOutcome = 'Your shares of each outcome'
export const freeMintCapacity = 'Free capacity'
export const formatMintWallet = (symbol: string) => `Wallet ${symbol}`
export const formatMintLimits = (fee: string, symbol: string, shares: string) => `Pay at most ${fee} ${symbol} in fees and receive at least ${shares} sets`

export const checkingMintMaximum = 'Checking the maximum collateral amount…'

export const tradingReadFailed = 'Failed to load trading details.'
export const invalidMintAmount = 'Invalid mint amount.'
export const invalidRedeemAmount = 'Invalid redeem amount.'
export const collateralDetailsLoading = 'Collateral metadata is not loaded. Wait for funding details and try again.'

export const noMintCapacityWithoutCommitment = 'No mint capacity. No position has an active commitment.'
export const matchingCompleteSetSharesRequired = 'You need matching Yes, No, and Invalid shares to redeem complete sets.'
export const completeSetExchangeRateUnavailable = 'Minting is unavailable because this question has complete-set shares but no collateral.'
export const mintQuestionSelectionRequired = 'Select a question before minting.'
export const loadingMintCapacity = 'Loading mint capacity…'
export const noRemainingMintCapacity = 'No mint capacity remaining.'
export const enterValidMintAmount = 'Enter a valid mint amount.'
export const redeemSetsQuestionSelectionRequired = 'Select a question before redeeming complete sets.'
export const enterValidRedeemAmount = 'Enter a valid redeem amount.'
export const migrateSharesQuestionSelectionRequired = 'Select a question before migrating shares.'
export const invalidShareMigrationTargets = 'Select valid target child universes.'
export const shareMigrationTargetRequired = 'Select at least one target child universe.'
export const duplicateShareMigrationTarget = 'Select each target child universe only once.'
export const mintCompleteSetsWalletAction = 'minting complete sets'
export const redeemCompleteSetsWalletAction = 'redeeming complete sets'
export const migrateSharesWalletAction = 'migrating shares'

export const sharesRefreshTimeout = 'Shares refresh timed out.'
export const mintCompleteSetsPendingTitle = 'Minting complete sets'
export const redeemCompleteSetsPendingTitle = 'Redeeming complete sets'
export const migrateSharesPendingTitle = 'Migrating shares'
export const redeemSharesPendingTitle = 'Redeeming shares'
export const mintCompleteSetsSuccessTitle = 'Complete sets minted'
export const redeemCompleteSetsSuccessTitle = 'Complete sets redeemed'
export const migrateSharesSuccessTitle = 'Shares migrated'
export const redeemSharesSuccessTitle = 'Shares redeemed'
export const mintCompleteSetsFailureTitle = 'Mint failed'
export const redeemCompleteSetsFailureTitle = 'Complete-set redemption failed'
export const migrateSharesFailureTitle = 'Share migration failed'
export const redeemSharesFailureTitle = 'Share redemption failed'
export const postTransactionSharesRefreshFailed = 'Trading transaction succeeded, but refreshing trading details failed.'
export const mintCompleteSetsFailed = 'Failed to mint complete sets.'
export const redeemCompleteSetsFailed = 'Failed to redeem complete sets.'
export const migrateSharesFailed = 'Failed to migrate shares.'
export const redeemSharesFailed = 'Failed to redeem shares.'
export const targetChildUniverses = 'Target child universes'
export const formatMaxMintCapacity = (maximum: string) => `Max mint capacity is ${maximum}.`
export const formatMintWalletFundingRequired = (required: string, reserve: string) => `Need ${required} in this wallet to mint the selected amount and keep ${reserve} for gas.`
export const formatMaxRedeemableAmount = (maximum: string) => `Max redeemable amount is ${maximum}.`
export const formatNoSharesToMigrate = (outcome: string) => `No ${outcome} shares available to migrate.`

export const completeSets = 'Complete sets'
