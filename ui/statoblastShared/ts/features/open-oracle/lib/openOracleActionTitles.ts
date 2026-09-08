import type { OpenOracleActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

type OpenOracleActionTitles = Readonly<{ failure: string; pending: string; success: string }>

const OPEN_ORACLE_ACTION_TITLES = {
	approveToken1: { failure: 'Base token approval failed', pending: 'Approving base token', success: 'Base token approved' },
	approveToken2: { failure: 'Quote token approval failed', pending: 'Approving quote token', success: 'Quote token approved' },
	createReportInstance: { failure: 'Report creation failed', pending: 'Creating standalone oracle report', success: 'Standalone oracle report created' },
	dispute: { failure: 'Dispute failed', pending: 'Submitting dispute', success: 'Dispute submitted' },
	executeStagedOperation: { failure: 'Staged operation failed', pending: 'Executing staged operation', success: 'Staged operation executed' },
	queueOperation: { failure: 'Queue operation failed', pending: 'Queueing operation', success: 'Operation queued' },
	requestPrice: { failure: 'Price request failed', pending: 'Requesting price', success: 'Price requested' },
	settle: { failure: 'Settlement failed', pending: 'Settling report', success: 'Report settled' },
	withdrawBalance: { failure: 'Oracle balance withdrawal failed', pending: 'Withdrawing Oracle balance', success: 'Oracle balance withdrawn' },
	wrapWeth: { failure: 'ETH wrap failed', pending: 'Wrapping ETH to WETH', success: 'ETH wrapped to WETH' },
} satisfies Record<OpenOracleActionResult['action'], OpenOracleActionTitles>

export const getOpenOraclePendingTitle = (actionName: OpenOracleActionResult['action']) => OPEN_ORACLE_ACTION_TITLES[actionName].pending
export const getOpenOracleSuccessTitle = (actionName: OpenOracleActionResult['action']) => OPEN_ORACLE_ACTION_TITLES[actionName].success
export const getOpenOracleFailureTitle = (actionName: OpenOracleActionResult['action']) => OPEN_ORACLE_ACTION_TITLES[actionName].failure
