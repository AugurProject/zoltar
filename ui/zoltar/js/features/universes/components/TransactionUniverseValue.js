import { Fragment as _Fragment, jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import { formatUniverseLabel } from '../lib/universe.js';
export function TransactionUniverseValue({ universeId }) {
    return _jsx(_Fragment, { children: universeId === undefined ? commonCopy.unavailable : formatUniverseLabel(universeId) });
}
//# sourceMappingURL=TransactionUniverseValue.js.map