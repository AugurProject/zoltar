import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { useLoadController } from './useLoadController.js'
import type { Address } from 'viem'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance, loadGenesisRepTokenDeploymentPrerequisite } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClientForNetwork, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getNetworkConfig } from '../shared/networkConfig.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

type RefreshStateOptions = {
	loadWalletState?: boolean
}

type LoadWalletStateParameters = {
	connectedAddress: Address | undefined
	chainIdPromise: Promise<string> | undefined
	ethBalancePromise: Promise<bigint> | undefined
	wethBalancePromise: Promise<bigint> | undefined
	getAccountState: () => AccountState
	isCurrent: () => boolean
	setAccountState: (state: AccountState) => void
	setErrorMessage: (message: string | undefined) => void
	trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
}

export async function loadWalletState({ chainIdPromise, connectedAddress, ethBalancePromise, getAccountState, isCurrent, setAccountState, setErrorMessage, trackLoad, wethBalancePromise }: LoadWalletStateParameters) {
	if (connectedAddress === undefined || chainIdPromise === undefined || ethBalancePromise === undefined || wethBalancePromise === undefined) return

	void trackLoad(async () => {
		try {
			const walletChainId = await chainIdPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId: walletChainId, walletChainId })
		} catch {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId: undefined, walletChainId: undefined })
		}
	})

	void trackLoad(async () => {
		try {
			const ethBalance = await ethBalancePromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalance })
		} catch (error) {
			if (!isCurrent()) return
			setErrorMessage(getErrorMessage(error, 'Failed to refresh wallet balances'))
		}
	})

	void trackLoad(async () => {
		try {
			const wethBalance = await wethBalancePromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalance })
		} catch (error) {
			if (!isCurrent()) return
			setErrorMessage(getErrorMessage(error, 'Failed to refresh wallet balances'))
		}
	})
}

export function useOnchainState(activeNetworkKey: SupportedNetworkKey) {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		walletChainId: undefined,
		ethBalance: undefined,
		wethBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		getDeploymentSteps(activeNetworkKey).map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getInjectedEthereum() !== undefined)
	const walletStateLoad = useLoadController()
	const deploymentStatusLoad = useLoadController()
	const deploymentStatusesLoaded = useSignal(false)
	const augurPlaceHolderDeployed = useSignal<boolean | undefined>(undefined)
	const zoltarExternalPrerequisiteDetail = useSignal<string | undefined>(undefined)
	const zoltarExternalPrerequisiteLabel = useSignal<string | undefined>(undefined)
	const walletBootstrapComplete = useSignal(false)
	const isConnectingWallet = useSignal(false)
	const nextRefresh = useRequestGuard()
	const errorMessage = useSignal<string | undefined>(undefined)
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		const updated = update(deploymentStatuses.value)
		deploymentStatuses.value = updated
		if (updated.every(step => step.deployed)) augurPlaceHolderDeployed.value = true
	}

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadWalletState = options.loadWalletState ?? true
		const ethereum = getInjectedEthereum()
		const isCurrent = nextRefresh()
		hasInjectedWallet.value = ethereum !== undefined
		errorMessage.value = undefined

		// Fire deployment status immediately — independent of wallet state
		void deploymentStatusLoad.track(async () => {
			try {
				const readClient = createReadClientForNetwork(activeNetworkKey)
				const [snapshot, genesisRepTokenPrerequisite] = await Promise.all([loadDeploymentStatusOracleSnapshot(readClient), loadGenesisRepTokenDeploymentPrerequisite(readClient)])
				if (!isCurrent()) return
				augurPlaceHolderDeployed.value = snapshot.augurPlaceHolderDeployed
				deploymentStatuses.value = snapshot.deploymentStatuses
				deploymentStatusesLoaded.value = true
				zoltarExternalPrerequisiteDetail.value = genesisRepTokenPrerequisite.ready ? undefined : genesisRepTokenPrerequisite.detail
				zoltarExternalPrerequisiteLabel.value = genesisRepTokenPrerequisite.ready ? undefined : genesisRepTokenPrerequisite.missingLabel
			} catch (error) {
				if (!isCurrent()) return
				errorMessage.value = getErrorMessage(error, 'Failed to refresh deployment status')
			}
		})

		if (!shouldLoadWalletState) return

		// Resolve connection state — address check completes bootstrap; balance/chainId load in background
		await walletStateLoad.track(async () => {
			try {
				const accountsResult = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' }).catch(() => [])
				if (!isCurrent()) return
				const accounts = Array.isArray(accountsResult) ? accountsResult : []
				const connectedAddress = normalizeAccount(accounts[0])
				accountState.value = {
					address: connectedAddress,
					chainId: accountState.value.walletChainId,
					walletChainId: accountState.value.walletChainId,
					ethBalance: connectedAddress === accountState.value.address ? accountState.value.ethBalance : undefined,
					wethBalance: connectedAddress === accountState.value.address ? accountState.value.wethBalance : undefined,
				}

				// Address is now known — unblock data loading regardless of wallet presence
				walletBootstrapComplete.value = true

				if (connectedAddress !== undefined && ethereum !== undefined) {
					const chainIdPromise = ethereum.request({ method: 'eth_chainId' })
					const readClient = createReadClientForNetwork(activeNetworkKey, { ethereum, walletChainId: accountState.value.walletChainId })
					const ethBalancePromise = readClient.getBalance({ address: connectedAddress })
					const wethBalancePromise = loadErc20Balance(readClient, getNetworkConfig(activeNetworkKey).wethAddress, connectedAddress)
					void loadWalletState({
						connectedAddress,
						chainIdPromise,
						ethBalancePromise,
						getAccountState: () => accountState.value,
						isCurrent,
						setAccountState: state => {
							accountState.value = state
						},
						setErrorMessage: message => {
							errorMessage.value = message
						},
						trackLoad: walletStateLoad.track,
						wethBalancePromise,
					})
				} else {
					accountState.value = { ...accountState.value, chainId: undefined, walletChainId: undefined, wethBalance: undefined }
				}
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
			}
		})
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			errorMessage.value = 'Connect wallet to continue.'
			return
		}
		if (isConnectingWallet.value) return

		try {
			isConnectingWallet.value = true
			errorMessage.value = undefined
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		} finally {
			isConnectingWallet.value = false
		}
	}

	useEffect(() => {
		void refreshState()
	}, [activeNetworkKey])

	useEffect(() => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) return

		const handleWalletChange = () => {
			void refreshState()
		}

		ethereum.on?.('accountsChanged', handleWalletChange)
		ethereum.on?.('chainChanged', handleWalletChange)

		return () => {
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
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isLoadingDeploymentStatuses: deploymentStatusLoad.isLoading.value,
		isRefreshing: walletStateLoad.isLoading.value,
		augurPlaceHolderDeployed: augurPlaceHolderDeployed.value,
		isConnectingWallet: isConnectingWallet.value,
		setDeploymentStatuses,
		walletBootstrapComplete: walletBootstrapComplete.value,
		zoltarExternalPrerequisiteDetail: zoltarExternalPrerequisiteDetail.value,
		zoltarExternalPrerequisiteLabel: zoltarExternalPrerequisiteLabel.value,
		refreshState,
	}
}
