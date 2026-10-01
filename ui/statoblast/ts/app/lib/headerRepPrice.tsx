import type { ComponentChildren } from 'preact'
import type { RepPriceFailure, RepPriceSource } from '@zoltar/ui-core-shared/lib/repPriceSource.js'
import * as appCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { RepPriceStatusLabel } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { renderUiRepPriceSourceLabel } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/repPriceSource.js'
import { describeRepPriceStatus, type ResolvedRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'

type HeaderRepPerEthPrice = {
	repPerEthFailure: RepPriceFailure | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceLabel: ComponentChildren
	repPerEthSourceUrl: string | undefined
	repPerEthUnavailableLabel: ComponentChildren
}

/**
 * The header REP / ETH figure follows the UI price setting, which can depend on the open pool's Open Oracle price.
 * It always names its source, marks a stale Open Oracle price, and says why no price is shown instead of leaving a blank.
 */
export function getHeaderRepPerEthPrice({
	currentTimestamp,
	hasSelectedPool,
	repPerEthFailure,
	repPerEthSource,
	repPerEthSourceUrl,
	repPrice,
}: {
	currentTimestamp: bigint | undefined
	hasSelectedPool: boolean
	repPerEthFailure: RepPriceFailure | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	repPrice: ResolvedRepPrice
}): HeaderRepPerEthPrice {
	const usesOpenOracle = repPrice.source === 'open-oracle' || (repPrice.source === undefined && repPrice.setting === 'open-oracle')
	const status = describeRepPriceStatus(repPrice, currentTimestamp)
	const sourceLabel = usesOpenOracle ? renderUiRepPriceSourceLabel('open-oracle', undefined) : renderUiRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)
	const unavailableLabel = (() => {
		if (repPrice.price !== undefined || !usesOpenOracle) return undefined
		return hasSelectedPool ? status.title : appCopy.openPoolForOraclePrice
	})()
	return {
		// A Uniswap quote failure only explains a missing Uniswap figure, never a missing Open Oracle price.
		repPerEthFailure: usesOpenOracle ? undefined : repPerEthFailure,
		repPerEthPrice: repPrice.price,
		repPerEthSource: usesOpenOracle ? undefined : repPerEthSource,
		repPerEthSourceLabel:
			status.state === 'stale' ? (
				<>
					{sourceLabel} <RepPriceStatusLabel currentTimestamp={currentTimestamp} repPrice={repPrice} />
				</>
			) : (
				sourceLabel
			),
		repPerEthSourceUrl: usesOpenOracle ? undefined : repPerEthSourceUrl,
		repPerEthUnavailableLabel: unavailableLabel,
	}
}
