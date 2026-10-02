import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
export const migrateShares = 'Migrate shares'
export const mintCompleteSets = 'Mint complete sets'
export const redeemCompleteSets = 'Redeem complete sets'
export const redeemResolvedSharesTitle = 'Redeem resolved shares'
export const childDeployed = 'Child deployed'
export const childNotDeployed = 'Child not deployed'
export const clear = 'Clear'
export const loadingForkQuestionDetails = 'Loading fork question details…'
export const loadingForkTargetUniverses = 'Loading fork target universes…'
export const formatMalformedOutcomeLabel = (outcomeIndex: string) => `Malformed (${outcomeIndex})`
export const selectAll = 'Select all'
export const childTargetsLockedReason = 'Child-universe targets unlock after this universe forks.'
export const formatActionUnavailableReason = (actionLabel: string) => `${actionLabel} is not available right now.`
export const redeemCompleteSetsAmount = 'ETH to redeem'
export const redeemCompleteSetsFeeDetail = 'The pool deducts accrued holding fees before redeeming, so you may receive slightly less ETH than shown. Max redeems every complete set you hold.'
export const shareMigrationWalletRequiredReason = commonCopy.formatConnectWalletBefore('migrating shares')
export const completeSetMintWalletRequiredReason = commonCopy.formatConnectWalletBefore('minting complete sets')
export const completeSetBurnWalletRequiredReason = commonCopy.formatConnectWalletBefore('redeeming complete sets')
export const shareRedemptionWalletRequiredReason = commonCopy.formatConnectWalletBefore('redeeming shares')
export const loadingWalletShareBalances = 'Loading wallet share balances.'
export const shareMigrationPoolRequiredReason = 'Select a pool before migrating shares.'
export const completeSetMintPoolRequiredReason = 'Select a pool before minting complete sets.'
export const completeSetBurnPoolRequiredReason = 'Select a pool before redeeming complete sets.'
export const shareRedemptionPoolRequiredReason = 'Select a pool before redeeming shares.'
export const loadingForkTargetUniversesReason = 'Loading fork target universes.'
export const forkTargetsRefreshRequired = 'Refresh the fork target universes.'
export const shareMigrationRequiresFork = 'Available only after this pool forks.'
export const mintCapacityUnavailable = 'Mint capacity unavailable. Refresh pool to retry.'
export const migrateForkedShares = 'Migrate forked shares'
export const shareMigrationDescription = 'After this pool forks, carry your shares for one outcome into the child universes you choose.'
export const migrateForkedSharesTitle = 'Migrate forked shares'
export const migratingShares = 'Migrating shares…'
export const marketFinalizedReason = 'This market has already finalized.'
export const mintCompleteSetsAmount = 'Mint complete sets amount'
export const mintCompleteSetsActionLabel = 'Mint complete sets'
export const completeSetMintDescription = 'Lock collateral to mint a fresh Yes, No, and Invalid share set for this pool.'
export const mintingCompleteSets = 'Minting complete sets…'
export const mintCapacityEmpty = 'No mint capacity remaining.'
export const formatNoSharesAvailableToMigrateReason = (outcomeLabel: string) => `No ${outcomeLabel} shares available to migrate.`
export const redeemCompleteSetsActionLabel = 'Redeem complete sets'
export const completeSetBurnDescription = 'Burn matching Yes, No, and Invalid shares to recover collateral from the current pool.'
export const redeemingCompleteSets = 'Redeeming complete sets…'
export const redeemSharesActionLabel = 'Redeem resolved shares'
export const resolvedShareRedemptionDescription = 'Redeem final winning shares after the selected pool fully resolves.'
export const redeemingShares = 'Redeeming shares…'
export const completeSetBalanceLimitDetail = 'Limited by your smallest Yes, No, or Invalid balance.'
export const redeemableCompleteSets = 'Redeemable complete sets'
export const walletBalancesUnavailable = 'Wallet balances are still loading.'
export const shareOutcomeToMigrate = 'Share outcome to migrate'
export const shares = 'Shares'
export const poolResolutionRequired = 'Wait for the selected pool to resolve before redeeming shares.'
export const yourHoldings = 'Your holdings'
export const walletEth = 'Wallet ETH'
export const availableToMint = 'Available to mint'

export const forkDetailsUnavailable = 'Fork details unavailable. Refresh pool to retry.'
export const shareBalancesUnavailable = 'Share balances unavailable. Refresh pool to retry.'

export const shareBackingDetail = 'ETH values assume the outcome wins; they are not sale quotes.'

export const actionUnavailableReason = 'This action is unavailable in the current pool state.'
export const formatMaxKeepsGasReserveHint = (gasReserve: string) => `Max keeps ${gasReserve} in your wallet for gas.`
export const mintingPausedDuringDispute = 'Minting is paused while the outcome is disputed.'
export const formatNoWinningSharesReason = (outcomeLabel: string) => `No winning ${outcomeLabel} shares to redeem.`
export const formatWinningOutcomeShares = (outcomeLabel: string) => `Winning ${outcomeLabel} shares`
export const expectedEthPayout = 'Expected ETH payout'
export const resolvedShareRedemptionFeeDetail = 'Burns every winning share you hold. The pool deducts accrued holding fees first, so the payout may be slightly lower.'
export const availableToRedeem = 'Available to redeem'
export const setsUnit = 'sets'
export const sharesUnit = 'shares'
export const formatShareOutcomeOption = (outcomeLabel: string, amount: string) => `${outcomeLabel} (${amount} shares)`
export const formatMigratingShares = (amount: string, outcomeLabel: string) => `Migrating ${amount} ${outcomeLabel} shares`
export const shareMigrationIrreversible = 'Migration cannot be undone.'
export const formatMigrateSharesReviewTitle = (outcomeLabel: string) => `Migrate ${outcomeLabel} shares`
export const formatMigrateSharesReviewUnit = (outcomeLabel: string) => `${outcomeLabel} shares`
export const formatMigrateSharesReviewDescription = (outcomeLabel: string) => `Moves your whole ${outcomeLabel} balance into the selected child universes. ${shareMigrationIrreversible}`
