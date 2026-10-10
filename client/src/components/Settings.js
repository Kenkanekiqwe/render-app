import React, { useState, useEffect } from 'react';
import './Settings.css';
import { useLanguage } from '../context/LanguageContext';
import { ACCENT_PRESETS, ACCENT_RGB_PRESET, ACCENT_WHITE_PRESET, SLEEP_TIMER_MINUTES, THEME_PRESETS } from '../utils/storage';
import {
  UI_SOUND_PACKS,
  getDefaultUiSoundStyle,
  getUiSoundStyles,
  playUiSound,
  setUiSoundConfig,
} from '../utils/uiSounds';
import { FONT_PRESETS } from '../utils/fonts';
import { isDesktopApp } from '../utils/tauri';
import {
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  bindFromKeyboardEvent,
  formatKeybind,
  isModifierKey,
  normalizeKeybinds,
} from '../utils/keybinds';
import AdminPanel from './AdminPanel';
import {
  FaCog,
  FaKeyboard,
  FaPalette,
  FaWrench,
  FaUserShield,
  FaUser,
  FaTrash,
  FaHeartBroken,
  FaSave,
  FaTimes,
  FaExternalLinkAlt,
  FaVolumeUp,
  FaUndo,
  FaSignOutAlt,
} from 'react-icons/fa';

