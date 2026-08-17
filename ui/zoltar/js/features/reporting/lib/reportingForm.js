import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js';
import { getDefaultReportingWithdrawDepositIndexesByOutcome } from '../../../lib/formDefaults.js';
export function applyReportingFormUpdate(current, update) {
    const securityPoolAddressChanged = update.securityPoolAddress !== undefined && !sameCaseInsensitiveText(current.securityPoolAddress, update.securityPoolAddress);
    const nextForm = {
        ...current,
        ...update,
        ...(securityPoolAddressChanged
            ? {
                selectedOutcome: undefined,
                selectedWithdrawDepositIndexesByOutcome: getDefaultReportingWithdrawDepositIndexesByOutcome(),
            }
            : {}),
    };
    const hasChanged = Object.keys(update).some(key => {
        if (key === 'securityPoolAddress' && update.securityPoolAddress !== undefined)
            return securityPoolAddressChanged || !sameCaseInsensitiveText(current.securityPoolAddress, nextForm.securityPoolAddress);
        return current[key] !== nextForm[key];
    });
    if (!hasChanged && current.selectedOutcome === nextForm.selectedOutcome)
        return current;
    return nextForm;
}
//# sourceMappingURL=reportingForm.js.map