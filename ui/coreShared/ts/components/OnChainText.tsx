import { escapeOnChainText } from '../lib/onChainText.js'

/** Untrusted on-chain text, bidi-isolated from its surroundings and with hidden characters shown as escapes. */
export function OnChainText({ text, className }: { text: string; className?: string }) {
	return <bdi className={['on-chain-text', className].filter(Boolean).join(' ')}>{escapeOnChainText(text)}</bdi>
}
