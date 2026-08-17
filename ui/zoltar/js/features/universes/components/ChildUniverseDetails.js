import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { WalletAssetControl } from '@zoltar/ui-core-shared/components/WalletAssetControl.js';
import { formatUniverseLabel } from '../lib/universe.js';
export function ChildUniverseDetails({ accountAddress, child, isSupportedChain, showOutcomeIndex = false }) {
    return (_jsxs(DataGrid, { className: 'child-universe-details-grid', children: [_jsx(MetricField, { label: commonCopy.outcome, children: child.outcomeLabel }), showOutcomeIndex ? _jsx(MetricField, { label: commonCopy.outcomeIndex, children: child.outcomeIndex.toString() }) : undefined, child.exists ? (_jsx(MetricField, { label: commonCopy.reputationToken, children: _jsx(WalletAssetControl, { accountAddress: accountAddress, address: child.reputationToken, isSupportedChain: isSupportedChain, tokenLabel: `${formatUniverseLabel(child.universeId)} ${commonCopy.rep}` }) })) : undefined, child.forkTime !== 0n ? (_jsx(MetricField, { label: commonCopy.forkTime, children: _jsx(TimestampValue, { timestamp: child.forkTime }) })) : undefined] }));
}
//# sourceMappingURL=ChildUniverseDetails.js.map