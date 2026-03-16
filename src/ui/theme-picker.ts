import { getEl } from './dom';
import type { Theme } from '../theme';
import {
  THEMES, DEFAULT_THEME,
  applyThemeCssVars,
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

  function rebuildDropdown() {
    dropdownEl.replaceChildren();
    for (const theme of THEMES) {
      const item = document.createElement('div');
      item.className = 'dd-item';
      if (theme.name === current.name) item.classList.add('active');

      const label = document.createElement('span');
      label.textContent = theme.name;
      item.appendChild(label);

      const swatch = document.createElement('span');
      swatch.style.display = 'inline-block';
      swatch.style.width = '8px';
      swatch.style.height = '8px';
      swatch.style.background = theme.bg;
      swatch.style.border = '1px solid ' + theme.border;
      swatch.style.flexShrink = '0';
      item.appendChild(swatch);

      item.addEventListener('click', () => apply(theme));
      dropdownEl.appendChild(item);
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
