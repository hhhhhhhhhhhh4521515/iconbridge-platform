# ADR-016: Country fields are searchable comboboxes

Date: 2026-10-15. Status: accepted. Replaces the "Country lists" row of [ADR-008](ADR-008-candidate-area.md).

## Context

The registration form and the profile wizard asked for countries (residence, nationality, passport issuing country, phone calling code) with native `<select>` lists whose options started with a flag emoji. A native list finds an option by its first letters; the first characters were the flag, so typing "Tun" found nothing. On the first production test the candidate had to scroll through about 250 countries four times.

## Decision

1. One component, `CountryCombobox` (`apps/web/src/components/forms/country-combobox.tsx`), following the WAI-ARIA combobox pattern: a text field (`role="combobox"`, `aria-expanded`, `aria-activedescendant`) that controls a `role="listbox"`.
2. Search (`apps/web/src/lib/country-search.ts`, unit-tested): the name in the page language with case, accents and Arabic letter variants ignored; the ISO code; and keywords (the calling code in the phone field, with or without "+"). The ISO code first, then names that start with the text, then names with a word that starts with it, then names that contain it. The flag is drawn beside the text and never searched.
3. Order: Tunisia, Morocco, Algeria, Egypt, Malta and Poland, where most candidates come from, then every other country by name in the page language.
4. Keyboard: arrows, Home/End, Enter, Escape; Tab takes the highlighted country when something was typed. A full name or code typed or filled in by the browser counts when the field is left. Rows are 44 px high; logical CSS mirrors the list on Arabic pages; the phone part stays left to right.
5. Written in the project rather than taken from a library (cmdk with a Radix popover): the behaviour needed is small, the search must be our own anyway (accents, Arabic, priorities), and the strict Content-Security-Policy and the bundle size stay as they are.

## Consequences

- The country fields need JavaScript, like the rest of the candidate area.
- Browser tests choose a country with `pickCountry()` (`apps/web/e2e/support.ts`); the ISO code is still in a hidden input (`data-testid` of the phone country).
- axe checks the field with its list open, in English and Arabic.
