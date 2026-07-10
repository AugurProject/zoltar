import { assertNever } from './assert.js'
import {
	UI_STRING_MOCK,
	UI_STRING_PRICE_FROM_THE_SIMULATION_MOCK,
	UI_STRING_PRICE_FROM_UNISWAP_V3,
	UI_STRING_PRICE_FROM_UNISWAP_V4,
	UI_STRING_REP_ETH_PRICE_SOURCE_IS_UNAVAILABLE_UNTIL_A_QUOTE_LOADS,
	UI_STRING_REP_PER_ETH,
	UI_STRING_SIMULATION_REP_ETH,
	UI_STRING_TARGET_COLLATERALIZATION,
	UI_STRING_TARGET_COLLATERALIZATION_AT_SIMULATION_PRICE,
	UI_STRING_TARGET_COLLATERALIZATION_AT_UNISWAP_V3_PRICE,
	UI_STRING_TARGET_COLLATERALIZATION_AT_UNISWAP_V4_PRICE,
	UI_STRING_UNISWAP_V3_BADGE_LABEL,
	UI_STRING_UNISWAP_V4_BADGE_LABEL,
	UI_STRING_UNISWAP_V3_REP_ETH,
	UI_STRING_UNISWAP_V4_REP_ETH,
	UI_STRING_USES_THE_LIVE_UNISWAP_V3_REP_ETH_QUOTE,
	UI_STRING_USES_THE_LIVE_UNISWAP_V4_REP_ETH_QUOTE,
	UI_STRING_USES_THE_SIMULATION_REP_ETH_MOCK_PRICE,
	UI_TEMPLATE_WRAPPED_VALUE,
} from './uiStrings.js'

export type RepPriceSource = 'v4' | 'v3' | 'mock'

type RepPriceSourceCopy = {
	badgeLabel: string | undefined
	linkTitle: string | undefined
	quotedCollateralizationLabel: string
	quotedRepPerEthLabel: string
	tooltip: string
}

export function getRepPriceSourceCopy(source: RepPriceSource | undefined): RepPriceSourceCopy {
	switch (source) {
		case 'mock':
			return {
				badgeLabel: UI_STRING_MOCK,
				linkTitle: UI_STRING_PRICE_FROM_THE_SIMULATION_MOCK,
				quotedCollateralizationLabel: UI_STRING_TARGET_COLLATERALIZATION_AT_SIMULATION_PRICE,
				quotedRepPerEthLabel: UI_STRING_SIMULATION_REP_ETH,
				tooltip: UI_STRING_USES_THE_SIMULATION_REP_ETH_MOCK_PRICE,
			}
		case 'v4':
			return {
				badgeLabel: UI_STRING_UNISWAP_V4_BADGE_LABEL,
				linkTitle: UI_STRING_PRICE_FROM_UNISWAP_V4,
				quotedCollateralizationLabel: UI_STRING_TARGET_COLLATERALIZATION_AT_UNISWAP_V4_PRICE,
				quotedRepPerEthLabel: UI_STRING_UNISWAP_V4_REP_ETH,
				tooltip: UI_STRING_USES_THE_LIVE_UNISWAP_V4_REP_ETH_QUOTE,
			}
		case 'v3':
			return {
				badgeLabel: UI_STRING_UNISWAP_V3_BADGE_LABEL,
				linkTitle: UI_STRING_PRICE_FROM_UNISWAP_V3,
				quotedCollateralizationLabel: UI_STRING_TARGET_COLLATERALIZATION_AT_UNISWAP_V3_PRICE,
				quotedRepPerEthLabel: UI_STRING_UNISWAP_V3_REP_ETH,
				tooltip: UI_STRING_USES_THE_LIVE_UNISWAP_V3_REP_ETH_QUOTE,
			}
		case undefined:
			return {
				badgeLabel: undefined,
				linkTitle: undefined,
				quotedCollateralizationLabel: UI_STRING_TARGET_COLLATERALIZATION,
				quotedRepPerEthLabel: UI_STRING_REP_PER_ETH,
				tooltip: UI_STRING_REP_ETH_PRICE_SOURCE_IS_UNAVAILABLE_UNTIL_A_QUOTE_LOADS,
			}
		default:
			return assertNever(source)
	}
}

export function renderRepPriceSourceLabel(source: RepPriceSource | undefined, sourceUrl: string | undefined) {
	const copy = getRepPriceSourceCopy(source)
	if (copy.badgeLabel === undefined) return undefined
	if (sourceUrl === undefined || copy.linkTitle === undefined) return UI_TEMPLATE_WRAPPED_VALUE(copy.badgeLabel)
	return (
		<a href={sourceUrl} title={copy.linkTitle} target='_blank' rel='noreferrer'>
			{UI_TEMPLATE_WRAPPED_VALUE(copy.badgeLabel)}
		</a>
	)
}
