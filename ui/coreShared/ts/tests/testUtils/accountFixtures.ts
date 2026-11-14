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

/** No wallet connected, so the account, its chain, and its balances are all unknown. */
export const disconnectedAccountState: AccountState = {
	address: undefined,
	chainId: undefined,
	ethBalanceAttoEth: undefined,
	wethBalanceAttoEth: undefined,
}

/** Header wallet controls once the wallet bootstrap finished without a connected wallet; every action does nothing. */
export const disconnectedOverviewWalletProps = {
	accountState: disconnectedAccountState,
	isConnectingWallet: false,
	isManagingWallet: false,
	isRefreshing: false,
	onChangeWallet: () => undefined,
	onConnect: () => undefined,
	onDisconnectWallet: () => undefined,
	onSwitchNetwork: () => undefined,
	walletBootstrapComplete: true,
}
