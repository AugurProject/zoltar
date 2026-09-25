import type { ComponentChildren } from 'preact'
import * as appCopy from '../../copy/app.js'
import { AddressValue } from '../../components/AddressValue.js'
import { WalletChipLabel } from '../../components/WalletChip.js'
import { useDisclosurePopover } from '../../hooks/useDisclosurePopover.js'
import { abbreviateAddress } from '../../lib/address.js'

type AccountMenuProps = {
	/** Wallet actions such as change, switch network, and disconnect; omitted where the wallet is managed elsewhere. */
	actions?: ComponentChildren
	address: string
	/** Balance and price groups shown in the popover. */
	metrics?: ComponentChildren
	/** Network facts for the popover, such as the active network and the latest block. */
	network?: ComponentChildren
	tone?: 'ok' | 'danger'
}

/**
 * The top bar's account control: a wallet chip that discloses a popover with the full address, balances,
 * network details, and wallet actions. Keeping balances behind the chip holds the top bar to one row.
 */
export function AccountMenu({ actions, address, metrics, network, tone = 'ok' }: AccountMenuProps) {
	const popover = useDisclosurePopover()
	return (
		<div className='account-menu' ref={popover.containerRef}>
			<button {...popover.triggerProps} className='account-menu-trigger' aria-label={appCopy.formatAccountMenuLabel(abbreviateAddress(address))} onClick={popover.toggle}>
				<WalletChipLabel address={address} tone={tone} />
				<span className='account-menu-caret' aria-hidden='true' />
			</button>
			{popover.open ? (
				<div className='account-menu-popover' id={popover.panelId} role='group' aria-label={appCopy.accountDetails}>
					<AddressValue address={address} />
					{network === undefined ? undefined : <dl className='account-menu-network'>{network}</dl>}
					{metrics === undefined ? undefined : <div className='account-menu-metrics'>{metrics}</div>}
					{actions === undefined ? undefined : <div className='account-menu-actions'>{actions}</div>}
				</div>
			) : undefined}
		</div>
	)
}

/** One network fact row inside the account popover. */
export function AccountMenuNetworkFact({ children, label }: { children: ComponentChildren; label: string }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	)
}
