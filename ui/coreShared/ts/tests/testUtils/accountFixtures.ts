import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { AccountState } from '../../types/app.js'

/** A connected Sepolia account with no ETH or WETH; tests override the balances they depend on. */
export function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0xaa36a7',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
		...overrides,
	}
}
