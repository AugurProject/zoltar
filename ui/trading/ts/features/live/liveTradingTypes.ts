import type { Address, WalletClient } from '@zoltar/shared/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveBalances, LiveMarket, simulateEntry, simulateExit } from '../../protocol/live.js'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>

export type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>
export type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
export type TransactionState = 'idle' | 'simulating' | 'ready' | 'preparing' | 'approval' | 'approval-pending' | 'approval-confirmed' | 'submitting' | 'pending' | 'confirmed' | 'error'
export type BalanceState = 'disconnected' | 'loading' | 'ready' | 'error'
export type PortfolioBalanceEntry = Readonly<{ market: LiveMarket; balances: LiveBalances | undefined; error: string | undefined }>
