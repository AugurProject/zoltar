import { OperationDefinition } from '../types.ts'

import { checkpointDefinition, deployPool, depositVault, vaultActionDefinition } from './vaults.ts'

import { completeSetDefinition } from './complete-sets.ts'

import { directEscalationDeposit, escalationDeposit } from './deposits.ts'

import { queueWithdrawal, withdrawEscalation } from './withdrawals.ts'

import { recoverSettledReport, requestOraclePrice } from './oracle.ts'

import { executeStagedLiquidation, queueLiquidation, stagedObligation } from './liquidation.ts'

import { claimForkedEscalation, forkDefinition, migrateVaultWithUnresolvedEscalation, resumeEscalation } from './forks.ts'

import { auctionDefinition, finalizeTruthAuctionRoute, refundLosingAuctionBids, settleAuctionBids, startTruthAuction } from './auctions.ts'

import { sweepResidualEscalation, withdrawForkedCarry } from './carry.ts'

export const STATOBLAST_OPERATIONS: readonly OperationDefinition[] = [
	deployPool,
	checkpointDefinition('collateral'),
	checkpointDefinition('retention'),
	depositVault,
	vaultActionDefinition('update-fees'),
	vaultActionDefinition('redeem-fees'),
	vaultActionDefinition('redeem-rep'),
	completeSetDefinition('create'),
	completeSetDefinition('redeem'),
	completeSetDefinition('winning'),
	directEscalationDeposit,
	escalationDeposit,
	queueWithdrawal,
	requestOraclePrice,
	recoverSettledReport,
	queueLiquidation,
	resumeEscalation,
	claimForkedEscalation,
	migrateVaultWithUnresolvedEscalation,
	stagedObligation('execute'),
	executeStagedLiquidation,
	stagedObligation('expire'),
	forkDefinition('initiate'),
	forkDefinition('migrate-rep'),
	forkDefinition('create-child'),
	forkDefinition('migrate-vault'),
	forkDefinition('own-question'),
	startTruthAuction,
	finalizeTruthAuctionRoute,
	settleAuctionBids,
	auctionDefinition('bid'),
	auctionDefinition('withdraw-refund'),
	withdrawEscalation,
	withdrawForkedCarry,
	sweepResidualEscalation,
	refundLosingAuctionBids,
]
