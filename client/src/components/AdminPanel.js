import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './AdminPanel.css';
import {
  FaBan,
  FaTrash,
  FaCoins,
  FaUserShield,
  FaSearch,
  FaGift,
  FaTimes,
  FaUsers,
  FaBox,
  FaGavel,
  FaCheck,
  FaUser,
  FaTag,
} from 'react-icons/fa';
import { useLanguage } from '../context/LanguageContext';
import AvatarImage from './AvatarImage';
import { AdminPlaque } from './ProfileCosmetics';
import {
  fetchAdminUsers,
  fetchAdminUser,
  fetchAdminCatalog,
  banUser,
  unbanUser,
  deleteUser,
  adjustUserCoins,
  grantUserItem,
  revokeUserItem,
  grantAdmin,
  revokeAdmin,
  fetchPendingBadgeLabels,
  moderateBadgeLabel,
} from '../utils/admin';

function AdminButton({ variant = 'secondary', icon: Icon, className = '', children, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`admin-btn admin-btn--${variant}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {Icon ? <Icon className="admin-btn-icon" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function AdminSection({ icon: Icon, title, children, tone = 'default' }) {
  return (
    <section className={`admin-section admin-section--${tone}`}>
      <div className="admin-section-head">
        {Icon ? <Icon className="admin-section-icon" aria-hidden="true" /> : null}
        <h3>{title}</h3>
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

function AdminPanel({ currentUserId }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [coinAmount, setCoinAmount] = useState('');
  const [coinMode, setCoinMode] = useState('add');
  const [banReason, setBanReason] = useState('');
  const [grantItemId, setGrantItemId] = useState('');
  const [pendingBadgeLabels, setPendingBadgeLabels] = useState([]);
  const [badgeLabelsLoading, setBadgeLabelsLoading] = useState(false);

  const loadPendingBadgeLabels = useCallback(async () => {
    setBadgeLabelsLoading(true);
    try {
      const items = await fetchPendingBadgeLabels();
      setPendingBadgeLabels(items);
    } catch {
      setPendingBadgeLabels([]);
    } finally {
      setBadgeLabelsLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (search = '') => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchAdminUsers(search);
      setUsers(rows);
    } catch (err) {
      setError(err?.response?.data?.error || t('adminLoadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDetail = useCallback(async (userId) => {
    if (!userId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError('');
    try {
      const data = await fetchAdminUser(userId);
      setDetail(data);
      setUsers((prev) => prev.map((u) => (u.id === data.user.id ? { ...u, ...data.user } : u)));
    } catch (err) {
      setError(err?.response?.data?.error || t('adminLoadError'));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsers('');
    fetchAdminCatalog().then(setCatalog).catch(() => {});
    loadPendingBadgeLabels();
  }, [loadUsers, loadPendingBadgeLabels]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => setSuccess(''), 2400);
    return () => clearTimeout(timer);
  }, [success]);

  const runAction = async (action, successMessage = t('adminActionSuccess')) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(successMessage);
      await loadUsers(query);
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setError(err?.response?.data?.error || t('adminActionError'));
    } finally {
      setBusy(false);
    }
  };

  const selected = detail?.user || users.find((u) => u.id === selectedId) || null;
  const isSelf = selected && Number(selected.id) === Number(currentUserId);

  const stats = useMemo(() => ({
    total: users.length,
    banned: users.filter((user) => user.isBanned).length,
    admins: users.filter((user) => user.isAdmin).length,
  }), [users]);

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-header-text">
            <h1>{t('adminTitle')}</h1>
            <p>{t('adminDesc')}</p>
          </div>
          <div className="admin-stat-pills" aria-label={t('adminUsersTotal')}>
            <span className="admin-stat-pill">
              <FaUsers aria-hidden="true" />
              <em>{t('adminUsersTotal')}</em>
              <strong>{stats.total}</strong>
            </span>
            <span className="admin-stat-pill">
              <FaBan aria-hidden="true" />
              <em>{t('adminBanned')}</em>
              <strong>{stats.banned}</strong>
            </span>
            <span className="admin-stat-pill">
              <FaUserShield aria-hidden="true" />
              <em>{t('adminAdmins')}</em>
              <strong>{stats.admins}</strong>
            </span>
          </div>
        </header>

        {error && <p className="admin-alert admin-alert--error" role="alert">{error}</p>}
        {success && (
          <p className="admin-alert admin-alert--success" role="status">
            <FaCheck aria-hidden="true" /> {success}
          </p>
        )}

        <AdminSection icon={FaTag} title={t('adminBadgeLabelsTitle')}>
          {badgeLabelsLoading && <p className="admin-section-empty">{t('loadingTracks')}</p>}
          {!badgeLabelsLoading && pendingBadgeLabels.length === 0 && (
            <p className="admin-section-empty">{t('adminBadgeLabelsEmpty')}</p>
          )}
          {!badgeLabelsLoading && pendingBadgeLabels.length > 0 && (
            <div className="admin-badge-label-list">
              {pendingBadgeLabels.map((entry) => (
                <div key={entry.instanceId} className="admin-badge-label-row">
                  <div className="admin-badge-label-copy">
                    <strong>{entry.customLabel}</strong>
                    <span>
                      {entry.displayName || entry.username} (@{entry.username}) · {entry.item?.name}
                    </span>
                  </div>
                  <div className="admin-action-row">
                    <AdminButton
                      variant="primary"
                      icon={FaCheck}
                      disabled={busy}
                      onClick={() => runAction(async () => {
                        await moderateBadgeLabel(entry.instanceId, 'approve');
                        await loadPendingBadgeLabels();
                      }, t('adminBadgeLabelApproved'))}
                    >
                      {t('adminBadgeLabelApprove')}
                    </AdminButton>
                    <AdminButton
                      variant="danger"
                      icon={FaTimes}
                      disabled={busy}
                      onClick={() => runAction(async () => {
                        await moderateBadgeLabel(entry.instanceId, 'reject');
                        await loadPendingBadgeLabels();
                      }, t('adminBadgeLabelRejected'))}
                    >
                      {t('adminBadgeLabelReject')}
                    </AdminButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminSection>

        <div className="admin-layout">
          <aside className="admin-sidebar">
            <form
              className="admin-search-row"
              onSubmit={(e) => {
                e.preventDefault();
                loadUsers(query);
              }}
            >
              <div className="admin-search-field">
                <FaSearch className="admin-search-icon" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('adminSearchPlaceholder')}
                  aria-label={t('adminSearch')}
                />
              </div>
              <AdminButton type="submit" variant="secondary" icon={FaSearch} disabled={loading}>
                {t('adminSearch')}
              </AdminButton>
            </form>

            <div className="admin-sidebar-label">
              <FaUsers aria-hidden="true" />
              <span>{t('adminUsersTotal')}</span>
            </div>

            <div className="admin-user-list">
              {loading && <p className="admin-empty">{t('loadingTracks')}</p>}
              {!loading && users.length === 0 && <p className="admin-empty">{t('adminNoUsers')}</p>}
              {!loading && users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`admin-user-row${selectedId === user.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(user.id)}
                >
                  <AvatarImage
                    url={user.avatarUrl}
                    fallback={user.username?.[0] || '?'}
                    alt=""
                    className="admin-user-row-avatar"
                  />
                  <div className="admin-user-row-copy">
                    <strong>@{user.username}</strong>
                    <span>ID {user.id} · {user.renderCoins ?? 0} RC</span>
                  </div>
                  <div className="admin-user-row-tags">
                    {user.isAdmin && <span className="admin-tag admin-tag--admin">ADMIN</span>}
                    {user.isBanned && <span className="admin-tag admin-tag--banned">{t('adminBanned')}</span>}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="admin-main">
            {!selected && (
              <div className="admin-placeholder">
                <FaUser aria-hidden="true" />
                <p>{t('adminSelectUser')}</p>
              </div>
            )}

            {selected && detailLoading && (
              <div className="admin-placeholder">
                <p>{t('loadingTracks')}</p>
              </div>
            )}

            {selected && !detailLoading && (
              <>
                <section className="admin-detail-head">
                  <AvatarImage
                    url={selected.avatarUrl}
                    fallback={selected.username?.[0] || '?'}
                    alt=""
                    className="admin-detail-avatar"
                  />
                  <div className="admin-detail-copy">
                    <div className="admin-detail-title">
                      <h2>{selected.displayName || selected.username}</h2>
                      <AdminPlaque isAdmin={selected.isAdmin} />
                    </div>
                    <p>
                      @{selected.username} · ID {selected.id}
                      {selected.email ? ` · ${selected.email}` : ''}
                    </p>
                    <div className="admin-detail-badges">
                      <span className={`admin-status-pill${selected.isBanned ? ' banned' : ''}`}>
                        {selected.isBanned ? t('adminBanned') : t('adminActive')}
                      </span>
                      <span className="admin-status-pill coins">
                        <FaCoins aria-hidden="true" /> {selected.renderCoins ?? 0} RC
                      </span>
                    </div>
                    {selected.isBanned && selected.banReason && (
                      <p className="admin-ban-reason">{t('adminBanReason')}: {selected.banReason}</p>
                    )}
                  </div>
                </section>

                <div className="admin-sections">
                  <AdminSection icon={FaGavel} title={t('adminSectionModeration')} tone="moderation">
                    {!selected.isBanned ? (
                      <div className="admin-form-row">
                        <input
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                          placeholder={t('adminBanReasonPlaceholder')}
                        />
                        <AdminButton
                          variant="danger"
                          icon={FaBan}
                          disabled={busy || isSelf}
                          onClick={() => runAction(async () => {
                            await banUser(selected.id, banReason);
                            setBanReason('');
                          })}
                        >
                          {t('adminBan')}
                        </AdminButton>
                      </div>
                    ) : (
                      <AdminButton
                        variant="secondary"
                        icon={FaCheck}
                        disabled={busy}
                        onClick={() => runAction(() => unbanUser(selected.id))}
                      >
                        {t('adminUnban')}
                      </AdminButton>
                    )}
                  </AdminSection>

                  <AdminSection icon={FaCoins} title={t('adminSectionEconomy')}>
                    <div className="admin-form-grid">
                      <select value={coinMode} onChange={(e) => setCoinMode(e.target.value)}>
                        <option value="add">{t('adminCoinsAdd')}</option>
                        <option value="take">{t('adminCoinsTake')}</option>
                        <option value="set">{t('adminCoinsSet')}</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        placeholder={t('adminCoinsAmount')}
                        value={coinAmount}
                        onChange={(e) => setCoinAmount(e.target.value)}
                      />
                      <AdminButton
                        variant="primary"
                        icon={FaCoins}
                        disabled={busy || !coinAmount}
                        onClick={() => runAction(async () => {
                          await adjustUserCoins(selected.id, Number(coinAmount), coinMode);
                          setCoinAmount('');
                        })}
                      >
                        {t('adminApplyCoins')}
                      </AdminButton>
                    </div>
                  </AdminSection>

                  <AdminSection icon={FaBox} title={t('adminSectionItems')}>
                    <div className="admin-form-row">
                      <select value={grantItemId} onChange={(e) => setGrantItemId(e.target.value)}>
                        <option value="">{t('adminGrantItem')}</option>
                        {catalog.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      <AdminButton
                        variant="secondary"
                        icon={FaGift}
                        disabled={busy || !grantItemId}
                        onClick={() => runAction(async () => {
                          await grantUserItem(selected.id, Number(grantItemId));
                          setGrantItemId('');
                        })}
                      >
                        {t('adminGrant')}
                      </AdminButton>
                    </div>

                    {detail?.items?.length > 0 ? (
                      <div className="admin-item-list">
                        {detail.items.map((entry) => (
                          <div key={entry.id} className="admin-item-row">
                            <span>{entry.item?.name} · #{entry.id}</span>
                            <AdminButton
                              variant="ghost-danger"
                              icon={FaTimes}
                              disabled={busy}
                              onClick={() => runAction(() => revokeUserItem(selected.id, entry.id))}
                            >
                              {t('adminRevokeItem')}
                            </AdminButton>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="admin-section-empty">{t('adminInventory')}: —</p>
                    )}
                  </AdminSection>

                  <AdminSection icon={FaUserShield} title={t('adminSectionAccess')} tone="roles">
                    <div className="admin-action-row">
                      {selected.isAdmin ? (
                        <AdminButton
                          variant="danger"
                          icon={FaUserShield}
                          disabled={busy || isSelf}
                          onClick={() => runAction(() => revokeAdmin(selected.id))}
                        >
                          {t('adminRevokeAdmin')}
                        </AdminButton>
                      ) : (
                        <AdminButton
                          variant="primary"
                          icon={FaUserShield}
                          disabled={busy}
                          onClick={() => runAction(() => grantAdmin(selected.id))}
                        >
                          {t('adminGrantAdmin')}
                        </AdminButton>
                      )}
                      <AdminButton
                        variant="danger"
                        icon={FaTrash}
                        disabled={busy || isSelf}
                        onClick={() => {
                          if (!window.confirm(t('adminDeleteConfirm'))) return;
                          runAction(async () => {
                            await deleteUser(selected.id);
                            setSelectedId(null);
                            setDetail(null);
                          });
                        }}
                      >
                        {t('adminDelete')}
                      </AdminButton>
                    </div>
                  </AdminSection>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
