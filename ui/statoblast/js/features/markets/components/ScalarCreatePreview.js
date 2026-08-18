import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js';
import { useEffect, useState } from 'preact/hooks';
import { ScalarOutcomePicker } from '@zoltar/ui-core-shared/components/ScalarOutcomePicker.js';
import { clampScalarTickIndex, formatScalarOutcomeLabel } from '@zoltar/ui-core-shared/lib/scalarOutcome.js';
export function ScalarCreatePreview({ details, selectedTick, onSelectedTickChange }) {
    const [isInvalid, setIsInvalid] = useState(false);
    const selectedTickValue = BigInt(selectedTick);
    const clampedSelectedTickValue = clampScalarTickIndex(selectedTickValue, details.numTicks);
    const clampedSelectedTick = clampedSelectedTickValue.toString();
    useEffect(() => {
        if (clampedSelectedTick === selectedTick)
            return;
        onSelectedTickChange(clampedSelectedTick);
    }, [clampedSelectedTick, onSelectedTickChange, selectedTick]);
    return (_jsx(ScalarOutcomePicker, { details: { numTicks: details.numTicks }, isInvalid: isInvalid, label: marketCopy.scalarPreview, onInvalidChange: setIsInvalid, onSelectedTickChange: onSelectedTickChange, selectedOutcomeLabel: isInvalid ? commonCopy.invalid : formatScalarOutcomeLabel(details, clampedSelectedTickValue), selectedTick: clampedSelectedTick, selectedTickLabel: isInvalid ? commonCopy.invalid : commonCopy.formatPairSlash(clampedSelectedTick, details.numTicks.toString()), showMinMax: false }));
}
//# sourceMappingURL=ScalarCreatePreview.js.map