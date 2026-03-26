# Epic 13: Localization

**Goal**: Internationalize DSPanel with a complete i18n infrastructure and provide translations for 5 languages: English (default), French, German, Italian, and Spanish.

### Story 13.1: i18n Infrastructure Setup

As a developer,
I want a localization framework integrated into DSPanel,
so that all user-facing strings can be translated without code changes.

#### Acceptance Criteria

1. i18next and react-i18next installed and configured
2. All user-facing strings externalized to JSON translation files
3. English (en) as default language with complete coverage
4. Translation file structure organized by feature/view
5. Hot-switchable language at runtime (no restart required)
6. Date, number, and currency formatting follows selected locale
7. Language selection available in Settings > Appearance
8. Developer documentation explains how to add new languages

### Story 13.2: Translations

As a user,
I want DSPanel to be available in my language,
so that I can use the tool in my preferred language.

#### Acceptance Criteria

1. Complete translation files provided for all 5 languages:
   - English (en) - default, source of truth
   - French (fr)
   - German (de)
   - Italian (it)
   - Spanish (es)
2. All views, dialogs, notifications, and error messages translated
3. AD-specific technical terms kept in English where appropriate (DN, OU, GPO, etc.)
4. Pluralization rules handled correctly for each language
5. Date formatting follows each locale (fr: dd/MM/yyyy, de: dd.MM.yyyy, etc.)

---
