import type { ComponentChildren } from 'preact'
import { AddressValue, ReadOnlyAddressValue } from './AddressValue.js'

type WalletChipTone = 'ok' | 'danger'

function chipClassName(tone: WalletChipTone, extra = '') {
	return ['wallet-chip', tone === 'danger' ? 'is-danger' : '', extra].filter(Boolean).join(' ')
}

/** Abbreviated account identity for the toolbar; copies the full address on click. */
export function WalletChip({ address, tone = 'ok' }: { address: string; tone?: WalletChipTone }) {
	return (
		<span className={chipClassName(tone)}>
			<span className='wallet-chip-dot' aria-hidden='true' />
			<AddressValue address={address} responsiveAbbreviation />
		</span>
	)
}

/** Non-interactive chip body for use inside a `<summary>`, where nested buttons are not allowed. */
export function WalletChipLabel({ address, tone = 'ok' }: { address: string; tone?: WalletChipTone }) {
	return (
		<span className={chipClassName(tone, 'is-static')}>
			<span className='wallet-chip-dot' aria-hidden='true' />
			<ReadOnlyAddressValue address={address} responsiveAbbreviation />
		</span>
	)
}

/** Reserves the wallet slot while the application decides whether a wallet control applies. */
export function WalletChipPlaceholder({ children }: { children: ComponentChildren }) {
	return <span className='wallet-chip is-placeholder'>{children}</span>
}
