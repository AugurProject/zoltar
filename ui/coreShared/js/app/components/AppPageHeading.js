import { jsx as _jsx } from "preact/jsx-runtime";
import { useEffect, useRef } from 'preact/hooks';
export function AppPageHeading({ formatDocumentTitle, pageTitle }) {
    const headingRef = useRef(null);
    const previousPageTitleRef = useRef(pageTitle);
    const historyTraversalUrlRef = useRef();
    useEffect(() => {
        const noteHistoryTraversal = () => {
            historyTraversalUrlRef.current = window.location.href;
        };
        window.addEventListener('popstate', noteHistoryTraversal);
        return () => window.removeEventListener('popstate', noteHistoryTraversal);
    }, []);
    useEffect(() => {
        document.title = formatDocumentTitle(pageTitle);
        if (previousPageTitleRef.current === pageTitle)
            return;
        previousPageTitleRef.current = pageTitle;
        const heading = headingRef.current;
        if (heading === null)
            return;
        const wasHistoryTraversal = historyTraversalUrlRef.current === window.location.href;
        historyTraversalUrlRef.current = undefined;
        if (!wasHistoryTraversal)
            document.getElementById('app-content')?.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
    }, [formatDocumentTitle, pageTitle]);
    return (_jsx("h1", { ref: headingRef, className: 'visually-hidden', tabIndex: -1, children: pageTitle }));
}
//# sourceMappingURL=AppPageHeading.js.map