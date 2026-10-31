import { preferences } from './foundry-state.js';
const key = 'sector7-visual-preferences';
let prefs;
try { prefs = preferences(JSON.parse(localStorage.getItem(key))); } catch { prefs = preferences(); }
export function applyPreferences() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.motion = prefs.lowPower ? 'off' : prefs.motion;
  document.documentElement.dataset.lowPower = String(prefs.lowPower);
}
applyPreferences();
for (const [id, field] of [['theme-choice', 'theme'], ['motion-choice', 'motion'], ['low-power', 'lowPower']]) {
  const input = document.getElementById(id);
  if (!input) continue;
  if (field === 'lowPower') input.checked = prefs[field]; else input.value = prefs[field];
  input.addEventListener('change', () => {
    prefs = preferences({ ...prefs, [field]: field === 'lowPower' ? input.checked : input.value });
    applyPreferences();
    try { localStorage.setItem(key, JSON.stringify(prefs)); } catch {
      const status = document.getElementById('preference-status');
      if (status) status.textContent = 'Preferences apply to this page; browser storage is unavailable.';
    }
  });
}
