import { getErrorDetail, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import * as copy from '../../../copy/universeNavigation.js'

/** Preserve actionable, bounded diagnostics instead of discarding the failure reason. */
export function describeUniverseReadError(error: unknown, context: string) {
	return getErrorMessage(getErrorDetail(error) ?? copy.readErrorDetailsMissing, context)
}
