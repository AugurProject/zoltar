import type { discoverAddressedMarket, discoverTradingMarketPage, discoverUniverses } from '../../protocol/marketDiscovery.js'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { readInjectedChainIdNumber, requestInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import type {
	LiveBalances,
	LiveMarket,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverAllLiveMarketsInUniverse,
	discoverLiveUniverseMarketPage,
	loadLiveBalances,
	loadWalletHeaderBalances,
	simulateEntry,
	simulateExit,
	submitFreshEntry,
	submitFreshExit,
	validateLiveDeployment,
} from '../../protocol/live.js'
import type { TransactionPhase } from './transactionWorkflow.js'
import type { TradeSettings } from '../../lib/tradeSettings.js'
import type { UniverseDiscoveryScope } from '../../lib/universeSelection.js'
import type { GuardedWalletWrite } from '../../protocol/tradeQuote.js'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>

type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>
export type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
export type TransactionState = TransactionPhase
export type BalanceState = 'disconnected' | 'loading' | 'ready' | 'error'
export type PortfolioBalanceEntry = Readonly<{ market: LiveMarket; balances: LiveBalances | undefined; error: string | undefined }>
export type LiveTradingControllerServices = Readonly<{
	discoverAddressedMarket: typeof discoverAddressedMarket
	discoverTradingMarketPage: typeof discoverTradingMarketPage
	discoverUniverses: typeof discoverUniverses
	connectWallet: typeof requestInjectedAccount
	createTradingPublicClient: typeof createTradingPublicClient
	createTradingWalletClient: typeof createTradingWalletClient
	discoverAllLiveMarketsInUniverse: typeof discoverAllLiveMarketsInUniverse
	discoverLiveUniverseMarketPage: typeof discoverLiveUniverseMarketPage
	loadLiveBalances: typeof loadLiveBalances
	loadWalletHeaderBalances: typeof loadWalletHeaderBalances
	simulateEntry: typeof simulateEntry
	simulateExit: typeof simulateExit
	submitFreshEntry: typeof submitFreshEntry
	submitFreshExit: typeof submitFreshExit
	switchWalletChain: typeof switchInjectedChain
	validateLiveDeployment: typeof validateLiveDeployment
	walletChainId: typeof readInjectedChainIdNumber
}>

/** The first step of a workflow panel when no usable wallet is connected: connect, or switch back to the deployment chain. */
export type PanelWallet = Readonly<{ actionLabel: string; connect(): Promise<void> }>

/** Market, wallet, and refresh wiring shared by the liquidity and settlement workflow controllers. */
export type LiveWorkflowContext = Readonly<{
	configuration: DeploymentConfiguration
	market: LiveMarket
	balanceState: BalanceState
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	settings: TradeSettings
	refresh(): Promise<void>
	onKnownReceipt(): void
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	onWorkflowLockChange(locked: boolean): void
}>

/** Props the liquidity and settlement panels take on top of their controller context. */
export type LiveWorkflowPanelProps = LiveWorkflowContext &
	Readonly<{
		balances: LiveBalances | undefined
		balanceError: string | undefined
		networkMismatchReason: string | undefined
		wallet: PanelWallet
		retryBalances(): Promise<void>
	}>

/** Route, deployment, and universe inputs shared by the trading controller and its market discovery controller. */
export type LiveTradingRouteContext = Readonly<{
	route: string
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId: string | undefined
	/** The `universe` parameter the application is currently honouring; recorded in each answer's scope. */
	urlUniverseId: bigint | undefined
	onUniversesChange(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined, scope: UniverseDiscoveryScope): void
	walletSummaryRetryNonce: number
}>
