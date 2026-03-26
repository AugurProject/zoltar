import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { mainnet } from 'viem/chains'
import { getDeploymentSteps, loadDeploymentStatuses, loadGenesisRepBalance } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { setSignalValue } from '../lib/signals.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

const REFRESH_INTERVAL_MS = 15_000
const DEFAULT_CHAIN_ID = `0x${ mainnet.id.toString(16) }`

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
		isMainnet: true,
		repBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getInjectedEthereum() !== undefined)
	const isRefreshing = useSignal(false)
	const errorMessage = useSignal<string | undefined>(undefined)

	const refreshState = async () => {
		const ethereum = getInjectedEthereum()
		setSignalValue(hasInjectedWallet, ethereum !== undefined)

		setSignalValue(isRefreshing, true)
		try {
			const readClient = createReadClient()
			const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' })
			const connectedAddress = normalizeAccount(accounts[0])
			const chainId = ethereum === undefined ? DEFAULT_CHAIN_ID : await ethereum.request({ method: 'eth_chainId' })

			const [statuses, balances] = await Promise.all([loadDeploymentStatuses(readClient), loadAccountBalances(readClient, connectedAddress)])

			setSignalValue(deploymentStatuses, statuses)
			setSignalValue(accountState, {
				address: connectedAddress,
				chainId,
				ethBalance: balances.ethBalance,
				isMainnet: chainId === DEFAULT_CHAIN_ID,
				repBalance: balances.repBalance,
			})
			setSignalValue(errorMessage, undefined)
		} catch (error) {
			setSignalValue(errorMessage, getErrorMessage(error, 'Failed to refresh wallet state'))
		} finally {
			setSignalValue(isRefreshing, false)
		}
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setSignalValue(errorMessage, 'No injected wallet found')
			return
		}

		try {
			setSignalValue(errorMessage, undefined)
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			setSignalValue(errorMessage, getErrorMessage(error, 'Wallet connection failed'))
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
		isRefreshing: isRefreshing.value,
		refreshState,
	}
}
