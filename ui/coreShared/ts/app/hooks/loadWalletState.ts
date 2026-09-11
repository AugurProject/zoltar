import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getErrorMessage, hasErrorCode, hasErrorMessage } from '../../lib/errors.js'
import type { AccountState } from '../../types/app.js'

type LoadWalletStateParameters = {
	chainIdPromise: Promise<string> | undefined
	connectedAddress: Address | undefined
	ethBalanceAttoEthPromise: Promise<bigint> | undefined
	fallbackChainId?: string
	getAccountState: () => AccountState
	isCurrent: () => boolean
	setAccountState: (state: AccountState) => void
	setEthBalanceErrorMessage?: (message: string | undefined) => void
	setErrorMessage: (message: string | undefined) => void
	setWethBalanceAttoEthErrorMessage?: (message: string | undefined) => void
	trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
	wethBalanceAttoEthPromise: Promise<bigint> | undefined
}

export async function loadWalletState({ chainIdPromise, connectedAddress, ethBalanceAttoEthPromise, fallbackChainId, getAccountState, isCurrent, setAccountState, setErrorMessage, setEthBalanceErrorMessage, setWethBalanceAttoEthErrorMessage, trackLoad, wethBalanceAttoEthPromise }: LoadWalletStateParameters) {
	if (connectedAddress === undefined || chainIdPromise === undefined || ethBalanceAttoEthPromise === undefined || wethBalanceAttoEthPromise === undefined) return
	const resolvedFallbackChainId = fallbackChainId ?? '0x1'
	const ethBalanceAttoEthError = setEthBalanceErrorMessage ?? setErrorMessage
	const wethBalanceAttoEthError = setWethBalanceAttoEthErrorMessage ?? setErrorMessage

	void trackLoad(async () => {
		try {
			const chainId = await chainIdPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId })
		} catch (error) {
			if (!hasErrorCode(error) && !hasErrorMessage(error)) throw error
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId: resolvedFallbackChainId })
		}
	})

	void trackLoad(async () => {
		try {
			const ethBalanceAttoEth = await ethBalanceAttoEthPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalanceAttoEth })
		} catch (error) {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalanceAttoEth: undefined })
			ethBalanceAttoEthError(getErrorMessage(error, setEthBalanceErrorMessage === undefined ? 'Failed to refresh wallet balances' : 'Failed to refresh ETH balance'))
		}
	})

	void trackLoad(async () => {
		try {
			const wethBalanceAttoEth = await wethBalanceAttoEthPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalanceAttoEth })
		} catch (error) {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalanceAttoEth: undefined })
			wethBalanceAttoEthError(getErrorMessage(error, setWethBalanceAttoEthErrorMessage === undefined ? 'Failed to refresh wallet balances' : 'Failed to refresh WETH balance'))
		}
	})
}
