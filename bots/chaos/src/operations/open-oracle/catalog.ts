import type { OperationDefinition } from '../types.ts'
import { deposit, dust } from './credit-deposits.ts'
import { creditDefinition } from './credit-withdrawals.ts'
import { approveInternal } from './internal-approvals.ts'
import { reportOperation } from './report-resolution.ts'
import { report } from './reports.ts'
import { approveWeth, wethDefinition } from './weth.ts'

export const OPEN_ORACLE_OPERATIONS: readonly OperationDefinition[] = [
	wethDefinition('wrap'),
	wethDefinition('unwrap'),
	deposit,
	creditDefinition('withdraw'),
	creditDefinition('withdraw-to'),
	creditDefinition('push-or-credit'),
	dust,
	report,
	reportOperation('dispute'),
	reportOperation('settle'),
	approveInternal,
	approveWeth,
]
