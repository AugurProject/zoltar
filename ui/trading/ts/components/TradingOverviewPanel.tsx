import type { ComponentChildren } from 'preact'
import { OverviewHeaderPanel } from '@zoltar/ui-core-shared/app/components/OverviewHeaderPanel.js'
import { WalletBalanceGroup } from '@zoltar/ui-core-shared/components/WalletBalanceGroup.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

type TradingOverviewPanelProps = {
	badges?: ComponentChildren
	controls?: ComponentChildren
	navigation?: ComponentChildren
	onRetryWalletSummary?: () => void
	settingsMenu?: ComponentChildren
	/** The connected wallet's balances for the selected universe; omitted on routes without a live wallet. */
	walletSummary?: WalletSummaryState | undefined
}

/** The wallet's ETH balance for the account popover. Trading settles in ETH, so REP stays out of its header. */
export function TradingBalanceGroup({ walletSummary }: { walletSummary: WalletSummaryState }) {
	return <WalletBalanceGroup balances={[{ asset: commonCopy.eth, exactWhenRoundedToZero: true, loading: walletSummary.status === 'loading', value: walletSummary.status === 'ready' ? walletSummary.ethAttoEth : undefined }]} />
}

/** Trading's top bar on the shared header panel; wallet balance read failures sit under the bar. */
export function TradingOverviewPanel({ badges, controls, navigation, onRetryWalletSummary, settingsMenu, walletSummary }: TradingOverviewPanelProps) {
	return (
		<OverviewHeaderPanel
			applicationTitle={copy.appName}
			badges={badges}
			controls={controls}
			navigation={navigation}
			settingsMenu={settingsMenu}
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
						{walletSummary.status === 'loading' ? (
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