function SettingsButton({ variant = 'secondary', icon: Icon, className = '', children, ...props }) {
  return (
    <button
      type="button"
      className={`settings-btn settings-btn--${variant}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {Icon ? <Icon className="settings-btn-icon" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function SettingsSection({ title, description, children, className = '' }) {
  return (
    <section className={`settings-section${className ? ` ${className}` : ''}`}>
      {(title || description) && (
        <div className="settings-section-head">
          {title ? <h4>{title}</h4> : null}
          {description ? <p>{description}</p> : null}
        </div>
      )}
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function SettingsToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <label className="settings-switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span />
      </label>
    </div>
  );
}

function SettingsSliderRow({ label, description, valueLabel, children }) {
  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row-top">
        <div className="settings-row-copy">
          <strong>{label}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        {valueLabel ? <span className="settings-row-value">{valueLabel}</span> : null}
      </div>
      {children}
    </div>
  );
}

function KeybindField({ action, label, description, value, recording, onRecordStart, onChange, t }) {
  const isRecording = recording === action;

  useEffect(() => {
    if (!isRecording) return undefined;

    document.body.dataset.keybindCapture = '1';

    const handleKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        onRecordStart(null);
        return;
      }

      if (isModifierKey(event.code)) return;

      onChange(bindFromKeyboardEvent(event));
      onRecordStart(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      delete document.body.dataset.keybindCapture;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isRecording, action, onChange, onRecordStart]);

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      <SettingsButton
        variant="ghost"
        icon={FaKeyboard}
        className={`settings-keybind-btn${isRecording ? ' recording' : ''}`}
        onClick={() => onRecordStart(isRecording ? null : action)}
      >
        {isRecording ? t('keybindPressKey') : formatKeybind(value)}
      </SettingsButton>
    </div>
  );
}

function Settings({
  appSettings,
  onAppSettingsChange,
  sleepEndsAt = null,
  onSleepTimer,
  onBackgroundSave,
  onOpenWorkshop,
  onOpenAdmin,
  onClearHistory,
  onClearLiked,
  authUser,
  privacy,
  onPrivacyChange,
  onLogout,
}) {
  const { language, setLanguage, t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState('general');
  const [recordingKeybind, setRecordingKeybind] = useState(null);
  const [backgroundInput, setBackgroundInput] = useState(appSettings.customBackgroundUrl || '');
  const [sleepChoice, setSleepChoice] = useState(0);
  const [sleepNow, setSleepNow] = useState(() => Date.now());

  useEffect(() => {
    setBackgroundInput(appSettings.customBackgroundUrl || '');
  }, [appSettings.customBackgroundUrl]);

  useEffect(() => {
    if (!sleepEndsAt) {
      setSleepChoice(0);
      return undefined;
    }
    setSleepNow(Date.now());
    const timer = window.setInterval(() => setSleepNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sleepEndsAt]);

  const togglePrivacy = (key) => {
    if (!privacy || !onPrivacyChange) return;
    onPrivacyChange({ [key]: !privacy[key] });
  };

  const tabs = [
    { id: 'general', label: t('settingsGeneral'), icon: FaCog, desc: t('settingsGeneralDesc') },
    { id: 'controls', label: t('settingsControls'), icon: FaKeyboard, desc: t('settingsControlsDesc') },
    { id: 'appearance', label: t('settingsAppearance'), icon: FaPalette, desc: t('settingsAppearanceDesc') },
    { id: 'workshop', label: t('workshopTitle'), icon: FaWrench, desc: t('workshopDesc') },
    ...(authUser?.isAdmin ? [{ id: 'admin', label: t('adminTitle'), icon: FaUserShield, desc: t('adminDesc') }] : []),
    { id: 'account', label: t('settingsAccount'), icon: FaUser, desc: t('settingsAccountDesc') },
  ];

  const languages = [
    { id: 'english', name: 'English', code: 'EN' },
    { id: 'russian', name: 'Русский', code: 'RU' },
    { id: 'ukrainian', name: 'Українська', code: 'UA' },
  ];

  const historyLimits = [25, 50, 100, 200];

  const updateSetting = (key, value) => {
    onAppSettingsChange({ ...appSettings, [key]: value });
  };

  const keybinds = appSettings.keybinds || DEFAULT_KEYBINDS;

  const updateKeybind = (action, bind) => {
    onAppSettingsChange({
      ...appSettings,
      keybinds: { ...keybinds, [action]: bind },
    });
  };

  const updateKeybindSettings = (patch) => {
    onAppSettingsChange({
      ...appSettings,
      keybinds: { ...keybinds, ...patch },
    });
  };

  const resetKeybinds = () => {
    onAppSettingsChange({
      ...appSettings,
      keybinds: normalizeKeybinds(DEFAULT_KEYBINDS),
    });
  };

  const keybindRows = [
    { action: 'volumeUp', label: t('keybindVolumeUp'), description: t('keybindVolumeUpDesc') },
    { action: 'volumeDown', label: t('keybindVolumeDown'), description: t('keybindVolumeDownDesc') },
    { action: 'mute', label: t('keybindMute'), description: t('keybindMuteDesc') },
    { action: 'playPause', label: t('keybindPlayPause'), description: t('keybindPlayPauseDesc') },
    { action: 'nextTrack', label: t('keybindNextTrack'), description: t('keybindNextTrackDesc') },
    { action: 'prevTrack', label: t('keybindPrevTrack'), description: t('keybindPrevTrackDesc') },
  ].filter((row) => KEYBIND_ACTIONS.includes(row.action));

  const selectAccentPreset = (preset) => {
    if (preset.rgb) {
      onAppSettingsChange({
        ...appSettings,
        accentRgb: true,
        accentNeutral: false,
        accentHue: 265,
      });
      return;
    }
    if (preset.neutral) {
      onAppSettingsChange({
        ...appSettings,
        accentRgb: false,
        accentNeutral: true,
        accentHue: 0,
      });
      return;
    }
    onAppSettingsChange({
      ...appSettings,
      accentRgb: false,
      accentNeutral: false,
      accentHue: preset.hue,
    });
  };

  const activeTab = tabs.find((tab) => tab.id === activeCategory);
  const sleepRemainingMs = sleepEndsAt ? Math.max(0, sleepEndsAt - sleepNow) : 0;
  const sleepRemainingLabel = sleepRemainingMs > 0
    ? `${Math.floor(sleepRemainingMs / 60000)}:${String(Math.floor((sleepRemainingMs % 60000) / 1000)).padStart(2, '0')}`
    : '';

  const setSleep = (minutes) => {
    setSleepChoice(minutes);
    onSleepTimer?.(minutes);
  };

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav-brand">
            <span className="settings-nav-kicker">{t('settings')}</span>
            <h2>{t('settingsTitle')}</h2>
            <p>{t('settingsSubtitle')}</p>
          </div>
          <nav className="settings-nav-list" aria-label={t('settingsTitle')}>
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-nav-item${activeCategory === tab.id ? ' active' : ''}`}
                  onClick={() => setActiveCategory(tab.id)}
                >
                  <TabIcon className="settings-nav-item-icon" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="settings-main">
          <header className="settings-main-head">
            <h3>{activeTab?.label}</h3>
            {activeTab?.desc ? <p>{activeTab.desc}</p> : null}
          </header>

          {activeCategory === 'general' && (
            <div className="settings-stack">
              <SettingsSection title={t('appLanguage')} description={t('settingsLanguageDesc')}>
                <div className="settings-chip-row">
                  {languages.map((lang) => (
                    <button
                      key={lang.id}
                      type="button"
                      className={`settings-chip${language === lang.id ? ' selected' : ''}`}
                      onClick={() => setLanguage(lang.id)}
                    >
                      <span className="settings-chip-code">{lang.code}</span>
                      {lang.name}
                    </button>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsPlayback')} description={t('settingsPlaybackDesc')}>
                <div className="settings-list">
                  <SettingsToggleRow
                    label={t('settingsAutoplayNext')}
                    description={t('settingsAutoplayNextDesc')}
                    checked={appSettings.autoplayNext}
                    onChange={(e) => updateSetting('autoplayNext', e.target.checked)}
                  />
                  <SettingsToggleRow
                    label={t('settingsResumePlayback')}
                    description={t('settingsResumePlaybackDesc')}
                    checked={Boolean(appSettings.resumePlayback)}
                    onChange={(e) => updateSetting('resumePlayback', e.target.checked)}
                  />
                  <SettingsToggleRow
                    label={t('playerNormalize')}
                    description={t('playerNormalizeDesc')}
                    checked={Boolean(appSettings.normalizeLoudness)}
                    onChange={(e) => updateSetting('normalizeLoudness', e.target.checked)}
                  />
                  <SettingsSliderRow
                    label={t('settingsCrossfade')}
                    description={t('settingsCrossfadeDesc')}
                    valueLabel={`${appSettings.crossfadeSeconds || 0} ${t('settingsSeconds')}`}
                  >
                    <input
                      type="range"
                      min="0"
                      max="8"
                      step="1"
                      value={appSettings.crossfadeSeconds || 0}
                      onChange={(e) => updateSetting('crossfadeSeconds', Number(e.target.value))}
                    />
                  </SettingsSliderRow>
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row-copy">
                      <strong>{t('settingsSleepTimer')}</strong>
                      <span>
                        {sleepRemainingLabel
                          ? `${t('settingsSleepTimerDesc')} · ${sleepRemainingLabel}`
                          : t('settingsSleepTimerDesc')}
                      </span>
                    </div>
                    <div className="settings-chip-row">
                      <button
                        type="button"
                        className={`settings-chip settings-chip--compact${!sleepEndsAt ? ' selected' : ''}`}
                        onClick={() => setSleep(0)}
                      >
                        {t('settingsSleepOff')}
                      </button>
                      {SLEEP_TIMER_MINUTES.map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={`settings-chip settings-chip--compact${sleepChoice === minutes && sleepEndsAt ? ' selected' : ''}`}
                          onClick={() => setSleep(minutes)}
                        >
                          {minutes}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsHistoryLimit')} description={t('settingsHistoryLimitDesc')}>
                <div className="settings-chip-row">
                  {historyLimits.map((limit) => (
                    <button
                      key={limit}
                      type="button"
                      className={`settings-chip settings-chip--compact${appSettings.historyLimit === limit ? ' selected' : ''}`}
                      onClick={() => updateSetting('historyLimit', limit)}
                    >
                      {limit}
                    </button>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsData')} description={t('settingsDataDesc')}>
                <div className="settings-action-row">
                  <SettingsButton variant="secondary" icon={FaTrash} onClick={onClearHistory}>
                    {t('settingsClearHistory')}
                  </SettingsButton>
                  <SettingsButton variant="secondary" icon={FaHeartBroken} onClick={onClearLiked}>
                    {t('settingsClearLiked')}
                  </SettingsButton>
                </div>
              </SettingsSection>
            </div>
          )}

          {activeCategory === 'controls' && (
            <div className="settings-stack">
              <SettingsSection>
                <div className="settings-list">
                  <SettingsToggleRow
                    label={t('keybindEnabled')}
                    description={t('keybindEnabledDesc')}
                    checked={Boolean(keybinds.enabled)}
                    onChange={(e) => updateKeybindSettings({ enabled: e.target.checked })}
                  />
                  <SettingsSliderRow
                    label={t('keybindVolumeStep')}
                    description={t('keybindVolumeStepDesc')}
                    valueLabel={`${keybinds.volumeStep}%`}
                  >
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={keybinds.volumeStep}
                      onChange={(e) => updateKeybindSettings({ volumeStep: Number(e.target.value) })}
                    />
                  </SettingsSliderRow>
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsControlsTitle')} description={t('settingsControlsDesc')}>
                {isDesktopApp() ? <p className="settings-inline-note">{t('keybindGlobalDesc')}</p> : null}
                <div className="settings-list">
                  {keybindRows.map((row) => (
                    <KeybindField
                      key={row.action}
                      action={row.action}
                      label={row.label}
                      description={row.description}
                      value={keybinds[row.action]}
                      recording={recordingKeybind}
                      onRecordStart={setRecordingKeybind}
                      onChange={(bind) => updateKeybind(row.action, bind)}
                      t={t}
                    />
                  ))}
                </div>
                <div className="settings-action-row">
                  <SettingsButton variant="secondary" icon={FaUndo} onClick={resetKeybinds}>
                    {t('keybindReset')}
                  </SettingsButton>
                </div>
              </SettingsSection>
            </div>
          )}

          {activeCategory === 'appearance' && (
            <div className="settings-stack">
              <SettingsSection title={t('settingsTheme')} description={t('settingsThemeDesc')}>
                <div className="settings-theme-row">
                  {THEME_PRESETS.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={`settings-theme-card${appSettings.theme === theme.id ? ' selected' : ''}`}
                      onClick={() => updateSetting('theme', theme.id)}
                    >
                      <span className={`settings-theme-preview settings-theme-preview-${theme.id}`} />
                      <span>{t(theme.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsAccentColor')} description={t('settingsAccentDesc')}>
                <div className="settings-accent-row">
                  <button
                    type="button"
                    className={`settings-accent-dot settings-accent-dot-white${!appSettings.accentRgb && appSettings.accentNeutral ? ' selected' : ''}`}
                    onClick={() => selectAccentPreset(ACCENT_WHITE_PRESET)}
                    aria-label={t('accent_white')}
                    title={t('accent_white')}
                  />
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`settings-accent-dot${!appSettings.accentRgb && !appSettings.accentNeutral && appSettings.accentHue === preset.hue ? ' selected' : ''}`}
                      style={{ '--dot-hue': preset.hue }}
                      onClick={() => selectAccentPreset(preset)}
                      aria-label={t(`accent_${preset.id}`)}
                    />
                  ))}
                  <button
                    type="button"
                    className={`settings-accent-dot settings-accent-dot-rgb${appSettings.accentRgb ? ' selected' : ''}`}
                    onClick={() => selectAccentPreset(ACCENT_RGB_PRESET)}
                    aria-label={t('accent_rgb')}
                    title={t('accent_rgb')}
                  />
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsFont')} description={t('settingsFontDesc')}>
                <div className="settings-font-grid">
                  {FONT_PRESETS.map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      className={`settings-font-card${appSettings.fontId === font.id ? ' selected' : ''}`}
                      style={{ fontFamily: font.stack }}
                      onClick={() => updateSetting('fontId', font.id)}
                    >
                      <span className="settings-font-sample">Render</span>
                      <span className="settings-font-name">{t(font.labelKey)}</span>
                    </button>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsBackground')} description={t('settingsBackgroundDesc')}>
                <input
                  type="url"
                  className="settings-text-input"
                  value={backgroundInput}
                  onChange={(e) => setBackgroundInput(e.target.value)}
                  placeholder={t('settingsBackgroundPlaceholder')}
                />
                <div className="settings-action-row">
                  <SettingsButton
                    variant="primary"
                    icon={FaSave}
                    onClick={() => onBackgroundSave?.(backgroundInput.trim())}
                  >
                    {t('settingsBackgroundSave')}
                  </SettingsButton>
                  <SettingsButton
                    variant="secondary"
                    icon={FaTimes}
                    onClick={() => {
                      setBackgroundInput('');
                      onBackgroundSave?.('');
                    }}
                  >
                    {t('settingsBackgroundClear')}
                  </SettingsButton>
                  {onOpenWorkshop && (
                    <SettingsButton variant="secondary" icon={FaWrench} onClick={onOpenWorkshop}>
                      {t('openWorkshop')}
                    </SettingsButton>
                  )}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsUiRoundness')}>
                <div className="settings-list">
                  <SettingsSliderRow
                    label={t('settingsUiRoundness')}
                    valueLabel={`${appSettings.uiRoundness}px`}
                  >
                    <input
                      type="range"
                      min="8"
                      max="24"
                      value={appSettings.uiRoundness}
                      onChange={(e) => updateSetting('uiRoundness', Number(e.target.value))}
                    />
                  </SettingsSliderRow>
                  <SettingsSliderRow
                    label={t('settingsInterfaceScale')}
                    valueLabel={`${Math.round(appSettings.interfaceScale * 100)}%`}
                  >
                    <input
                      type="range"
                      min="88"
                      max="112"
                      value={Math.round(appSettings.interfaceScale * 100)}
                      onChange={(e) => updateSetting('interfaceScale', Number(e.target.value) / 100)}
                    />
                  </SettingsSliderRow>
                  <SettingsSliderRow
                    label={t('settingsGlassBlur')}
                    valueLabel={`${appSettings.glassBlur}px`}
                  >
                    <input
                      type="range"
                      min="8"
                      max="28"
                      value={appSettings.glassBlur}
                      onChange={(e) => updateSetting('glassBlur', Number(e.target.value))}
                    />
                  </SettingsSliderRow>
                  <SettingsSliderRow
                    label={t('settingsAccentStrength')}
                    description={t('settingsAccentStrengthDesc')}
                    valueLabel={`${Math.round((appSettings.accentStrength ?? 0.7) * 100)}%`}
                  >
                    <input
                      type="range"
                      min="35"
                      max="100"
                      value={Math.round((appSettings.accentStrength ?? 0.7) * 100)}
                      onChange={(e) => updateSetting('accentStrength', Number(e.target.value) / 100)}
                    />
                  </SettingsSliderRow>
                  <SettingsSliderRow
                    label={t('settingsPanelOpacity')}
                    description={t('settingsPanelOpacityDesc')}
                    valueLabel={`${Math.round((appSettings.panelOpacity ?? 0.88) * 100)}%`}
                  >
                    <input
                      type="range"
                      min="55"
                      max="100"
                      value={Math.round((appSettings.panelOpacity ?? 0.88) * 100)}
                      onChange={(e) => updateSetting('panelOpacity', Number(e.target.value) / 100)}
                    />
                  </SettingsSliderRow>
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsContentDensity')} description={t('settingsContentDensityDesc')}>
                <div className="settings-chip-row">
                  {[
                    { id: 'comfortable', label: t('settingsDensityComfortable') },
                    { id: 'compact', label: t('settingsDensityCompact') },
                    { id: 'dense', label: t('settingsDensityDense') },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`settings-chip${(appSettings.contentDensity || 'comfortable') === option.id ? ' selected' : ''}`}
                      onClick={() => updateSetting('contentDensity', option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsLayoutChrome')} description={t('settingsLayoutChromeDesc')}>
                <div className="settings-player-customize">
                  <div>
                    <span className="settings-field-label">{t('settingsLayoutStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'solid', label: t('settingsLayoutSolid') },
                        { id: 'floating', label: t('settingsLayoutFloating') },
                        { id: 'inset', label: t('settingsLayoutInset') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.layoutStyle || 'floating') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('layoutStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsTopBarStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'solid', label: t('settingsTopBarSolid') },
                        { id: 'transparent', label: t('settingsTopBarTransparent') },
                        { id: 'floating', label: t('settingsTopBarFloating') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.topBarStyle || 'floating') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('topBarStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsSidebarStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'panel', label: t('settingsSidebarPanel') },
                        { id: 'rail', label: t('settingsSidebarRail') },
                        { id: 'minimal', label: t('settingsSidebarMinimal') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.sidebarStyle || 'panel') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('sidebarStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsCardStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'flat', label: t('settingsCardFlat') },
                        { id: 'elevated', label: t('settingsCardElevated') },
                        { id: 'outline', label: t('settingsCardOutline') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.cardStyle || 'elevated') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('cardStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsHomeLayout')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'comfortable', label: t('settingsHomeComfortable') },
                        { id: 'magazine', label: t('settingsHomeMagazine') },
                        { id: 'compact', label: t('settingsHomeCompact') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.homeLayout || 'comfortable') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('homeLayout', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsMotionLevel')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'full', label: t('settingsMotionFull') },
                        { id: 'reduced', label: t('settingsMotionReduced') },
                        { id: 'off', label: t('settingsMotionOff') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.motionLevel || 'full') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('motionLevel', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="settings-list" style={{ marginTop: 12 }}>
                  <SettingsSliderRow
                    label={t('settingsCoverRadius')}
                    description={t('settingsCoverRadiusDesc')}
                    valueLabel={`${appSettings.coverRadius ?? 14}px`}
                  >
                    <input
                      type="range"
                      min="8"
                      max="28"
                      value={appSettings.coverRadius ?? 14}
                      onChange={(e) => updateSetting('coverRadius', Number(e.target.value))}
                    />
                  </SettingsSliderRow>
                </div>
              </SettingsSection>

              <SettingsSection>
                <div className="settings-list">
                  <SettingsToggleRow
                    label={t('settingsAnimations')}
                    description={t('settingsAnimationsDesc')}
                    checked={appSettings.animationsEnabled}
                    onChange={(e) => updateSetting('animationsEnabled', e.target.checked)}
                  />
                  <SettingsToggleRow
                    label={t('settingsShowAlbum')}
                    description={t('settingsShowAlbumDesc')}
                    checked={appSettings.showAlbumColumn}
                    onChange={(e) => updateSetting('showAlbumColumn', e.target.checked)}
                  />
                  <SettingsToggleRow
                    label={t('settingsCompactUi')}
                    description={t('settingsCompactUiDesc')}
                    checked={appSettings.compactUi}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      onAppSettingsChange({ ...appSettings, compactUi: checked, compactDock: checked });
                    }}
                  />
                  <SettingsToggleRow
                    label={t('settingsSidebarLabels')}
                    description={t('settingsSidebarLabelsDesc')}
                    checked={appSettings.sidebarLabels !== false}
                    onChange={(e) => updateSetting('sidebarLabels', e.target.checked)}
                  />
                  <SettingsToggleRow
                    label={t('settingsReduceTransparency')}
                    description={t('settingsReduceTransparencyDesc')}
                    checked={Boolean(appSettings.reduceTransparency)}
                    onChange={(e) => updateSetting('reduceTransparency', e.target.checked)}
                  />
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsPlayerLook')} description={t('settingsPlayerLookDesc')}>
                <div className="settings-player-customize">
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerBar')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'pill', label: t('settingsPlayerBarPill') },
                        { id: 'wide', label: t('settingsPlayerBarWide') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerBarStyle || 'pill') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerBarStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerPlay')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'solid', label: t('settingsPlayerPlaySolid') },
                        { id: 'accent', label: t('settingsPlayerPlayAccent') },
                        { id: 'soft', label: t('settingsPlayerPlaySoft') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerPlayStyle || 'solid') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerPlayStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerCover')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'none', label: t('settingsPlayerCoverNone') },
                        { id: 'lift', label: t('settingsPlayerCoverLift') },
                        { id: 'spin', label: t('settingsPlayerCoverSpin') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerCoverMotion || 'none') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerCoverMotion', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsProgressStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'line', label: t('settingsProgressLine') },
                        { id: 'bold', label: t('settingsProgressBold') },
                        { id: 'dot', label: t('settingsProgressDot') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.progressStyle || 'line') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('progressStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerCoverSize')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'sm', label: t('settingsPlayerCoverSizeSm') },
                        { id: 'md', label: t('settingsPlayerCoverSizeMd') },
                        { id: 'lg', label: t('settingsPlayerCoverSizeLg') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerCoverSize || 'md') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerCoverSize', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerCoverShape')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'rounded', label: t('settingsPlayerCoverShapeRounded') },
                        { id: 'square', label: t('settingsPlayerCoverShapeSquare') },
                        { id: 'circle', label: t('settingsPlayerCoverShapeCircle') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerCoverShape || 'rounded') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerCoverShape', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerAlign')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'left', label: t('settingsPlayerAlignLeft') },
                        { id: 'center', label: t('settingsPlayerAlignCenter') },
                        { id: 'spread', label: t('settingsPlayerAlignSpread') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerAlign || 'spread') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerAlign', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsPlayerHeight')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'compact', label: t('settingsPlayerHeightCompact') },
                        { id: 'normal', label: t('settingsPlayerHeightNormal') },
                        { id: 'tall', label: t('settingsPlayerHeightTall') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.playerHeight || 'normal') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('playerHeight', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="settings-field-label">{t('settingsTrackListStyle')}</span>
                    <div className="settings-chip-row">
                      {[
                        { id: 'comfortable', label: t('settingsTrackListComfortable') },
                        { id: 'compact', label: t('settingsTrackListCompact') },
                        { id: 'dense', label: t('settingsTrackListDense') },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`settings-chip${(appSettings.trackListStyle || 'comfortable') === option.id ? ' selected' : ''}`}
                          onClick={() => updateSetting('trackListStyle', option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="settings-list" style={{ marginTop: 12 }}>
                  <SettingsToggleRow
                    label={t('settingsShowPlayerLikes')}
                    description={t('settingsShowPlayerLikesDesc')}
                    checked={appSettings.showPlayerLikes !== false}
                    onChange={(e) => updateSetting('showPlayerLikes', e.target.checked)}
                  />
                </div>
              </SettingsSection>

              <SettingsSection title={t('settingsUiSounds')} description={t('settingsUiSoundsDesc')}>
                <div className="settings-list">
                  <SettingsToggleRow
                    label={t('settingsUiSounds')}
                    description={t('settingsUiSoundsDesc')}
                    checked={appSettings.uiSoundsEnabled}
                    onChange={(e) => updateSetting('uiSoundsEnabled', e.target.checked)}
                  />
                  <SettingsSliderRow
                    label={t('settingsUiSoundVolume')}
                    valueLabel={`${appSettings.uiSoundVolume}%`}
                  >
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={appSettings.uiSoundVolume}
                      onChange={(e) => updateSetting('uiSoundVolume', Number(e.target.value))}
                      disabled={!appSettings.uiSoundsEnabled}
                    />
                  </SettingsSliderRow>
                </div>
                <div className="settings-sound-style">
                  <span className="settings-field-label">{t('settingsUiSoundPack')}</span>
                  <div className="settings-chip-row">
                    {UI_SOUND_PACKS.map((pack) => (
                      <button
                        key={pack.id}
                        type="button"
                        className={`settings-chip${appSettings.uiSoundPack === pack.id ? ' selected' : ''}`}
                        disabled={!appSettings.uiSoundsEnabled}
                        onClick={() => {
                          const nextStyle = getDefaultUiSoundStyle(pack.id);
                          const nextSettings = {
                            ...appSettings,
                            uiSoundPack: pack.id,
                            uiSoundStyle: nextStyle,
                          };
                          setUiSoundConfig({
                            pack: pack.id,
                            style: nextStyle,
                            volume: nextSettings.uiSoundVolume / 100,
                            enabled: nextSettings.uiSoundsEnabled,
                          });
                          onAppSettingsChange(nextSettings);
                          playUiSound('click');
                        }}
                      >
                        {t(pack.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-sound-style">
                  <span className="settings-field-label">{t('settingsUiSoundStyle')}</span>
                  <div className="settings-chip-row">
                    {getUiSoundStyles(appSettings.uiSoundPack).map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        className={`settings-chip${appSettings.uiSoundStyle === style.id ? ' selected' : ''}`}
                        disabled={!appSettings.uiSoundsEnabled}
                        onClick={() => {
                          updateSetting('uiSoundStyle', style.id);
                          setUiSoundConfig({
                            pack: appSettings.uiSoundPack,
                            style: style.id,
                            volume: appSettings.uiSoundVolume / 100,
                            enabled: appSettings.uiSoundsEnabled,
                          });
                          playUiSound('click');
                        }}
                      >
                        {t(style.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
                <SettingsButton
                  variant="secondary"
                  icon={FaVolumeUp}
                  className="settings-sound-preview"
                  disabled={!appSettings.uiSoundsEnabled}
                  onClick={() => playUiSound('click')}
                >
                  {t('settingsUiSoundPreview')}
                </SettingsButton>
              </SettingsSection>
            </div>
          )}

          {activeCategory === 'workshop' && (
            <div className="settings-stack">
              <SettingsSection title={t('workshopTitle')} description={t('workshopDesc')}>
                {onOpenWorkshop && (
                  <SettingsButton variant="primary" icon={FaExternalLinkAlt} onClick={onOpenWorkshop}>
                    {t('openWorkshop')}
                  </SettingsButton>
                )}
              </SettingsSection>
            </div>
          )}

          {activeCategory === 'admin' && authUser?.isAdmin && (
            <div className="settings-admin-embed">
              <AdminPanel currentUserId={authUser?.id} />
            </div>
          )}

          {activeCategory === 'account' && (
            <div className="settings-stack">
              {authUser && (
                <SettingsSection title={t('settingsAccount')}>
                  <div className="settings-account-card">
                    <div className="settings-account-meta">
                      <strong>@{authUser.username}</strong>
                      <span>
                        {t('settingsLoggedInAs')}
                        {authUser.email ? ` · ${authUser.email}` : ''}
                      </span>
                    </div>
                    <SettingsButton variant="danger" icon={FaSignOutAlt} onClick={onLogout}>
                      {t('settingsLogout')}
                    </SettingsButton>
                  </div>
                </SettingsSection>
              )}

              <SettingsSection title={t('privacyTitle')} description={t('privacyDesc')}>
                <div className="settings-list">
                  <SettingsToggleRow
                    label={t('privacyHiddenAccount')}
                    description={t('privacyHiddenAccountDesc')}
                    checked={Boolean(privacy?.hiddenAccount)}
                    onChange={() => togglePrivacy('hiddenAccount')}
                  />
                  <SettingsToggleRow
                    label={t('privacyHideCreatedAt')}
                    checked={Boolean(privacy?.hideCreatedAt)}
                    onChange={() => togglePrivacy('hideCreatedAt')}
                  />
                  <SettingsToggleRow
                    label={t('privacyHidePlaylists')}
                    checked={Boolean(privacy?.hidePlaylists)}
                    onChange={() => togglePrivacy('hidePlaylists')}
                  />
                  <SettingsToggleRow
                    label={t('privacyHideAvatar')}
                    checked={Boolean(privacy?.hideAvatar)}
                    onChange={() => togglePrivacy('hideAvatar')}
                  />
                  <SettingsToggleRow
                    label={t('privacyHideBanner')}
                    checked={Boolean(privacy?.hideBanner)}
                    onChange={() => togglePrivacy('hideBanner')}
                  />
                  <SettingsToggleRow
                    label={t('privacyHideNowPlaying')}
                    description={t('privacyHideNowPlayingDesc')}
                    checked={Boolean(privacy?.hideNowPlaying)}
                    onChange={() => togglePrivacy('hideNowPlaying')}
                  />
                </div>
              </SettingsSection>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
