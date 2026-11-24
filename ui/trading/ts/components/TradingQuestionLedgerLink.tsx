import { QuestionLedgerLink as SharedQuestionLedgerLink } from '@zoltar/ui-core-shared/components/QuestionLedgerLink.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { openQuestionLedgerLabel } from '../copy/app.js'

/** The shared pool link addressed to Trading's question ledger route. */
export function TradingQuestionLedgerLink({ value, disabled = false }: { value: string; disabled?: boolean }) {
	return <SharedQuestionLedgerLink ariaLabel={openQuestionLedgerLabel(value)} disabled={disabled} href={getTradingRouteHref(`#/security-pool/${value}`)} questionLedgerAddress={value} />
}
