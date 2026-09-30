import { createCentralizedExchangeFactory } from '@zoltar/bot-shared/monitoring/centralized-exchange-factory'
import { exchanges } from 'ccxt'

/** One CCXT-backed exchange factory shared by the scan loop and the dashboard market source test. */
export const centralizedExchangeFactory = createCentralizedExchangeFactory(exchanges)
