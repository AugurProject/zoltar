import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'

export const applicationTitle = 'Zoltar'
export const forkZoltar = 'Fork universe'
export const migrateRep = 'Migrate REP'
export const alreadyForkedReason = 'This universe has already forked.'
export const forkQuestionRequiredReason = 'Select a valid fork question to continue.'
export const forkQuestionTimeLoadingReason = 'Loading chain time…'
export const formatForkQuestionActiveReason = (endTime: CopyTemplateValue, relativeEndTime: CopyTemplateValue) => `The selected question must end before the universe can fork. It ends ${endTime} (${relativeEndTime}).`
export const forkEconomicsUnavailableReason = 'Fork burn terms could not be loaded.'
export const forkRepInsufficientReason = 'Insufficient REP to meet the fork threshold.'
export const forkRepApprovalRequiredReason = 'Approve enough REP to continue.'
export const formatForkConfirmation = (permanentBurn: CopyTemplateValue) => `I understand forking permanently burns ${permanentBurn} REP and cannot be undone.`
export const forkConfirmationUnknownBurn = 'I understand forking permanently burns REP and cannot be undone.'
export const forkConfirmationRequired = 'Confirm that forking is permanent to continue.'
export const forkingActionLabel = 'forking the universe'
export const forkQuestionId = 'Fork question ID'
export const forkSubmissionPending = 'Forking universe…'
export const migrationChildUniversesEmpty = 'No child universes available.'
export const permanentRepBurn = 'Permanent REP burn'

export const migrationIntro = 'Migrating burns REP in this universe and gives you the same amount of REP in each child universe you select. It cannot be undone.'
export const migrationProgress = 'Migration steps'
export const migrationStepSelectOutcomes = 'Select outcomes'
export const migrationStepReview = 'Review'
export const migrationStepDone = 'Done'
export const migrationStepNotNeeded = 'Not needed'
export const migrationStepReady = 'Ready'
export const migrationStepToDo = 'To do'
export const migrationBack = 'Back'
export const migrationContinue = 'Continue'

export const selectOutcomesDetail = 'Select every child universe that should receive your REP.'
export const outcomeHeldRep = 'You hold'
export const outcomeAlreadyMigrated = 'Already migrated'
export const formatOpenChildUniverse = (outcome: CopyTemplateValue) => `Open ${outcome} universe`
export const openChildUniverse = 'Open child universe'
export const outcomeSelectionRequired = 'Select at least one outcome.'

export const migrationAmountLabel = 'Amount to migrate'
export const formatUseAllRep = (amount: CopyTemplateValue) => `Use all ${amount}\u00a0REP`
export const migrationAmountInvalid = 'Enter a valid REP amount.'
export const formatMigrationAmountExceeded = (maxAmount: CopyTemplateValue) => `You can migrate at most ${maxAmount}\u00a0REP to these outcomes.`
export const migrationFromBalance = 'From your migration balance'
export const migrationFromWallet = 'Burned from your wallet'
export const migrationBalanceExplainer = 'Your migration balance (REP already burned here) is used before wallet REP.'
export const outcomeBalancesLoading = 'Loading migration balances…'
export const migrationBalancesReadFailed = 'Migration balances could not be loaded. Retry to continue.'

export const migrationApprovalNotNeededChildRep = 'Child-universe REP is burned directly, so no approval is needed.'
export const migrationApprovalNotNeededNoWalletRep = 'Your migration balance covers this amount, so no wallet REP needs approval.'
export const migrationApprovalLoading = 'Loading your REP approval…'
export const formatMigrationApprovalRequired = (amount: CopyTemplateValue) => `Approve ${amount}\u00a0REP to continue.`
export const migrationApprovalActionLabel = 'migrating REP'

export const formatMigrationSummary = (amount: CopyTemplateValue, outcomes: CopyTemplateValue) => `Migrate ${amount}\u00a0REP to: ${outcomes}`
export const migrationIrreversible = 'Burned REP cannot be returned to this universe.'
export const migrationMintsPerOutcome = 'Every selected child universe mints the full amount to your wallet.'
export const migratingRepPending = 'Migrating REP…'
export const migrationCompleteTitle = 'All your REP here is migrated'
export const migrationCompleteDetail = 'Every child universe has received your full migration balance.'
export const addChildRepToWalletTitle = 'Add child-universe REP to your wallet'
export const formatUnnamedOutcome = (position: CopyTemplateValue) => `Outcome ${position}`
export const migrationStepCurrent = 'Current'
export const migrationForkRequired = 'This universe must fork before REP can be migrated.'
export const walletRep = 'Wallet REP'
export const migrationBalance = 'Migration balance'

export const overview = 'Overview'
export const howZoltarWorks = 'How Zoltar works'
export const modelQuestions = 'Questions are global: anyone can create one, and any universe can use it.'
export const modelFork = 'Any ended question can fork a universe, once, into one child universe per outcome.'
export const modelMigrate = 'REP holders migrate their REP into the child universes they back; each child universe has its own REP.'
export const forkStatus = 'Fork'
export const notForked = 'Not forked'
export const universeRep = 'REP in this universe'
export const migrationStatus = 'Migration'
export const migrationAfterFork = 'Only after a fork'
export const migrationNoDeadline = 'Open, no deadline'
export const walletNotConnected = 'Wallet not connected'
export const nextStep = 'Next step'
export const connectWalletDetail = 'See your REP and whether anything needs your attention.'
export const switchNetworkAction = 'Switch network'
export const switchNetworkDetail = 'Your wallet is on another network, so balances are hidden.'
export const migrateRepDetail = 'This universe forked. Migrate your REP into the child universes you back.'
export const openChildUniverseDetail = 'This universe forked and you have no REP left to migrate here.'
export const browseQuestionsDetail = 'This universe is operational. Review questions or create one.'
export const browseUniversesAction = 'Browse universes'
export const universesTitle = 'Universes'
export const universesDescription = 'Browse the universe tree and open a universe to work in it.'
export const forkRouteDescription = 'Fork this universe with an ended question. A universe forks only once.'
export const migrateRouteDescription = 'Migrate your REP into the child universes of a fork.'
export const universeUnavailableDetail = 'Universe details could not be loaded.'
export const forkUnavailableTitle = 'Universe forked'
export const forkCompletedOn = 'Forked'
export const forkUnavailableDetail = 'A universe forks only once. Migrate REP into the child universes you back.'
export const previewMigration = 'Preview REP migration'

export const migrationWalletBalancesReason = 'Connect a wallet to read migration balances.'

export const forkRepBalanceLoadingReason = 'Loading REP balance…'
export const forkRepBalanceUnavailableReason = 'Your REP balance could not be loaded. Retry to check whether you can fork.'

export const forkRepBalanceUnavailableShortReason = 'REP balance could not be loaded.'

export const selectedOutcomes = 'Selected outcomes'
export const formatRemoveOutcome = (outcome: CopyTemplateValue) => `Remove ${outcome}`
export const formatDeployChildUniverse = (outcome: CopyTemplateValue) => `Deploy ${outcome} universe`
