import { setWebLanguage } from '../src/shared/i18n';

/**
 * Must be the FIRST import of every webview entry point: switches the text
 * tables to the language the host wrote into `<html lang>` before any module
 * builds elements. Changing the language makes the host reload the webview.
 */
setWebLanguage(document.documentElement.lang === 'th' ? 'th' : 'en');
