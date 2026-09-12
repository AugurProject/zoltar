import type { BotProcessLockOptions } from '@zoltar/bot-shared/execution/bot-process-locks'

/** The chaos bot reserves its configured signer even in dry-run mode so no second process can adopt it mid-scenario. */
export const CHAOS_PROCESS_LOCK_OPTIONS: BotProcessLockOptions = { label: 'chaos-bot', signerLocksInDryRun: true }
