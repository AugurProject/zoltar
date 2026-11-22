import type { BotProcessLockOptions } from '@zoltar/bot-shared/execution/bot-process-locks'

/** The dashboard reserves its configured signer in dry run. Headless dry runs, doctor and retirement commands do not acquire this execution lock. */
export const CHAOS_PROCESS_LOCK_OPTIONS: BotProcessLockOptions = { label: 'chaos-bot', signerLocksInDryRun: true }
