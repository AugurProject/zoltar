export const poolDetails = 'Pool details'
export const moreTools = 'More tools'
export const moreActions = 'More actions'
export const capacityLabel = 'Open interest / estimated capacity'
export const capacityUnavailable = 'Capacity needs a current price.'
export const viewReport = 'View report'
export const stagedOperationCount = (count: bigint) => `${count.toString()} staged ${count === 1n ? 'operation' : 'operations'}`
export const vaults = (count: bigint) => `${count.toString()} ${count === 1n ? 'vault' : 'vaults'}`
export const myVault = 'My vault'
export const vaultDetails = 'Vault details'
export const byAddress = 'By address'
export const backingDetails = 'Backing details'
export const healthUnknown = 'Health unavailable'
export const poolPriceUnavailable = 'Oracle price unavailable'
export const poolPriceExpired = 'Oracle price expired'
export const openVault = 'Open vault'

export const allVaults = 'All vaults'

export const allPools = 'All pools'
export const poolStage = 'Pool stage'
export const lifecycleStepLabels = {
	escalation: 'Escalation',
	forkMigration: 'Fork / Migration',
	operational: 'Operational',
	settled: 'Settled',
	truthAuction: 'Truth auction',
} as const
export const lifecycleStepProgress = (step: number, total: number, label: string) => `Stage ${step.toString()} of ${total.toString()} · ${label}`
export const whatYouCanDoNow = 'What you can do now'
export const nothingToDoNow = 'Nothing needs your action on this pool right now.'
export const deadlineLabel = 'By'
export const actionLabels = {
	bidTruthAuction: 'Bid in the truth auction',
	claimFees: 'Claim fees',
	claimForkSettlement: 'Settle fork positions',
	connectWallet: 'Connect a wallet to see actions for your positions',
	depositRep: 'Deposit REP to back this pool',
	escalationStake: 'Your escalation stake is locked',
	manageVault: 'Manage your vault',
	migrateVault: 'Migrate your vault',
	mintShares: 'Mint complete sets',
	redeemShares: 'Redeem your shares',
	reportOrEscalate: 'Report or escalate an outcome',
	reviewForkMigration: 'Review fork & migration',
	reviewOracle: 'Oracle price unavailable',
	reviewStagedOperations: 'Staged operations waiting',
	submitFirstReport: 'Submit the first report',
	triggerFork: 'Trigger the universe fork',
	viewPendingReport: 'Oracle report pending',
	withdrawEscalation: 'Withdraw escalation stake',
	withdrawVaultRep: 'Withdraw vault REP',
} as const
export const actionButtonLabels = {
	'fork-workflow': 'Open fork & migration',
	'price-oracle': 'Review oracle',
	reporting: 'Open reporting',
	'staged-operations': 'Review operations',
	trading: 'Open shares',
	vaults: 'Open vaults',
} as const
