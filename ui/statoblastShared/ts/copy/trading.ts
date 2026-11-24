import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
export const migrateShares = 'Migrate shares'
export const mintCompleteSets = 'Mint complete sets'
export const continueInWallet = 'Continue in wallet'
export const redeemCompleteSets = 'Redeem complete sets'
export const estimatedRedemptionCollateral = 'Estimated collateral received'
export const estimatedRedemptionRep = 'Estimated REP received'
export const redeemSharesReview = 'Redeem your winning shares for collateral and any REP available in this universe.'
export const redeemSetsReview = 'Redeem the selected complete sets for collateral and any REP available in this universe.'
export const redemptionNeedsBlock = 'Couldn’t check the redemption at a confirmed block. Try again.'
export const redemptionInsufficientShares = 'Your balance is too low for this redemption. Review the available shares and try again.'
export const redemptionEstimate = (shares: string, collateral: string, rep: string) => `Redeem ${shares} for approximately ${collateral} and ${rep} in this universe.`
export const childDeployed = 'Child deployed'
export const childNotDeployed = 'Child not deployed'
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
export const shareMigrationDescription = 'After this universe forks, carry your shares for one outcome into the child universes you choose.'
export const migratingShares = 'Migrating shares…'
export const mintCompleteSetsAmount = 'Collateral amount'
export const completeSetMintDescription = 'Lock collateral to mint a fresh Yes, No, and Invalid share set for this question.'
export const mintingCompleteSets = 'Minting complete sets…'
export const mintCapacityEmpty = 'No mint capacity remaining.'
export const formatNoSharesAvailableToMigrateReason = (outcomeLabel: string) => `You hold no ${outcomeLabel} shares to migrate.`
export const completeSetBurnDescription = 'Burn matching Yes, No, and Invalid shares to recover collateral from the current question.'
export const redeemingCompleteSets = 'Redeeming complete sets…'
export const redeemResolvedShares = 'Redeem winning shares'
export const resolvedShareRedemptionDescription = 'Redeem final winning shares after the selected question fully resolves.'
export const redeemingShares = 'Redeeming shares…'
export const completeSetBalanceLimitDetail = 'Limited by your smallest Yes, No, or Invalid balance.'
export const redeemableCompleteSets = 'Redeemable complete sets'
export const walletBalancesUnavailable = 'Wallet balances are still loading.'
export const shareOutcomeToMigrate = 'Share outcome to migrate'
export const shares = 'Shares'
export const poolResolutionRequired = 'Wait for the selected question to resolve before redeeming shares.'
export const yourHoldings = 'Your holdings'
export const noSharesHeld = 'You hold no shares for this question.'
export const availableToMint = 'Available to mint'

export const forkDetailsUnavailable = 'Fork details unavailable. Refresh to retry.'
export const shareBalancesUnavailable = 'Share balances unavailable. Refresh to retry.'

export const shareBackingDetail = 'Collateral values assume the outcome wins; they are not sale quotes.'

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

export const sharedPoolCapacityAtReview = 'Quoted before submission'
export const sharedPoolPurchaseDetail = 'Purchases use shared REP backing. The transaction includes the quoted purchase fee in addition to this mint amount.'

export const mintingClosedAtQuestionEnd = 'Minting closed when the question ended.'
