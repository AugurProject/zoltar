import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getVaultExposure } from '../lib/securityVault.js'

export function VaultExposureValue({ capacity, multiplierBps, repPerEthPrice }: { capacity: bigint | undefined; multiplierBps: bigint | undefined; repPerEthPrice: bigint | undefined }) {
	const exposure = getVaultExposure(capacity, multiplierBps, repPerEthPrice)
	if (exposure === undefined) return <>{commonCopy.metricUnavailablePlaceholder}</>
	return <CurrencyValue exactWhenRoundedToZero value={exposure.amount} suffix={exposure.priced ? commonCopy.eth : securityPoolCopy.repEquivalent} />
}
