import { useMemo, useRef } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import * as appCopy from '../../copy/app.js'
import { WalletChip } from '../../components/WalletChip.js'
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
 * The top bar's account identity and independent disclosure control for balances, network details,
 * and wallet actions. The address remains copyable and linked while the popover is closed.
 */
export function AccountMenu({ actions, address, metrics, network, tone = 'ok' }: AccountMenuProps) {
	const popover = useDisclosurePopover()
	const controlsRef = useRef<HTMLSpanElement>(null)
	const widthConstraint = useMemo(() => ({ slot: popover.containerRef, control: controlsRef }), [popover.containerRef])
	return (
		<div className='account-menu' ref={popover.containerRef}>
			<span className='account-menu-controls' ref={controlsRef}>
				<WalletChip address={address} tone={tone} widthConstraint={widthConstraint} />
				<button {...popover.triggerProps} className='account-menu-trigger' aria-label={appCopy.formatAccountMenuLabel(abbreviateAddress(address))} onClick={popover.toggle}>
					<span className='account-menu-caret' aria-hidden='true' />
				</button>
			</span>
			{popover.open ? (
				<div className='account-menu-popover' id={popover.panelId} role='group' aria-label={appCopy.accountDetails}>
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
