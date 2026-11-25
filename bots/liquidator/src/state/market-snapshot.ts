import type { CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'

export function marketConfigurationList(marketConfigurations: CentralizedMarketSettings | readonly CentralizedMarketSettings[] | undefined): readonly CentralizedMarketSettings[] {
	if (marketConfigurations === undefined) return []
	return 'assetAddress' in marketConfigurations ? [marketConfigurations] : marketConfigurations
}
