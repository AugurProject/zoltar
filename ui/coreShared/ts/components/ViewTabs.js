import { jsx as _jsx } from "preact/jsx-runtime";
import { useEffect, useRef, useState } from 'preact/hooks';
function buildGroupedOptions(groups, indexedOptions) {
    if (groups === undefined)
        return undefined;
    const optionsByValue = new Map(indexedOptions.map(option => [option.option.value, option]));
    const renderedValues = new Set();
    return groups.map(group => {
        const groupedOptions = group.values.flatMap(groupValue => {
            if (renderedValues.has(groupValue))
                return [];
            const option = optionsByValue.get(groupValue);
            if (option === undefined)
                return [];
            renderedValues.add(groupValue);
            return [option];
        });
        if (group.className === undefined)
            return { ariaLabel: group.ariaLabel, options: groupedOptions };
        return { ariaLabel: group.ariaLabel, className: group.className, options: groupedOptions };
    });
}
export function ViewTabs({ ariaLabel, className = '', groups, onChange, onOverflowEdgesChange, options, orientation = 'horizontal', semantics, size = 'default', value, variant = 'subroute' }) {
    const containerRef = useRef(null);
    const [overflowEdges, setOverflowEdges] = useState({ end: false, start: false });
    const indexedOptions = options.map((option, index) => ({ index, option }));
    const resolvedSemantics = semantics ?? (options.every(option => option.panelId !== undefined) ? 'tabs' : 'switcher');
    const groupedOptions = buildGroupedOptions(groups, indexedOptions);
    const renderedOptions = groupedOptions === undefined ? indexedOptions : groupedOptions.flatMap(group => group.options);
    const moveSelection = (currentIndex, direction) => {
        const enabledOptions = renderedOptions.filter(({ option }) => option.disabled !== true);
        if (enabledOptions.length === 0)
            return undefined;
        if (direction === 'first')
            return enabledOptions[0];
        if (direction === 'last')
            return enabledOptions[enabledOptions.length - 1];
        const enabledIndex = enabledOptions.findIndex(option => option.index === currentIndex);
        if (enabledIndex === -1)
            return enabledOptions[0];
        const nextIndex = direction === 'next' ? (enabledIndex + 1) % enabledOptions.length : (enabledIndex - 1 + enabledOptions.length) % enabledOptions.length;
        return enabledOptions[nextIndex];
    };
    const handleKeyDown = (currentIndex, event) => {
        const navigationKey = (() => {
            if (event.key === (orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'))
                return 'next';
            if (event.key === (orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'))
                return 'previous';
            return (() => {
                if (event.key === 'Home')
                    return 'first';
                if (event.key === 'End')
                    return 'last';
                return undefined;
            })();
        })();
        if (navigationKey === undefined)
            return;
        const targetOption = moveSelection(currentIndex, navigationKey);
        if (targetOption === undefined)
            return;
        event.preventDefault();
        onChange(targetOption.option.value);
        const nextTabId = targetOption.option.id ?? `${ariaLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${String(targetOption.option.value).toLowerCase()}-tab`;
        const nextTab = document.getElementById(nextTabId);
        if (nextTab instanceof HTMLElement)
            nextTab.focus();
    };
    const renderOption = (option, index) => {
        const active = option.value === value;
        const tabId = option.id ?? `${ariaLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${String(option.value).toLowerCase()}-tab`;
        const sharedProps = {
            className: `view-tab ${active ? 'active' : ''}`.trim(),
            id: tabId,
            'aria-description': option.reason,
            title: option.reason,
            onClick: (event) => {
                if (option.disabled) {
                    event.preventDefault();
                    return;
                }
                if (option.href !== undefined && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey))
                    return;
                onChange(option.value);
            },
            onKeyDown: resolvedSemantics === 'navigation' ? undefined : (event) => handleKeyDown(index, event),
        };
        const semanticProps = (() => {
            if (resolvedSemantics === 'navigation')
                return { 'aria-current': active ? 'page' : undefined };
            if (resolvedSemantics === 'tabs')
                return { 'aria-controls': option.panelId, 'aria-selected': active, role: 'tab', tabIndex: active ? 0 : -1 };
            return { 'aria-pressed': active };
        })();
        const commonProps = { ...sharedProps, ...semanticProps };
        if (option.href !== undefined)
            return (_jsx("a", { ...commonProps, "aria-disabled": option.disabled === true ? 'true' : undefined, href: option.disabled === true ? undefined : option.href, role: option.disabled === true ? 'link' : undefined, tabIndex: option.disabled === true ? 0 : undefined, children: option.label }, option.value));
        return (_jsx("button", { ...commonProps, type: 'button', disabled: option.disabled, children: option.label }, option.value));
    };
    const renderOptions = () => {
        if (groupedOptions === undefined)
            return renderedOptions.map(({ index, option }) => renderOption(option, index));
        return groupedOptions.map(group => (_jsx("div", { className: group.className, role: 'group', "aria-label": group.ariaLabel, children: group.options.map(({ index, option }) => renderOption(option, index)) }, group.ariaLabel)));
    };
    const containerRole = (() => {
        if (resolvedSemantics === 'navigation')
            return undefined;
        if (resolvedSemantics === 'tabs')
            return 'tablist';
        return 'group';
    })();
    useEffect(() => {
        const container = containerRef.current;
        if (container === null || orientation !== 'horizontal')
            return;
        const scrollBehavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        const updateOverflowEdges = () => {
            const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
            const nextOverflowEdges = {
                end: container.scrollLeft < maxScrollLeft - 1,
                start: container.scrollLeft > 1,
            };
            setOverflowEdges(nextOverflowEdges);
            onOverflowEdgesChange?.(nextOverflowEdges);
        };
        const scrollActiveOptionIntoView = () => {
            const activeOption = container.querySelector('.view-tab.active');
            if (container.scrollWidth <= container.clientWidth || !(activeOption instanceof HTMLElement))
                return;
            const containerRect = container.getBoundingClientRect();
            const activeOptionRect = activeOption.getBoundingClientRect();
            const measuredLayout = containerRect.width > 0 && activeOptionRect.width > 0;
            const nearestScrollLeft = (() => {
                if (!measuredLayout)
                    return container.scrollLeft + activeOptionRect.left - containerRect.left - (container.clientWidth - activeOptionRect.width) / 2;
                if (activeOptionRect.left < containerRect.left)
                    return container.scrollLeft + activeOptionRect.left - containerRect.left;
                if (activeOptionRect.right > containerRect.right)
                    return container.scrollLeft + activeOptionRect.right - containerRect.right;
                return undefined;
            })();
            if (nearestScrollLeft === undefined)
                return;
            const targetScrollLeft = Math.min(container.scrollWidth - container.clientWidth, Math.max(0, nearestScrollLeft));
            if (typeof container.scrollTo === 'function')
                container.scrollTo({ behavior: scrollBehavior, left: targetScrollLeft });
            else
                container.scrollLeft = targetScrollLeft;
        };
        updateOverflowEdges();
        scrollActiveOptionIntoView();
        container.addEventListener('scroll', updateOverflowEdges, { passive: true });
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? undefined
            : new ResizeObserver(() => {
                updateOverflowEdges();
                scrollActiveOptionIntoView();
            });
        resizeObserver?.observe(container);
        return () => {
            container.removeEventListener('scroll', updateOverflowEdges);
            resizeObserver?.disconnect();
        };
    }, [onOverflowEdgesChange, options.length, orientation, value]);
    return (_jsx("div", { ref: containerRef, className: `view-tabs ${variant} ${overflowEdges.start ? 'has-overflow-start' : ''} ${overflowEdges.end ? 'has-overflow-end' : ''} ${className}`.trim(), "data-orientation": orientation, "data-size": size, role: containerRole, "aria-label": containerRole === undefined ? undefined : ariaLabel, children: renderOptions() }));
}
//# sourceMappingURL=ViewTabs.js.map