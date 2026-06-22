import { CHILD_UNIVERSE_ACTION_SAFETY_ENTRIES } from './childUniverseSafety.js'
import { DEPLOYMENT_ACTION_SAFETY_ENTRIES } from './deploymentSafety.js'
import { FORK_AUCTION_ACTION_SAFETY_ENTRIES } from './forkAuctionSafety.js'
import { MARKET_ACTION_SAFETY_ENTRIES } from './marketSafety.js'
import { OPEN_ORACLE_ACTION_SAFETY_ENTRIES } from './openOracleSafety.js'
import { REPORTING_ACTION_SAFETY_ENTRIES } from './reportingSafety.js'
import { SECURITY_POOL_ACTION_SAFETY_ENTRIES } from './securityPoolSafety.js'
import { SECURITY_VAULT_ACTION_SAFETY_ENTRIES } from './securityVaultSafety.js'
import { TRADING_ACTION_SAFETY_ENTRIES } from './tradingSafety.js'
import { ZOLTAR_ACTION_SAFETY_ENTRIES } from './zoltarSafety.js'
import { ZOLTAR_MIGRATION_ACTION_SAFETY_ENTRIES } from './zoltarMigrationSafety.js'
import type { ActionSafetyEntry } from './types.js'
import type { ReasonedActionSafetyState } from './reasoned.js'

export const ACTION_SAFETY_MANIFEST = [
	...CHILD_UNIVERSE_ACTION_SAFETY_ENTRIES,
	...DEPLOYMENT_ACTION_SAFETY_ENTRIES,
	...FORK_AUCTION_ACTION_SAFETY_ENTRIES,
	...MARKET_ACTION_SAFETY_ENTRIES,
	...OPEN_ORACLE_ACTION_SAFETY_ENTRIES,
	...REPORTING_ACTION_SAFETY_ENTRIES,
	...SECURITY_POOL_ACTION_SAFETY_ENTRIES,
	...SECURITY_VAULT_ACTION_SAFETY_ENTRIES,
	...TRADING_ACTION_SAFETY_ENTRIES,
	...ZOLTAR_ACTION_SAFETY_ENTRIES,
	...ZOLTAR_MIGRATION_ACTION_SAFETY_ENTRIES,
] satisfies readonly ActionSafetyEntry<ReasonedActionSafetyState>[]

export const ACTION_SAFETY_MANIFEST_BY_ID = new Map(ACTION_SAFETY_MANIFEST.map(entry => [entry.id, entry]))
