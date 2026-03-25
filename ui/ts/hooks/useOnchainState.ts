import { useEffect, useState } from 'preact/hooks'
import { mainnet } from 'viem/chains'
import { getDeploymentSteps, loadDeploymentStatuses, loadGenesisRepBalance } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

const REFRESH_INTERVAL_MS = 15_000

export function useOnchainState() {
	const [accountState, setAccountState] = useState<AccountState>({
		address: null,
		chainId: null,
		ethBalance: null,
		repBalance: null,
	})
	const [deploymentStatuses, setDeploymentStatuses] = useState<DeploymentStatus[]>(() =>
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const [hasInjectedWallet, setHasInjectedWallet] = useState<boolean>(() => getInjectedEthereum() !== undefined)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const refreshState = async () => {
		const ethereum = getInjectedEthereum()
		setHasInjectedWallet(ethereum !== undefined)

		setIsRefreshing(true)
		try {
			const readClient = createReadClient()
			const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' })
			const connectedAddress = normalizeAccount(accounts[0])
			const chainId = ethereum === undefined ? `0x${ mainnet.id.toString(16) }` : await ethereum.request({ method: 'eth_chainId' })

			const [statuses, ethBalance, repBalance] = await Promise.all([loadDeploymentStatuses(readClient), connectedAddress === null ? Promise.resolve(null) : readClient.getBalance({ address: connectedAddress }), connectedAddress === null ? Promise.resolve(null) : loadGenesisRepBalance(readClient, connectedAddress).catch(() => null)])

			setDeploymentStatuses(statuses)
			setAccountState({
				address: connectedAddress,
				chainId,
				ethBalance,
				repBalance,
			})
		} catch (error) {
			setErrorMessage(getErrorMessage(error, 'Failed to refresh wallet state'))
		} finally {
			setIsRefreshing(false)
		}
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setErrorMessage('No injected wallet found')
			return
		}

		try {
			setErrorMessage(null)
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			setErrorMessage(getErrorMessage(error, 'Wallet connection failed'))
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
		accountState,
		connectWallet,
		deploymentStatuses,
		errorMessage,
		hasInjectedWallet,
		isRefreshing,
		refreshState,
		setErrorMessage,
	}
}
