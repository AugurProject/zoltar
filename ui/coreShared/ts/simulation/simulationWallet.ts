/**
 * Wallet presentation modes for the walletless browser simulation.
 *
 * The simulated injected wallet normally matches the simulation chain and exposes the selected QA account.
 * QA can instead open the app with `simWallet=wrong-chain` or `simWallet=disconnected` so the wrong-network and
 * connect-a-wallet states render without a real wallet. Both modes mimic a cooperative wallet: `eth_requestAccounts`
 * connects the account and `wallet_switchEthereumChain` to the simulation chain switches back, so the app's
 * "Connect" and "Switch network" controls work exactly as they would against MetaMask.
 */
export const SIMULATION_WALLET_QUERY_PARAM = 'simWallet'

const SIMULATION_WALLET_MODES = ['connected', 'disconnected', 'wrong-chain'] as const

export type SimulationWalletMode = (typeof SIMULATION_WALLET_MODES)[number]

export const DEFAULT_SIMULATION_WALLET_MODE: SimulationWalletMode = 'connected'

/** Chain the simulated wallet reports while in `wrong-chain` mode. 31337 is the Anvil/Hardhat default and is not a public app profile, so the app cannot follow it. */
export const SIMULATION_WRONG_CHAIN_ID_HEX = '0x7a69'

/** EIP-1193 provider error code for a chain the wallet does not know (EIP-3085/3326). */
export const UNRECOGNIZED_CHAIN_ERROR_CODE = 4902

function isSimulationWalletMode(value: string): value is SimulationWalletMode {
	return (SIMULATION_WALLET_MODES as readonly string[]).includes(value)
}

export function parseSimulationWalletMode(raw: string | null | undefined): SimulationWalletMode {
	if (raw === null || raw === undefined) return DEFAULT_SIMULATION_WALLET_MODE
	const normalized = raw.trim().toLowerCase()
	return isSimulationWalletMode(normalized) ? normalized : DEFAULT_SIMULATION_WALLET_MODE
}

export function createProviderRpcError(code: number, message: string) {
	return Object.assign(new Error(message), { code })
}
