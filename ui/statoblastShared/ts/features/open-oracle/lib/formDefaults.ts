import type { OpenOracleCreateFormState, OpenOracleFormState } from '../../../types/app.js'

const DEFAULT_OPEN_ORACLE_DISPUTE_DELAY_SECONDS = '3600'
const DEFAULT_OPEN_ORACLE_SETTLEMENT_DELAY_SECONDS = '86400'

export function getDefaultOpenOracleFormState(): OpenOracleFormState {
	return {
		amount1: '0',
		amount2: '0',
		disputeNewAmount1: '',
		disputeNewAmount2: '',
		reportId: '',
		stateHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
	}
}

/** The ETH sent equals the settler reward. The multiplier is a decimal such as 1.5. */
export function getDefaultOpenOracleCreateFormState(): OpenOracleCreateFormState {
	return {
		disputeDelay: DEFAULT_OPEN_ORACLE_DISPUTE_DELAY_SECONDS,
		escalationHalt: '0',
		exactToken1Report: '0',
		initialToken2Amount: '0',
		feePercentage: '0',
		multiplier: '1',
		protocolFee: '0',
		settlementTime: DEFAULT_OPEN_ORACLE_SETTLEMENT_DELAY_SECONDS,
		settlerRewardEthAmount: '0',
		token1Address: '',
		token2Address: '',
	}
}
