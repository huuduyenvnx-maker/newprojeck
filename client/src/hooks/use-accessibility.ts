// Accessibility utilities for Vietnamese agricultural users

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Hook for announcing live region updates to screen readers
 * Optimized for Vietnamese agricultural context
 */
export function useLiveAnnouncement() {
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (liveRegionRef.current) {
      liveRegionRef.current.setAttribute('aria-live', priority);
      liveRegionRef.current.textContent = message;
      
      // Clear the message after a delay to allow for repeat announcements
      setTimeout(() => {
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = '';
        }
      }, 1000);
    }
  };

  const announceInVietnamese = (messageKey: string, fallback: string, priority?: 'polite' | 'assertive') => {
    const message = t(messageKey, fallback);
    announce(message, priority);
  };

  return { 
    announce, 
    announceInVietnamese, 
    liveRegionRef,
    liveRegionProps: {
      'aria-live': 'polite' as const,
      'aria-atomic': 'true' as const,
      className: 'sr-only',
      'data-testid': 'live-region'
    }
  };
}

/**
 * Hook for managing focus trap in modals/dialogs
 * Essential for keyboard navigation in agricultural settings
 */
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store the currently focused element
    previousActiveElement.current = document.activeElement;

    // Get all focusable elements within the container
    const focusableElements = containerRef.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        if (event.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement?.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement?.focus();
          }
        }
      }
      
      if (event.key === 'Escape') {
        event.preventDefault();
        // Allow parent component to handle escape
        const escapeEvent = new CustomEvent('focus-trap-escape');
        containerRef.current?.dispatchEvent(escapeEvent);
      }
    };

    // Focus the first element
    firstElement?.focus();

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      
      // Restore focus to the previously focused element
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive]);

  return containerRef;
}

/**
 * Hook for keyboard navigation in data tables
 * Optimized for agricultural data tables with Vietnamese content
 */
export function useTableNavigation() {
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('td, th')) return;

      const cell = target.closest('td, th') as HTMLTableCellElement;
      const row = cell.parentElement as HTMLTableRowElement;
      const cellIndex = Array.from(row.children).indexOf(cell);
      const rowIndex = Array.from(table.querySelectorAll('tr')).indexOf(row);

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          navigateToCell(rowIndex - 1, cellIndex);
          break;
        case 'ArrowDown':
          event.preventDefault();
          navigateToCell(rowIndex + 1, cellIndex);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          navigateToCell(rowIndex, cellIndex - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          navigateToCell(rowIndex, cellIndex + 1);
          break;
        case 'Home':
          event.preventDefault();
          if (event.ctrlKey) {
            navigateToCell(0, 0);
          } else {
            navigateToCell(rowIndex, 0);
          }
          break;
        case 'End':
          event.preventDefault();
          if (event.ctrlKey) {
            const rows = table.querySelectorAll('tr');
            const lastRow = rows[rows.length - 1];
            const lastCell = lastRow.children.length - 1;
            navigateToCell(rows.length - 1, lastCell);
          } else {
            navigateToCell(rowIndex, row.children.length - 1);
          }
          break;
      }
    };

    const navigateToCell = (rowIndex: number, cellIndex: number) => {
      const rows = table.querySelectorAll('tr');
      if (rowIndex < 0 || rowIndex >= rows.length) return;
      
      const targetRow = rows[rowIndex];
      const targetCell = targetRow.children[cellIndex] as HTMLTableCellElement;
      
      if (targetCell) {
        // Focus the first focusable element in the cell, or the cell itself
        const focusable = targetCell.querySelector('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])') as HTMLElement;
        if (focusable) {
          focusable.focus();
        } else {
          targetCell.focus();
        }
      }
    };

    table.addEventListener('keydown', handleKeyDown);

    return () => {
      table.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return tableRef;
}

/**
 * Hook for managing reduced motion preferences
 * Important for users with vestibular disorders in agricultural settings
 */
export function useReducedMotion() {
  const prefersReducedMotion = typeof window !== 'undefined' 
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  return prefersReducedMotion;
}

/**
 * Hook for managing high contrast mode
 * Important for users with visual impairments in agricultural settings
 */
export function useHighContrast() {
  const prefersHighContrast = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-contrast: high)').matches
    : false;

  return prefersHighContrast;
}