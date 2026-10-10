import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './AuthScreen.css';
import {
  FaUser,
  FaLock,
  FaEnvelope,
  FaIdBadge,
  FaShieldAlt,
  FaSync,
  FaEye,
  FaEyeSlash,
} from 'react-icons/fa';
import {
  fetchCaptcha,
  login as loginRequest,
  register as registerRequest,
  extractAuthError,
} from '../utils/auth';

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const clamped = Math.min(4, score);
  const labels = ['Слабый', 'Слабый', 'Средний', 'Хороший', 'Надёжный'];
  return { score: clamped, label: labels[clamped] };
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [captcha, setCaptcha] = useState({ token: '', image: '' });
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [login, setLoginValue] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const data = await fetchCaptcha();
      setCaptcha(data);
    } catch {
      setCaptcha({ token: '', image: '' });
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  const isLogin = mode === 'login';
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setError('');
    setErrorField(null);
    setCaptchaAnswer('');
    setShowPassword(false);
    loadCaptcha();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError('');
    setErrorField(null);

    try {
      let user;
      if (isLogin) {
        user = await loginRequest({
          login: login.trim(),
          password,
          captchaToken: captcha.token,
          captchaAnswer,
        });
      } else {
        user = await registerRequest({
          username: username.trim(),
          email: email.trim(),
          displayName: displayName.trim(),
          password,
          captchaToken: captcha.token,
          captchaAnswer,
        });
      }
      try {
        await onAuthenticated?.(user);
      } catch (bootError) {
        // Session already saved — enter app even if bootstrap hiccuped.
        console.warn('Post-auth bootstrap failed:', bootError);
      }
    } catch (err) {
      const info = extractAuthError(err);
      // Account may already exist after a partial register success.
      if (!isLogin && (info.status === 409 || info.status === 500)) {
        setError(`${info.message} Если аккаунт уже создан — войдите.`);
      } else {
        setError(info.message);
      }
      setErrorField(info.field);
      setCaptchaAnswer('');
      loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-bg" aria-hidden="true">
        <span className="auth-orb auth-orb--1" />
        <span className="auth-orb auth-orb--2" />
        <span className="auth-orb auth-orb--3" />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">RENDER</span>
          <p className="auth-tagline">
            {isLogin ? 'С возвращением. Войди, чтобы продолжить.' : 'Создай аккаунт и слушай своё.'}
          </p>
        </div>

        <div className="auth-tabs" role="tablist">
          <span className={`auth-tabs-slider ${isLogin ? 'left' : 'right'}`} aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={isLogin}
            className={`auth-tab ${isLogin ? 'is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isLogin}
            className={`auth-tab ${!isLogin ? 'is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isLogin ? (
            <label className="auth-field">
              <span>Логин или email</span>
              <div className="auth-input">
                <FaUser className="auth-input-icon" />
                <input
                  type="text"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLoginValue(e.target.value)}
                  placeholder="renderuser"
                  required
                />
              </div>
            </label>
          ) : (
            <>
              <label className={`auth-field ${errorField === 'username' ? 'has-error' : ''}`}>
                <span>Имя пользователя</span>
                <div className="auth-input">
                  <FaUser className="auth-input-icon" />
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="renderuser"
                    required
                  />
                </div>
              </label>
              <label className={`auth-field ${errorField === 'displayName' ? 'has-error' : ''}`}>
                <span>Отображаемое имя <em>(необязательно)</em></span>
                <div className="auth-input">
                  <FaIdBadge className="auth-input-icon" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Render User"
                  />
                </div>
              </label>
              <label className={`auth-field ${errorField === 'email' ? 'has-error' : ''}`}>
                <span>Email </span>
                <div className="auth-input">
                  <FaEnvelope className="auth-input-icon" />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </label>
            </>
          )}

          <label className={`auth-field ${errorField === 'password' ? 'has-error' : ''}`}>
            <span>Пароль</span>
            <div className="auth-input">
              <FaLock className="auth-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="auth-input-action"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
            {!isLogin && password && (
              <div className={`auth-strength strength-${strength.score}`}>
                <div className="auth-strength-bars">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={i < strength.score ? 'is-on' : ''} />
                  ))}
                </div>
                <span className="auth-strength-label">{strength.label}</span>
              </div>
            )}
          </label>

          <div className={`auth-captcha ${errorField === 'captcha' ? 'has-error' : ''}`}>
            <div className="auth-captcha-head">
              <span><FaShieldAlt /> Проверка «не робот»</span>
              <button
                type="button"
                className="auth-captcha-refresh"
                onClick={loadCaptcha}
                title="Обновить капчу"
                aria-label="Обновить капчу"
              >
                <FaSync className={captchaLoading ? 'is-spinning' : ''} />
              </button>
            </div>
            <div className="auth-captcha-body">
              <div className="auth-captcha-image">
                {captcha.image ? (
                  <img src={captcha.image} alt="Captcha" draggable="false" />
                ) : (
                  <div className="auth-captcha-placeholder">
                    {captchaLoading ? 'Загрузка…' : 'Капча недоступна'}
                  </div>
                )}
              </div>
              <input
                className="auth-captcha-input"
                type="text"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                placeholder="Символы с картинки"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck="false"
                required
              />
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? (
              <span className="auth-spinner" aria-hidden="true" />
            ) : isLogin ? (
              'Войти'
            ) : (
              'Создать аккаунт'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AuthScreen;
