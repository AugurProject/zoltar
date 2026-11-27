import type { ComponentChildren } from 'preact'
import { AddressValue, type AddressWidthConstraint } from './AddressValue.js'

type WalletChipTone = 'ok' | 'danger'

function chipClassName(tone: WalletChipTone) {
	return ['wallet-chip', tone === 'danger' ? 'is-danger' : ''].filter(Boolean).join(' ')
}

/** Responsive account identity for the toolbar with separate explorer and copy controls. */
export function WalletChip({ address, tone = 'ok', longAbbreviation = false, widthConstraint }: { address: string; tone?: WalletChipTone; longAbbreviation?: boolean; widthConstraint?: AddressWidthConstraint | undefined }) {
	return (
		<span className={chipClassName(tone)}>
			<span className='wallet-chip-dot' aria-hidden='true' />
			<AddressValue address={address} longAbbreviation={longAbbreviation} widthConstraint={widthConstraint} />
		</span>
	)
}

/** Reserves the wallet slot while the application decides whether a wallet control applies. */
export function WalletChipPlaceholder({ children }: { children: ComponentChildren }) {
	return <span className='wallet-chip is-placeholder'>{children}</span>
}
