# Localization

DSPanel uses [i18next](https://www.i18next.com/) with [react-i18next](https://react.i18next.com/) for internationalization. All user-facing strings are externalized into JSON translation files organized by namespace.

## Supported Languages

| Code | Language |
| ---- | -------- |
| en   | English (default, source of truth) |
| fr   | French |
| de   | German |
| it   | Italian |
| es   | Spanish |

## Architecture

### File Structure

```
src/
  i18n.ts                    # i18next configuration and helpers
  locales/
    en/                      # English translations (source of truth)
      index.ts               # Re-exports all namespace modules
      common.json            # Shared strings (Save, Cancel, Delete, etc.)
      sidebar.json           # Navigation labels
      layout.json            # Layout component strings
      home.json              # HomePage
      userLookup.json        # UserLookup page
      userDetail.json        # UserDetail page
      settings.json          # Settings page
      dialogs.json           # Dialog components (nested by dialog)
      components.json        # Reusable components (nested by component)
      ...                    # One file per page/feature
    fr/                      # French translations (same structure)
    de/                      # German translations
    it/                      # Italian translations
    es/                      # Spanish translations
```

### Namespace Strategy

Each page or feature has its own i18next **namespace** (one JSON file). This keeps translation files small and focused:

- `common` - default namespace, shared across all components
- `sidebar` - sidebar navigation labels
- `layout` - layout chrome (tab bar, breadcrumbs, status bar)
- `dialogs` - dialog components, nested by dialog name
- `components` - reusable components, nested by component name
- One namespace per page (e.g., `userLookup`, `settings`, `attackDetection`)

### Key Naming Convention

- **Flat keys** for page namespaces: `searchPlaceholder`, `pageTitle`, `loadingUsers`
- **Nested keys** for `dialogs` and `components`: `passwordReset.title`, `errorBoundary.description`
- **Plurals** use i18next `_one`/`_other` suffixes: `found_one`, `found_other`
- **Interpolation** uses double curly braces: `"Delete {{name}}?"`

## Usage in Components

### Basic usage with page namespace

```tsx
import { useTranslation } from "react-i18next";

export function UserLookup() {
  const { t } = useTranslation(["userLookup", "common"]);

  return (
    <div>
      <h1>{t("searchPlaceholder")}</h1>        {/* userLookup namespace */}
      <button>{t("common:retry")}</button>       {/* common namespace */}
    </div>
  );
}
```

### Interpolation

```tsx
// JSON: "deleteConfirmation": "Are you sure you want to delete {{name}}?"
t("deleteConfirmation", { name: user.displayName })

// JSON: "found_one": "{{count}} user found"
// JSON: "found_other": "{{count}} users found"
t("found", { count: users.length })  // i18next picks _one or _other
```

### Nested keys (dialogs and components)

```tsx
const { t } = useTranslation(["dialogs", "common"]);

t("passwordReset.title")           // "Reset Password"
t("moveObject.titleSingle", { name })  // "Move John Doe"
```

### Class components (ErrorBoundary)

Use the `Translation` render prop or `withTranslation` HOC:

```tsx
import { Translation } from "react-i18next";

<Translation ns="components">
  {(t) => <p>{t("errorBoundary.title")}</p>}
</Translation>
```

## Locale-Aware Formatting

The `src/utils/formatters.ts` module provides locale-aware formatting functions that automatically use the active i18n language:

- `formatDate(date)` - date only (respects locale: fr=dd/MM/yyyy, de=dd.MM.yyyy)
- `formatDateTime(date)` - date + time
- `formatRelativeTime(date)` - relative time ("3 days ago")
- `formatNumber(value)` - number with locale separators
- `formatPercent(value)` - percentage

## Adding a New Language

1. **Create the locale directory**: `src/locales/{code}/`

2. **Copy all JSON files** from `src/locales/en/` to the new directory

3. **Translate** all string values. Keep these in English:
   - AD technical terms: DN, OU, GPO, SID, LDAP, NTFS, MFA, HIBP
   - Product names: Active Directory, Domain Controller, Exchange, Entra ID
   - Acronyms: SAM, UPN, CSV, PDF, JSON, RBCD, FSMO

4. **Create `index.ts`** in the new locale directory, mirroring `en/index.ts`

5. **Register** the language in `src/i18n.ts`:
   ```ts
   import * as fr from "./locales/fr";

   // In the init() resources:
   resources: {
     en,
     fr,
   },
   ```

6. **Add** to `supportedLanguages` in `src/i18n.ts`

7. **Add tests** to verify all keys from `en` exist in the new language

## Persistence

The selected language is stored in `AppSettings.appearance.language` (Rust backend) and persisted to `%LOCALAPPDATA%/DSPanel/app-settings.json`. On startup, `loadPersistedLanguage()` reads this value and applies it.

Runtime language switching is handled by `changeLanguage(lang)` which:
1. Calls `i18n.changeLanguage(lang)` for immediate UI update
2. Persists the choice to AppSettings via Tauri IPC

## Testing

- `src/i18n.test.ts` - i18n initialization, language switching, namespace loading
- Translation completeness tests verify all keys in `en.json` exist in other languages

---
