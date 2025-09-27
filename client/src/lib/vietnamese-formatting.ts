// Vietnamese number and currency formatting utilities for accessibility

/**
 * Format currency in Vietnamese format (WCAG 3.1.2 compliance)
 * @param value - The numeric value to format
 * @param currency - The currency code (default: 'VND')
 * @returns Formatted currency string in Vietnamese locale
 */
export function formatVietnameseCurrency(value: number, currency: 'VND' | 'USD' = 'VND'): string {
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: currency === 'VND' ? 0 : 2,
    }).format(value);
  } catch (error) {
    // Fallback formatting for older browsers
    const formattedNumber = value.toLocaleString('vi-VN');
    return currency === 'VND' ? `${formattedNumber} ₫` : `$${formattedNumber}`;
  }
}

/**
 * Format numbers in Vietnamese format with proper thousand separators
 * @param value - The numeric value to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted number string in Vietnamese locale
 */
export function formatVietnameseNumber(value: number, decimals: number = 2): string {
  try {
    return new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch (error) {
    // Fallback formatting
    return value.toLocaleString('vi-VN');
  }
}

/**
 * Format date in Vietnamese format for accessibility
 * @param date - The date to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string in Vietnamese locale
 */
export function formatVietnameseDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  try {
    return new Intl.DateTimeFormat('vi-VN', options).format(dateObj);
  } catch (error) {
    // Fallback formatting
    return dateObj.toLocaleDateString('vi-VN');
  }
}

/**
 * Format percentage in Vietnamese format
 * @param value - The percentage value (0-100)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatVietnamesePercentage(value: number, decimals: number = 1): string {
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'percent',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value / 100);
  } catch (error) {
    // Fallback formatting
    return `${value.toFixed(decimals)}%`;
  }
}

/**
 * Screen reader friendly number formatting for Vietnamese users
 * @param value - The numeric value
 * @param unit - Optional unit (e.g., 'đồng', 'phần trăm')
 * @returns Number formatted for Vietnamese screen readers
 */
export function formatForVietnameseScreenReader(
  value: number, 
  unit?: string
): string {
  const formattedNumber = formatVietnameseNumber(value, 0);
  
  // Add pronunciation hints for screen readers
  let screenReaderText = formattedNumber.replace(/\./g, ' chấm ');
  
  if (unit) {
    screenReaderText += ` ${unit}`;
  }
  
  return screenReaderText;
}

/**
 * Get Vietnamese currency symbol with proper accessibility attributes
 * @param currency - Currency code
 * @returns Object with symbol and aria-label
 */
export function getVietnameseCurrencyAccessibility(currency: 'VND' | 'USD' = 'VND') {
  const symbols = {
    VND: { symbol: '₫', ariaLabel: 'đồng Việt Nam' },
    USD: { symbol: '$', ariaLabel: 'đô la Mỹ' }
  };
  
  return symbols[currency];
}