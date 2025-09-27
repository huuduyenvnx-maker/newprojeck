import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { formatTime, getTimezoneDisplayName } from "@/lib/locale";

export default function AppHeader() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const changeLanguage = (language: string) => {
    i18n.changeLanguage(language);
    // Update document language for accessibility
    document.documentElement.lang = language;
  };
  
  // Get current time formatted for user's timezone
  const currentTime = formatTime(new Date());
  const timezoneDisplay = getTimezoneDisplayName();

  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Title */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <i className="fas fa-seedling text-primary-foreground text-sm"></i>
              </div>
              <h1 className="text-xl font-bold text-foreground">{t('header.title', 'AgriIntel')}</h1>
            </div>
            <div className="evidence-badge">
              <i className="fas fa-shield-check mr-1"></i>
              {t('header.verified', 'Verified-only')}
            </div>
          </div>

          {/* Status and Controls */}
          <div className="flex items-center space-x-6 text-sm text-muted-foreground">
            <span>{t('header.lastRun', 'Last run')} {currentTime} {timezoneDisplay} • {t('header.currency', 'USD')}</span>
            
            {/* Language Toggle */}
            <div className="flex bg-muted rounded-lg p-1">
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-3 py-1 text-xs rounded-md ${
                  currentLanguage === 'en' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground'
                }`}
                onClick={() => changeLanguage('en')}
                data-testid="language-en"
              >
                EN
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-3 py-1 text-xs rounded-md ${
                  currentLanguage === 'vi' 
                    ? 'bg-primary text-primary-foreground' 
                    : 'text-muted-foreground'
                }`}
                onClick={() => changeLanguage('vi')}
                data-testid="language-vi"
              >
                VI
              </Button>
            </div>

            {/* Controls */}
            <div className="flex items-center space-x-3">
              <Button variant="ghost" size="sm" data-testid="button-download">
                <i className="fas fa-download"></i>
              </Button>
              <Button variant="ghost" size="sm" data-testid="button-settings">
                <i className="fas fa-cog"></i>
              </Button>
              <Button variant="ghost" size="sm" data-testid="button-profile">
                <i className="fas fa-user-circle"></i>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
