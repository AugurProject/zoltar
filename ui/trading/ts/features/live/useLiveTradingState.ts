import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { createExclusiveWorkflowGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import type { InjectedEthereum } from '../../protocol/injected.js'
import { createSecurityPoolDeploymentIndex, type LiveBalances, type LiveMarket, type SecurityPoolDeployment } from '../../protocol/live.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { BalanceState, LiveTradingControllerServices, PortfolioBalanceEntry, Quote, TransactionState } from './liveTradingTypes.js'

export function parsedUniverseId(selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return undefined
	try {
		return BigInt(selectedUniverseId)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

export function useWalletState() {
	const [account, setAccount] = useState<Address>()
	const accountRef = useRef(account)
	accountRef.current = account
	const [walletClient, setWalletClient] = useState<WalletClient>()
	const [walletProvider, setWalletProvider] = useState<InjectedEthereum>()
	const [walletContextInvalidated, setWalletContextInvalidated] = useState(false)
	const [walletSummaryStatus, setWalletSummaryStatus] = useState<WalletSummaryState['status']>('disconnected')
	const [walletEthAttoEth, setWalletEthAttoEth] = useState<bigint>()
	const [walletRepAttoRep, setWalletRepAttoRep] = useState<bigint>()
	const [walletSummaryError, setWalletSummaryError] = useState<string>()
	const [walletSummaryErrorLabel, setWalletSummaryErrorLabel] = useState<string>()
	const [walletSummaryUniverseId, setWalletSummaryUniverseId] = useState<string>()
	const [walletSummaryReceiptNonce, setWalletSummaryReceiptNonce] = useState(0)
	const [walletConnectionFeedback, setWalletConnectionFeedback] = useState<{ route: string; detail: string }>()

	return {
		account,
		setAccount,
		accountRef,
		walletClient,
		setWalletClient,
		walletProvider,
		setWalletProvider,
		walletContextInvalidated,
		setWalletContextInvalidated,
		walletSummaryStatus,
		setWalletSummaryStatus,
		walletEthAttoEth,
		setWalletEthAttoEth,
		walletRepAttoRep,
		setWalletRepAttoRep,
		walletSummaryError,
		setWalletSummaryError,
		walletSummaryErrorLabel,
		setWalletSummaryErrorLabel,
		walletSummaryUniverseId,
		setWalletSummaryUniverseId,
		walletSummaryReceiptNonce,
		setWalletSummaryReceiptNonce,
		walletConnectionFeedback,
		setWalletConnectionFeedback,
	}
}

export function useBalanceState() {
	const [balances, setBalances] = useState<LiveBalances>()
	const [balanceState, setBalanceState] = useState<BalanceState>('disconnected')
	const [balanceError, setBalanceError] = useState<string>()
	const [portfolioEntries, setPortfolioEntries] = useState<readonly PortfolioBalanceEntry[]>([])
	const [portfolioBalanceState, setPortfolioBalanceState] = useState<BalanceState>('disconnected')
	const [portfolioBalanceError, setPortfolioBalanceError] = useState<string>()
	const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0)

	return { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, setPortfolioEntries, portfolioBalanceState, setPortfolioBalanceState, portfolioBalanceError, setPortfolioBalanceError, portfolioRefreshNonce, setPortfolioRefreshNonce }
}

export function useDiscoveryState() {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return { markets, setMarkets, selectedPool, setSelectedPool, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex }
}

export function usePositionWorkflowState(onWorkflowLockChange: (locked: boolean) => void, defaultSlippage: string, defaultValidityMinutes: string) {
	const [mode, setMode] = useState<'entry' | 'exit'>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	const [amount, setAmount] = useState('0.01')
	const [slippage, setSlippage] = useState(defaultSlippage)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(defaultValidityMinutes)
	const [quote, setQuote] = useState<Quote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [positionHash, setPositionHash] = useState<Hash>()
	const [message, setMessage] = useState<string>()
	const [positionReceiptWarning, setPositionReceiptWarning] = useState<string>()
	const positionWorkflow = useRef(createExclusiveWorkflowGuard()).current
	const positionWorkflowLockedRef = useRef(false)
	const liquidityWorkflowLockedRef = useRef(false)
	const [positionWorkflowLocked, setPositionWorkflowLocked] = useState(false)
	const [liquidityWorkflowLocked, setLiquidityWorkflowLocked] = useState(false)
	const workflowLocked = positionWorkflowLocked || liquidityWorkflowLocked
	const updatePositionWorkflowLock = useCallback(
		(locked: boolean) => {
			positionWorkflowLockedRef.current = locked
			setPositionWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)
	const updateLiquidityWorkflowLock = useCallback(
		(locked: boolean) => {
			liquidityWorkflowLockedRef.current = locked
			setLiquidityWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)

	useEffect(
		() => () => {
			if (positionWorkflow.isActive()) positionWorkflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange, positionWorkflow],
	)

	return {
		mode,
		setMode,
		side,
		setSide,
		amount,
		setAmount,
		slippage,
		setSlippage,
		transactionValidityMinutes,
		setTransactionValidityMinutes,
		quote,
		setQuote,
		state,
		setState,
		positionHash,
		setPositionHash,
		message,
		setMessage,
		positionReceiptWarning,
		setPositionReceiptWarning,
		positionWorkflow,
		positionWorkflowLockedRef,
		liquidityWorkflowLockedRef,
		workflowLocked,
		updatePositionWorkflowLock,
		updateLiquidityWorkflowLock,
	}
}

export function initialQuestionClockTimestamp(simulationTimestamp: bigint | undefined, currentWallMilliseconds = Date.now()) {
	return simulationTimestamp ?? BigInt(Math.floor(currentWallMilliseconds / 1_000))
}

export function questionClockShouldPollAgain(endTime: bigint | undefined, currentTimestamp: bigint) {
	return endTime === undefined || currentTimestamp < endTime
}

export function useQuestionClock(endTime: bigint | undefined, configuration: DeploymentConfiguration | undefined, services: LiveTradingControllerServices) {
	const [nowSeconds, setNowSeconds] = useState(() => initialQuestionClockTimestamp(getActiveSimulationController()?.currentTimestamp))

	useEffect(() => {
		const simulationController = getActiveSimulationController()
		if (simulationController !== undefined) {
			const update = () => setNowSeconds(simulationController.currentTimestamp)
			update()
			return simulationController.subscribe(update)
		}
		if (configuration === undefined) return
		const client = services.createTradingPublicClient(configuration)
		let timeout: ReturnType<typeof setTimeout> | undefined
		let active = true
		const updateFromChain = async () => {
			if (!active) return
			let pollAgain = true
			try {
				const block = await client.getBlock()
				if (!active) return
				setNowSeconds(block.timestamp)
				pollAgain = questionClockShouldPollAgain(endTime, block.timestamp)
			} catch (error) {
				void error
			} finally {
				if (active && pollAgain) timeout = setTimeout(() => void updateFromChain(), 12_000)
			}
		}
		void updateFromChain()
		return () => {
			active = false
			if (timeout !== undefined) clearTimeout(timeout)
		}
	}, [configuration, endTime, services])

	return nowSeconds
}
