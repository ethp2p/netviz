import { getEl } from './dom';
import type { Theme } from '../theme';
import {
  THEMES, DEFAULT_THEME,
  applyThemeCssVars, updateChromePalette,
  loadSavedThemeName, saveThemeName,
  findThemeByName,
} from '../theme';

export interface ThemePicker {
  current: Theme;
  onChange: (() => void) | null;
}

export function initThemePicker(): ThemePicker {
  const pickerEl = getEl('theme-picker');
  const btnEl = getEl<HTMLButtonElement>('theme-btn');
  const dropdownEl = getEl('theme-dropdown');

  const savedName = loadSavedThemeName();
  let current = (savedName ? findThemeByName(savedName) : undefined) ?? DEFAULT_THEME;

  const picker: ThemePicker = {
    current,
    onChange: null,
  };

  function apply(theme: Theme) {
    current = theme;
    picker.current = theme;
    btnEl.textContent = theme.name;
    applyThemeCssVars(theme);
    updateChromePalette(theme);
    saveThemeName(theme.name);
    closeDropdown();
    picker.onChange?.();
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
  }

  function toggleDropdown() {
    const isOpen = dropdownEl.classList.toggle('open');
    if (isOpen) rebuildDropdown();
  }

  function addSection(label: string, themes: readonly Theme[]) {
    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'dd-section-label';
    sectionLabel.textContent = label;
    dropdownEl.appendChild(sectionLabel);

    for (const theme of themes) {
      const item = document.createElement('div');
      item.className = 'dd-item';
      if (theme.name === current.name) item.classList.add('active');

      const label = document.createElement('span');
      label.textContent = theme.name;
      label.style.flex = '1';
      item.appendChild(label);

      if (theme.name === current.name) {
        const check = document.createElement('span');
        check.className = 'dd-check';
        check.textContent = '\u2713';
        item.appendChild(check);
      }

      item.addEventListener('click', () => apply(theme));
      dropdownEl.appendChild(item);
    }
  }

  function rebuildDropdown() {
    dropdownEl.replaceChildren();
    const dark = THEMES.filter(t => t.appearance === 'dark');
    const light = THEMES.filter(t => t.appearance === 'light');
    addSection('Dark', dark);
    if (light.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'dd-divider';
      dropdownEl.appendChild(divider);
      addSection('Light', light);
    }
  }

  btnEl.addEventListener('click', toggleDropdown);

  document.addEventListener('click', (e) => {
    if (!pickerEl.contains(e.target as Node)) closeDropdown();
  });

  // Apply initial theme
  apply(current);

  return picker;
}
