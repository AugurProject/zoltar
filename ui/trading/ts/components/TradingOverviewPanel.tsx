import type { ComponentChildren } from 'preact'
import { OverviewHeaderPanel } from '@zoltar/ui-core-shared/app/components/OverviewHeaderPanel.js'
import { WalletBalanceGroup } from '@zoltar/ui-core-shared/components/WalletBalanceGroup.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

type TradingOverviewPanelProps = {
	badges?: ComponentChildren
	controls?: ComponentChildren
	onRetryWalletSummary?: () => void
	settingsMenu?: ComponentChildren
	simulation: boolean
	/** The connected wallet's balances for the selected universe; omitted on routes without a live wallet. */
	walletSummary?: WalletSummaryState | undefined
}

/** Trading's header on the shared overview panel: the live wallet balance strip and its read failures sit under the toolbar. */
export function TradingOverviewPanel({ badges, controls, onRetryWalletSummary, settingsMenu, simulation, walletSummary }: TradingOverviewPanelProps) {
	const loading = walletSummary?.status === 'loading'
	const ready = walletSummary?.status === 'ready'
	return (
		<OverviewHeaderPanel
			applicationTitle={copy.appName}
			badges={badges}
			controls={controls}
			settingsMenu={settingsMenu}
			simulation={simulation}
			metrics={
				walletSummary === undefined ? undefined : (
					<WalletBalanceGroup
						balances={[
							{ asset: commonCopy.eth, exactWhenRoundedToZero: true, loading, value: ready ? walletSummary.ethAttoEth : undefined },
							{ asset: commonCopy.rep, exactWhenRoundedToZero: true, loading, value: ready ? walletSummary.repAttoRep : undefined },
						]}
					/>
				)
			}
			footer={
				walletSummary === undefined ? undefined : (
					<>
						{walletSummary.status === 'error' ? (
							<div className='trading-wallet-error'>
								<span className='error' role='alert' title={walletSummary.error} aria-label={copy.walletBalanceError(walletSummary.errorLabel, walletSummary.error)}>
									{walletSummary.errorLabel ?? copy.balancesUnavailable}
								</span>
								{onRetryWalletSummary === undefined ? undefined : (
									<button className='secondary' type='button' onClick={onRetryWalletSummary}>
										{copy.retry}
									</button>
								)}
							</div>
						) : undefined}
						{loading ? (
							<span className='visually-hidden' role='status'>
								{copy.loadingWalletBalances}
							</span>
						) : undefined}
					</>
				)
			}
		/>
	)
}
