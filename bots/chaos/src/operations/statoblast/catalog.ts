import { capitalAction, capitalPolicy, depositCapital } from './capital.ts'
import { initializeChildHistory } from './child-preparation.ts'
import { OperationDefinition } from '../types.ts'

import { checkpointDefinition, deployPool } from './vaults.ts'

import { completeSetDefinition } from './complete-sets.ts'

import { directEscalationDeposit } from './direct-deposits.ts'
import { escalationDeposit } from './deposits.ts'

import { withdrawEscalation } from './reporter-claims.ts'

import { recoverSettledReport, requestOraclePrice } from './oracle.ts'

import { forkDefinition, resumeEscalation } from './forks.ts'

import { auctionDefinition, finalizeCollateralRepairAuctionRoute, refundLosingAuctionBids, settleAuctionBids, startCollateralRepairAuction } from './auctions.ts'

import { sweepResidualEscalation, withdrawForkedCarry, prepareInheritedClaim } from './carry.ts'

export const STATOBLAST_OPERATIONS: readonly OperationDefinition[] = [
	initializeChildHistory,
	deployPool,
	checkpointDefinition('collateral'),
	checkpointDefinition('retention'),
	depositCapital,
	capitalPolicy('commitment'),
	capitalPolicy('health'),
	capitalAction('retire'),
	capitalAction('serve-retirement'),
	capitalAction('claim'),
	capitalAction('withdraw'),
	completeSetDefinition('create'),
	completeSetDefinition('redeem'),
	completeSetDefinition('winning'),
	directEscalationDeposit,
	escalationDeposit,
	requestOraclePrice,
	recoverSettledReport,
	resumeEscalation,
	forkDefinition('initiate'),
	forkDefinition('create-child'),
	forkDefinition('own-question'),
	startCollateralRepairAuction,
	finalizeCollateralRepairAuctionRoute,
	settleAuctionBids,
	auctionDefinition('bid'),
	auctionDefinition('withdraw-refund'),
	withdrawEscalation,
	withdrawForkedCarry,
	prepareInheritedClaim,
	sweepResidualEscalation,
	refundLosingAuctionBids,
]
