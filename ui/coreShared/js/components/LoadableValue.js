import { jsx as _jsx, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { LoadingText } from './LoadingText.js';
export function LoadableValue({ children, loading, placeholder = commonCopy.loadingWithEllipsis }) {
    return loading ? _jsx(LoadingText, { children: placeholder }) : _jsx(_Fragment, { children: children });
}
//# sourceMappingURL=LoadableValue.js.map