import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'

export type TradingFormState = {
	completeSetAmount: string
	mintMaximumFee?: string
	mintMinimumShares?: string
	redeemAmount: string
	questionLedgerAddress: string
	selectedShareOutcome: ReportingOutcomeKey
	targetOutcomeIndexes: string
}

export type OpenOracleFormState = {
	amount1: string
	amount2: string
	disputeNewAmount1: string
	disputeNewAmount2: string
	reportId: string
	stateHash: string
}

export type OpenOracleCreateFormState = {
	exactToken1Report: string
	initialToken2Amount: string
	escalationHalt: string
	feePercentage: string
	multiplier: string
	protocolFee: string
	settlementTime: string
	settlerRewardEthAmount: string
	token1Address: string
	token2Address: string
	disputeDelay: string
}

export type ReportingWithdrawDepositIndexesByOutcome = {
	invalid: bigint[]
	yes: bigint[]
	no: bigint[]
}

export type ReportingFormState = {
	reportAmount: string
	questionLedgerAddress: string
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedWithdrawDepositIndexesByOutcome: ReportingWithdrawDepositIndexesByOutcome
}

export type QuestionLedgerLifecycleState = 'operational' | 'ended' | 'poolForked' | 'forkMigration'

export type PoolTab = 'capital' | 'questions' | 'price' | 'liquidations' | 'fork'
type QuestionTab = 'shares' | 'reporting' | 'claims'
export type StatoblastQuestionPage = { kind: 'question'; pool: Address; questionId: bigint; tab: QuestionTab; sharesAction?: 'mint' | 'redeem' | undefined }
export type StatoblastPoolPage = { kind: 'pool'; pool: Address; tab: PoolTab; positionId?: bigint | undefined }
export type StatoblastPage = StatoblastPoolPage | StatoblastQuestionPage | { kind: 'choose-universe' | 'watchlist' | 'migrate-rep' | 'deploy-pool' | 'not-found' }
