import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getDeploymentSteps, loadDeploymentStatuses, loadGenesisRepBalance } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { MAINNET_CHAIN_ID } from '../lib/network.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

const REFRESH_INTERVAL_MS = 15_000

async function loadAccountBalances(readClient: ReturnType<typeof createReadClient>, connectedAddress: AccountState['address']) {
	if (connectedAddress === undefined) {
		return {
			ethBalance: undefined,
			repBalance: undefined,
		}
	}

	const [ethBalance, repBalance] = await Promise.all([readClient.getBalance({ address: connectedAddress }), loadGenesisRepBalance(readClient, connectedAddress).catch(() => undefined)])

	return {
		ethBalance,
		repBalance,
	}
}

export function useOnchainState() {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		ethBalance: undefined,
		repBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getInjectedEthereum() !== undefined)
	const refreshLoadCount = useSignal(0)
	const refreshRequestId = useSignal(0)
	const errorMessage = useSignal<string | undefined>(undefined)

	const refreshState = async () => {
		const requestId = refreshRequestId.value + 1
		refreshRequestId.value = requestId
		refreshLoadCount.value += 1
		const ethereum = getInjectedEthereum()
		try {
			const readClient = createReadClient()
			const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' })
			const connectedAddress = normalizeAccount(accounts[0])
			const chainId = ethereum === undefined ? MAINNET_CHAIN_ID : await ethereum.request({ method: 'eth_chainId' })

			const [statuses, balances] = await Promise.all([loadDeploymentStatuses(readClient), loadAccountBalances(readClient, connectedAddress)])
			if (requestId !== refreshRequestId.value) return

			deploymentStatuses.value = statuses
			accountState.value = {
				address: connectedAddress,
				chainId,
				ethBalance: balances.ethBalance,
				repBalance: balances.repBalance,
			}
			hasInjectedWallet.value = ethereum !== undefined
			errorMessage.value = undefined
		} catch (error) {
			if (requestId !== refreshRequestId.value) return
			errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
		} finally {
			refreshLoadCount.value = Math.max(0, refreshLoadCount.value - 1)
		}
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			errorMessage.value = 'No injected wallet found'
			return
		}

		try {
			errorMessage.value = undefined
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		}
	}

	useEffect(() => {
		void refreshState()

		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) return

		const handleWalletChange = () => {
			void refreshState()
		}

		ethereum.on?.('accountsChanged', handleWalletChange)
		ethereum.on?.('chainChanged', handleWalletChange)

		const intervalId = window.setInterval(() => {
			void refreshState()
		}, REFRESH_INTERVAL_MS)

		return () => {
			window.clearInterval(intervalId)
			ethereum.removeListener?.('accountsChanged', handleWalletChange)
			ethereum.removeListener?.('chainChanged', handleWalletChange)
		}
	}, [])

	return {
		accountState: accountState.value,
		connectWallet,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		hasInjectedWallet: hasInjectedWallet.value,
		isRefreshing: refreshLoadCount.value > 0,
		refreshState,
	}
}
