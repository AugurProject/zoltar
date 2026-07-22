import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '../../protocol/index.js'
import { createConnectedReadClient, normalizeAccount } from '../../lib/clients.js'
import type { ChainBackend, ReadBackendStatus } from '../../lib/chainBackend.js'
import { getErrorMessage, hasErrorCode, hasErrorMessage, isRecoverableContractReadError } from '../../lib/errors.js'
import { getActiveBackend } from '../../lib/activeEnvironment.js'
import { useRequestGuard } from '../../lib/requestGuard.js'
import { getWethAddress } from '../../protocol/uniswapQuoter.js'
import type { AccountState, RefreshStateOptions } from '../../types/app.js'
import type { DeploymentStatus } from '../../types/contracts.js'
import { useLoadController } from '../../hooks/useLoadController.js'

type ChainClock = {
	currentBlockNumber: bigint | undefined
	currentTimestamp: bigint | undefined
}

type ReadBackendValidationResult = {
	readBackendMessage: string | undefined
	validated: boolean
}

function getExpectedReadChainId(backend: ChainBackend) {
	return backend.profile.chain.id
}

function buildReadBackendMismatchMessage(backend: ChainBackend, actualChainId: number) {
	return `Configured read RPC reports chain ${actualChainId.toString()}, but this app requires ${backend.profile.displayName} (${getExpectedReadChainId(backend).toString()}).`
}

function getReadBackendStatus(backend: ChainBackend): ReadBackendStatus {
	return (
		backend.getReadBackendStatus?.() ?? {
			blockNumber: undefined,
			blockTimestamp: undefined,
			rpcSource: 'default',
			rpcUrl: backend.profile.displayName,
			transportMode: 'provider',
		}
	)
}

async function validateConfiguredReadBackend(backend: ChainBackend): Promise<ReadBackendValidationResult> {
	try {
		const readClient = backend.createReadClient()
		const readChainId = await readClient.getChainId()
		if (readChainId !== getExpectedReadChainId(backend)) {
			return {
				readBackendMessage: buildReadBackendMismatchMessage(backend, readChainId),
				validated: true,
			}
		}
		const block = await readClient.getBlock()
		const blockNumber = typeof block.number === 'bigint' ? block.number : undefined
		const blockTimestamp = typeof block.timestamp === 'bigint' ? block.timestamp : undefined
		backend.setReadBackendBlock?.({
			number: blockNumber,
			timestamp: blockTimestamp,
		})
		const currentUnixSeconds = BigInt(Math.floor(Date.now() / 1000))
		if (backend.profile.id !== 'simulation' && blockTimestamp !== undefined && currentUnixSeconds > blockTimestamp + READ_BACKEND_STALE_BLOCK_SECONDS) {
			return {
				readBackendMessage: `Configured read RPC is stale. Latest block timestamp is ${blockTimestamp.toString()}, more than 10 minutes behind local time.`,
				validated: true,
			}
		}
		return {
			readBackendMessage: undefined,
			validated: true,
		}
	} catch (error) {
		throw new Error(getErrorMessage(error, 'Failed to validate the configured read RPC'))
	}
}

type LoadWalletStateParameters = {
	chainIdPromise: Promise<string> | undefined
	connectedAddress: Address | undefined
	ethBalancePromise: Promise<bigint> | undefined
	fallbackChainId?: string
	getAccountState: () => AccountState
	isCurrent: () => boolean
	setAccountState: (state: AccountState) => void
	setErrorMessage: (message: string | undefined) => void
	trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
	wethBalancePromise: Promise<bigint> | undefined
}

