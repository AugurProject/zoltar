import { endSentence } from '../lib/format.js'
import { getErrorDetail, isWalletRejection, transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'

const PROVIDER_IDENTIFIER_PATTERN = /(?<![0-9a-f])0x[0-9a-f]{40}(?![0-9a-f])|share[ -]?token|token[ _-]?id|contract address|call (?:arguments?|args)|\bargs?:/i

/** Shared error cleanup, except that details naming provider identifiers (addresses, token IDs, call arguments) fall back to generic copy. Every result is a closed sentence, so it can be shown as-is or follow a lead. */
export function publicErrorMessage(error: unknown, fallback: string) {
	if (isWalletRejection(error)) return transactionErrorMessages.walletRejected
	// Only thrown errors carry provider text worth showing; other values are unknown and fall back to generic copy.
	if (!(error instanceof Error)) return endSentence(fallback)
	const detail = getErrorDetail(error, fallback)
	if (detail === undefined || PROVIDER_IDENTIFIER_PATTERN.test(detail)) return endSentence(fallback)
	// The shared cleanup shortens long details, which could cut an identifier below the pattern's length; check the original text too.
	if (PROVIDER_IDENTIFIER_PATTERN.test(error.message)) return endSentence(fallback)
	return endSentence(detail)
}
