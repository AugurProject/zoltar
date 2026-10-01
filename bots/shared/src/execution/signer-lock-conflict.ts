export function signerConflictCopy(bot: string) {
	return `Signer is already in use by ${bot}. Live execution cannot use this signer. Choose a different signer in Settings, or stop the other bot and enable execution in Settings.`
}

export function isSignerLockConflictMessage(message: string) {
	return ['another bot', 'chaos-bot', 'liquidator', 'open-oracle-arbitrager'].some(bot => message === signerConflictCopy(bot))
}
