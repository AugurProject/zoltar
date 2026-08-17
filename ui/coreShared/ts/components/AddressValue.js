import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js';
import { CopyErrorMessage } from './CopyErrorMessage.js';
function abbreviateAddress(address) {
    if (address.length <= 13)
        return address;
    return `${address.slice(0, 8)}…${address.slice(-6)}`;
}
function AddressText({ address, responsiveAbbreviation }) {
    if (!responsiveAbbreviation)
        return _jsx(_Fragment, { children: address });
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: 'address-value-full', children: address }), _jsx("span", { "aria-hidden": 'true', className: 'address-value-abbreviated', children: abbreviateAddress(address) })] }));
}
export function AddressValue({ address, className = '', copyable = true, responsiveAbbreviation = false }) {
    const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(address);
    if (address === undefined) {
        const placeholder = getMetricPlaceholderPresentation(address)?.placeholder;
        return (_jsx("span", { className: `address-value ${className}`, title: placeholder, children: placeholder }));
    }
    if (!copyable)
        return (_jsx("span", { className: `address-value ${className}`, title: address, children: _jsx(AddressText, { address: address, responsiveAbbreviation: responsiveAbbreviation }) }));
    return (_jsxs("span", { className: 'copy-value-wrap', children: [_jsx("button", { type: 'button', className: `address-value copyable ${className}`, title: address, "aria-label": commonCopy.formatCopyAddressValue(address), "aria-describedby": copyError.value === undefined ? undefined : copyErrorId, onClick: () => copyText(address), children: copied.value ? commonCopy.copied : _jsx(AddressText, { address: address, responsiveAbbreviation: responsiveAbbreviation }) }), _jsx(CopyErrorMessage, { id: copyErrorId, manualValue: address, message: copyError.value })] }));
}
//# sourceMappingURL=AddressValue.js.map