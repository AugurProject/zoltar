import type { AccountState, TradingFormState } from '../types/app.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool, TradingActionResult, TradingDetails } from '../types/contracts.js'
import type { SecurityPoolStateModel } from './security-pools/lib/securityPoolState.js'
import type { UiRepPriceSource } from './security-pools/lib/repPriceSource.js'

export type * from '@zoltar/ui-core-shared/types/components.js'

type RepPerEthPriceProps = {
	repPerEthPrice: bigint | undefined
	repPerEthSource: UiRepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
}

export type SecurityPoolsView = 'browse' | 'operate' | 'universes' | 'migrate'

type TradingRouteContentProps = {
	accountState: AccountState
	loadingTradingForkUniverse: boolean
	loadingTradingDetails: boolean
	collateralFunding?: ReturnType<typeof import('./markets/hooks/useTradingCollateral.js').useTradingCollateral>
	onCreateCompleteSet: () => void
	onMigrateShares: () => void
	onRedeemCompleteSet: () => void
	onRedeemShares: () => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	selectedPool: ListedSecurityPool | undefined
	tradingActiveAction: TradingActionResult['action'] | undefined
	tradingDetails: TradingDetails | undefined
	tradingError: string | undefined
	tradingForkUniverse: ZoltarUniverseSummary | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
} & RepPerEthPriceProps

export type TradingSectionProps = TradingRouteContentProps & {
	embedInCard?: boolean
	poolState?: SecurityPoolStateModel | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}
