import i18n from './i18n';

// Default timezone for Vietnamese market data
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Get user's preferred timezone from localStorage or default
export function getUserTimezone(): string {
  return localStorage.getItem('agriintel-timezone') || DEFAULT_TIMEZONE;
}

// Set user's preferred timezone
export function setUserTimezone(timezone: string) {
  localStorage.setItem('agriintel-timezone', timezone);
}

// Format date according to current locale and timezone
export function formatDate(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const timeZone = getUserTimezone();
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  };
  
  return new Intl.DateTimeFormat(locale, defaultOptions).format(dateObj);
}

// Format time according to current locale and timezone
export function formatTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const timeZone = getUserTimezone();
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };
  
  return new Intl.DateTimeFormat(locale, defaultOptions).format(dateObj);
}

// Format datetime according to current locale and timezone  
export function formatDateTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const timeZone = getUserTimezone();
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };
  
  return new Intl.DateTimeFormat(locale, defaultOptions).format(dateObj);
}

// Format currency according to current locale
export function formatCurrency(amount: number, currency: string = 'USD', options?: Intl.NumberFormatOptions): string {
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  
  const defaultOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  };
  
  return new Intl.NumberFormat(locale, defaultOptions).format(amount);
}

// Format number according to current locale
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  
  return new Intl.NumberFormat(locale, options).format(value);
}

// Format percentage according to current locale
export function formatPercentage(value: number, options?: Intl.NumberFormatOptions): string {
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  
  const defaultOptions: Intl.NumberFormatOptions = {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    ...options,
  };
  
  return new Intl.NumberFormat(locale, defaultOptions).format(value / 100);
}

// Get timezone display name
export function getTimezoneDisplayName(timezone: string = getUserTimezone()): string {
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  
  try {
    return new Intl.DateTimeFormat(locale, { 
      timeZone: timezone, 
      timeZoneName: 'short' 
    }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || timezone;
  } catch {
    return timezone;
  }
}

// Common timezones for Vietnamese users
export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City (ICT)' },
  { value: 'Asia/Hanoi', label: 'Hanoi (ICT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
] as const;