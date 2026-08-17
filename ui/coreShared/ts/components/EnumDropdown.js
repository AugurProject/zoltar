import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useEffect, useRef, useState } from 'preact/hooks';
export function EnumDropdown({ ariaDescribedBy, ariaLabel, disabled = false, invalid = false, onChange, options, placeholder, value }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const selectedOption = value === undefined ? undefined : options.find(option => option.value === value);
    const triggerLabel = selectedOption?.label ?? value ?? placeholder ?? '';
    const accessibleTriggerLabel = ariaLabel === undefined || triggerLabel === '' ? ariaLabel : commonCopy.formatLabelValue(ariaLabel, triggerLabel);
    const closeAndFocusTrigger = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };
    const focusMenuOptionAt = (currentTarget, direction) => {
        if (rootRef.current === null || currentTarget === null)
            return;
        const menuOptions = Array.from(rootRef.current.querySelectorAll('.enum-dropdown-option'));
        if (menuOptions.length === 0)
            return;
        const currentIndex = menuOptions.indexOf(currentTarget);
        if (currentIndex === -1)
            return;
        const nextIndex = (currentIndex + direction + menuOptions.length) % menuOptions.length;
        menuOptions[nextIndex]?.focus();
    };
    useEffect(() => {
        if (!open || rootRef.current === null)
            return;
        const selectedMenuOption = rootRef.current.querySelector('.enum-dropdown-option.selected');
        const firstMenuOption = rootRef.current.querySelector('.enum-dropdown-option');
        (selectedMenuOption ?? firstMenuOption)?.focus();
    }, [open]);
    useEffect(() => {
        if (disabled)
            setOpen(false);
    }, [disabled]);
    useEffect(() => {
        const handleDocumentMouseDown = (event) => {
            if (rootRef.current === null)
                return;
            if (event.target instanceof Node && rootRef.current.contains(event.target))
                return;
            setOpen(false);
        };
        const handleDocumentFocusIn = (event) => {
            if (rootRef.current === null)
                return;
            if (event.target instanceof Node && rootRef.current.contains(event.target))
                return;
            setOpen(false);
        };
        const handleDocumentFocusOut = (event) => {
            if (rootRef.current === null)
                return;
            if (!(event.target instanceof Node) || !rootRef.current.contains(event.target))
                return;
            if (event.relatedTarget instanceof Node && rootRef.current.contains(event.relatedTarget))
                return;
            setOpen(false);
        };
        const handleDocumentKeyDown = (event) => {
            if (event.key === 'Escape')
                setOpen(false);
        };
        document.addEventListener('mousedown', handleDocumentMouseDown);
        document.addEventListener('focusin', handleDocumentFocusIn);
        document.addEventListener('focusout', handleDocumentFocusOut);
        document.addEventListener('keydown', handleDocumentKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleDocumentMouseDown);
            document.removeEventListener('focusin', handleDocumentFocusIn);
            document.removeEventListener('focusout', handleDocumentFocusOut);
            document.removeEventListener('keydown', handleDocumentKeyDown);
        };
    }, []);
    return (_jsxs("div", { className: 'enum-dropdown', ref: rootRef, children: [_jsxs("button", { ref: triggerRef, className: `enum-dropdown-trigger ${open ? 'open' : ''}`, type: 'button', disabled: disabled, "aria-describedby": ariaDescribedBy, "aria-invalid": invalid ? 'true' : undefined, "aria-label": accessibleTriggerLabel, "aria-haspopup": 'listbox', "aria-expanded": open, onKeyDown: event => {
                    if (event.key === 'Escape') {
                        setOpen(false);
                        return;
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        if (!disabled) {
                            setOpen(true);
                        }
                    }
                }, onClick: () => {
                    if (disabled)
                        return;
                    setOpen(current => !current);
                }, children: [_jsx("span", { className: 'enum-dropdown-label', children: triggerLabel }), _jsx("span", { className: 'enum-dropdown-chevron', "aria-hidden": 'true' })] }), open && !disabled ? (_jsx("div", { className: 'enum-dropdown-menu', role: 'listbox', "aria-label": commonCopy.dropdownOptions, children: options.map(option => (_jsx("button", { className: `enum-dropdown-option ${option.value === value ? 'selected' : ''}`, type: 'button', role: 'option', "aria-selected": option.value === value, onKeyDown: event => {
                        if (event.key === 'Escape') {
                            closeAndFocusTrigger();
                            return;
                        }
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            focusMenuOptionAt(event.currentTarget, 1);
                        }
                        if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            focusMenuOptionAt(event.currentTarget, -1);
                        }
                    }, onClick: () => {
                        if (disabled)
                            return;
                        onChange(option.value);
                        closeAndFocusTrigger();
                    }, children: option.label }, option.value))) })) : undefined] }));
}
//# sourceMappingURL=EnumDropdown.js.map