export async function loadWalletState({ chainIdPromise, connectedAddress, ethBalancePromise, fallbackChainId, getAccountState, isCurrent, setAccountState, setErrorMessage, trackLoad, wethBalancePromise }: LoadWalletStateParameters) {
	if (connectedAddress === undefined || chainIdPromise === undefined || ethBalancePromise === undefined || wethBalancePromise === undefined) return
	const resolvedFallbackChainId = fallbackChainId ?? '0x1'

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

const CHAIN_CLOCK_POLL_INTERVAL_MILLISECONDS = 12_000
const READ_BACKEND_STALE_BLOCK_SECONDS = 10n * 60n

async function loadBackendChainClock(backend: ChainBackend): Promise<ChainClock> {
	if (backend.isBootstrapped === false)
		return {
			currentBlockNumber: undefined,
			currentTimestamp: undefined,
		}

	try {
		const block = await backend.createReadClient().getBlock()
		return {
			currentBlockNumber: typeof block.number === 'bigint' ? block.number : undefined,
			currentTimestamp: typeof block.timestamp === 'bigint' ? block.timestamp : undefined,
		}
	} catch (error) {
		if (!isRecoverableContractReadError(error)) throw error
		return {
			currentBlockNumber: undefined,
			currentTimestamp: undefined,
		}
	}
}

type UseOnchainStateOptions = {
	activeEnvironmentNonce?: number
	enableChainClock?: boolean
}

export type UseOnchainStateDependencies = {
	getDeploymentSteps: typeof getDeploymentSteps
	loadDeploymentStatusOracleSnapshot: typeof loadDeploymentStatusOracleSnapshot
	loadErc20Balance: typeof loadErc20Balance
}

const defaultUseOnchainStateDependencies: UseOnchainStateDependencies = {
	getDeploymentSteps,
	loadDeploymentStatusOracleSnapshot,
	loadErc20Balance,
}

export function useOnchainState({ activeEnvironmentNonce = 0, enableChainClock = true }: UseOnchainStateOptions = {}, dependencies: UseOnchainStateDependencies = defaultUseOnchainStateDependencies) {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		ethBalance: undefined,
		wethBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		dependencies.getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getActiveBackend().hasWallet())
	const walletStateLoad = useLoadController()
	const deploymentStatusLoad = useLoadController()
	const deploymentStatusesLoaded = useSignal(false)
	const augurStatoblastDeployed = useSignal<boolean | undefined>(undefined)
	const currentTimestamp = useSignal<bigint | undefined>(getActiveBackend().currentTimestamp)
	const currentBlockNumber = useSignal<bigint | undefined>(undefined)
	const environmentBootstrapError = useSignal<string | undefined>(undefined)
	const environmentBootstrapLabel = useSignal(getActiveBackend().bootstrapLabel)
	const environmentBootstrapProgress = useSignal(getActiveBackend().bootstrapProgress)
	const environmentReady = useSignal(getActiveBackend().isBootstrapped ?? true)
	const environmentReadyLoad = useLoadController()
	const walletBootstrapComplete = useSignal(false)
	const isConnectingWallet = useSignal(false)
	const isManagingWallet = useSignal(false)
	const nextRefresh = useRequestGuard()
	const nextChainClockRefresh = useRequestGuard()
	const errorMessage = useSignal<string | undefined>(undefined)
	const readBackendMessage = useSignal<string | undefined>(undefined)
	const readBackendValidated = useSignal(false)
	const readBackendStatus = useSignal<ReadBackendStatus>(getReadBackendStatus(getActiveBackend()))
	const clearChainClock = () => {
		currentBlockNumber.value = undefined
		currentTimestamp.value = undefined
	}
	const updateReadBackendStatus = (backend: ChainBackend, block?: ChainClock) => {
		backend.setReadBackendBlock?.({
			number: block?.currentBlockNumber,
			timestamp: block?.currentTimestamp,
		})
		readBackendStatus.value = getReadBackendStatus(backend)
	}
	const isReadBackendReady = () => readBackendValidated.value && readBackendMessage.value === undefined
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		const updated = update(deploymentStatuses.value)
		deploymentStatuses.value = updated
		if (updated.every(step => step.deployed)) augurStatoblastDeployed.value = true
	}
	const refreshChainClock = async (backend: ChainBackend) => {
		const isCurrent = nextChainClockRefresh()
		const nextChainClock = await loadBackendChainClock(backend)
		if (!isCurrent()) return
		if (nextChainClock.currentTimestamp !== undefined) currentTimestamp.value = nextChainClock.currentTimestamp
		if (nextChainClock.currentBlockNumber !== undefined) currentBlockNumber.value = nextChainClock.currentBlockNumber
		updateReadBackendStatus(backend, nextChainClock)
	}

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadChainClock = enableChainClock && (options.loadChainClock ?? true)
		const shouldLoadDeploymentState = options.loadDeploymentState ?? true
		const shouldLoadWalletState = options.loadWalletState ?? true
		const backend = getActiveBackend()
		updateReadBackendStatus(backend)
		const isCurrent = nextRefresh()
		let connectedAddress: Address | undefined
		let connectedChainId: string | undefined
		hasInjectedWallet.value = backend.hasWallet()
		errorMessage.value = undefined
		readBackendMessage.value = undefined
		readBackendValidated.value = false
		if (shouldLoadWalletState) {
			try {
				const accounts = await backend.getAccounts()
				if (!isCurrent()) return
				connectedAddress = normalizeAccount(accounts[0])
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				return
			}
		}
		if (connectedAddress !== undefined) {
			try {
				connectedChainId = await backend.getChainId()
				if (!isCurrent()) return
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
				return
			}
		}
		const walletOnExpectedChain = connectedChainId === backend.profile.chainIdHex
		backend.setReadTransportMode?.(walletOnExpectedChain ? 'provider' : 'rpc')
		if (!walletOnExpectedChain) {
			clearChainClock()
			try {
				const validation = await validateConfiguredReadBackend(backend)
				if (!isCurrent()) return
				readBackendMessage.value = validation.readBackendMessage
				readBackendValidated.value = validation.validated
				updateReadBackendStatus(backend)
				if (validation.readBackendMessage !== undefined) clearChainClock()
			} catch (error) {
				if (!isCurrent()) return
				errorMessage.value = getErrorMessage(error, 'Failed to validate the configured read RPC')
			}
		} else {
			readBackendValidated.value = true
			updateReadBackendStatus(backend)
		}
		if (shouldLoadChainClock && isReadBackendReady()) void refreshChainClock(backend)

		if (backend.isBootstrapped === false) {
			deploymentStatusesLoaded.value = false
			augurStatoblastDeployed.value = undefined
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = false
			environmentBootstrapError.value = undefined
		}

		if (shouldLoadDeploymentState && backend.isBootstrapped !== false && readBackendMessage.value === undefined)
			void deploymentStatusLoad.track(async () => {
				try {
					const snapshot = await dependencies.loadDeploymentStatusOracleSnapshot(backend.createReadClient())
					if (!isCurrent()) return
					augurStatoblastDeployed.value = snapshot.augurStatoblastDeployed
					deploymentStatuses.value = snapshot.deploymentStatuses
					deploymentStatusesLoaded.value = true
				} catch (error) {
					if (!isCurrent()) return
					errorMessage.value = getErrorMessage(error, 'Failed to refresh deployment status')
				}
			})

		if (!shouldLoadWalletState) return

		await walletStateLoad.track(async () => {
			try {
				accountState.value = {
					address: connectedAddress,
					chainId: accountState.value.chainId,
					ethBalance: connectedAddress === accountState.value.address ? accountState.value.ethBalance : undefined,
					wethBalance: connectedAddress === accountState.value.address ? accountState.value.wethBalance : undefined,
				}

				walletBootstrapComplete.value = true

				if (connectedAddress !== undefined && walletOnExpectedChain) {
					const readClient = createConnectedReadClient()
					const ethBalancePromise = readClient.getBalance({ address: connectedAddress })
					const wethBalancePromise = dependencies.loadErc20Balance(readClient, getWethAddress(), connectedAddress)
					void loadWalletState({
						chainIdPromise: Promise.resolve(connectedChainId ?? backend.profile.chainIdHex),
						connectedAddress,
						ethBalancePromise,
						fallbackChainId: backend.profile.chainIdHex,
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
				} else if (connectedAddress !== undefined) {
					accountState.value = { ...accountState.value, chainId: connectedChainId ?? backend.profile.chainIdHex, ethBalance: undefined, wethBalance: undefined }
				} else {
					accountState.value = { ...accountState.value, chainId: backend.profile.chainIdHex, ethBalance: undefined, wethBalance: undefined }
				}
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
			}
		})
	}

	const connectWallet = async () => {
		const backend = getActiveBackend()
		if (!backend.hasWallet()) {
			errorMessage.value = 'No wallet detected. Install or enable a wallet to continue.'
			return
		}
		if (isConnectingWallet.value) return

		try {
			isConnectingWallet.value = true
			errorMessage.value = undefined
			await backend.requestAccounts()
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		} finally {
			isConnectingWallet.value = false
		}
	}
	const runWalletManagementAction = async (action: (backend: ChainBackend) => Promise<void>, fallbackMessage: string) => {
		if (isManagingWallet.value) return
		try {
			isManagingWallet.value = true
			errorMessage.value = undefined
			await action(getActiveBackend())
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, fallbackMessage)
		} finally {
			isManagingWallet.value = false
		}
	}
	const changeWallet = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.requestAccountSelection === undefined) throw new Error('This wallet does not support account switching from the application. Open the wallet and choose another account.')
			await backend.requestAccountSelection()
		}, 'Wallet account change failed')
	const disconnectWallet = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.disconnectWallet === undefined) throw new Error('This wallet does not support disconnecting from the application. Disconnect this site in the wallet.')
			await backend.disconnectWallet()
		}, 'Wallet disconnect failed')
	const switchNetwork = async () =>
		await runWalletManagementAction(async backend => {
			if (backend.switchNetwork === undefined) throw new Error('This wallet does not support switching networks from the application. Switch to Ethereum mainnet in the wallet.')
			await backend.switchNetwork()
		}, 'Network switch failed')

	useEffect(() => {
		void refreshState()
	}, [activeEnvironmentNonce])

	useEffect(() => {
		const backend = getActiveBackend()
		if (backend.waitUntilReady === undefined || backend.isBootstrapped === true) {
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = true
			environmentBootstrapError.value = undefined
			return
		}

		environmentBootstrapLabel.value = backend.bootstrapLabel
		environmentBootstrapProgress.value = backend.bootstrapProgress
		environmentReady.value = false
		environmentBootstrapError.value = undefined
		let cancelled = false
		void environmentReadyLoad.track(async () => {
			try {
				await backend.waitUntilReady?.()
				if (cancelled) return
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = true
				environmentBootstrapError.value = undefined
				await refreshState()
			} catch (error) {
				if (cancelled) return
				environmentBootstrapError.value = getErrorMessage(error, 'Failed to bootstrap simulation environment')
			}
		})

		return () => {
			cancelled = true
		}
	}, [activeEnvironmentNonce])

	useEffect(() => {
		const backend = getActiveBackend()
		const unsubscribeState = backend.subscribe?.(() => {
			environmentBootstrapError.value = backend.bootstrapError
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = backend.isBootstrapped ?? true
			if (enableChainClock && isReadBackendReady()) void refreshChainClock(backend)
		})
		const handleWalletChange = () => {
			void refreshState()
		}
		const unsubscribeAccounts = backend.subscribeAccountsChanged(handleWalletChange)
		const unsubscribeChain = backend.subscribeChainChanged(handleWalletChange)

		return () => {
			unsubscribeChain()
			unsubscribeAccounts()
			unsubscribeState?.()
		}
	}, [activeEnvironmentNonce, enableChainClock])

	useEffect(() => {
		if (!enableChainClock) {
			clearChainClock()
			return
		}
		const backend = getActiveBackend()
		if (backend.isBootstrapped === false) return
		if (!isReadBackendReady()) return

		void refreshChainClock(backend)
		const intervalId = window.setInterval(() => {
			if (!isReadBackendReady()) return
			void refreshChainClock(backend)
		}, CHAIN_CLOCK_POLL_INTERVAL_MILLISECONDS)

		return () => {
			window.clearInterval(intervalId)
		}
	}, [activeEnvironmentNonce, enableChainClock, environmentReady.value, readBackendMessage.value, readBackendValidated.value])

	return {
		accountState: accountState.value,
		changeWallet,
		connectWallet,
		currentBlockNumber: currentBlockNumber.value,
		currentTimestamp: currentTimestamp.value,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		readBackendMessage: readBackendMessage.value,
		readBackendStatus: readBackendStatus.value,
		environmentBootstrapError: environmentBootstrapError.value,
		environmentBootstrapLabel: environmentBootstrapLabel.value,
		environmentBootstrapProgress: environmentBootstrapProgress.value,
		environmentReady: environmentReady.value,
		isBootstrappingEnvironment: environmentReadyLoad.isLoading.value || getActiveBackend().isBootstrapping === true,
		hasInjectedWallet: hasInjectedWallet.value,
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isConnectingWallet: isConnectingWallet.value,
		isManagingWallet: isManagingWallet.value,
		isLoadingDeploymentStatuses: deploymentStatusLoad.isLoading.value,
		isRefreshing: walletStateLoad.isLoading.value,
		augurStatoblastDeployed: augurStatoblastDeployed.value,
		refreshState,
		setDeploymentStatuses,
		disconnectWallet,
		switchNetwork,
		walletBootstrapComplete: walletBootstrapComplete.value,
	}
}
