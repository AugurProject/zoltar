export type WalletSummaryState = Readonly<{
	account: `0x${string}` | undefined
	ethAttoEth: bigint | undefined
	repAttoRep: bigint | undefined
	status: 'disconnected' | 'loading' | 'ready' | 'error'
	error: string | undefined
	errorLabel: string | undefined
	universeId: string | undefined
}>
