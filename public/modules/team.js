import { $, $$, escapeHtml, formatDate, showToast } from './dom.js';
import { api } from './api.js';
import { currentMembership, hasPermission, state } from './state.js';
import { applySettingsPageFromLocation } from './settings.js';

const ROLE_LABELS = Object.freeze({
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  reviewer: 'Reviewer',
  publisher: 'Publisher',
  viewer: 'Viewer',
});

const ACTION_LABELS = Object.freeze({
  'invitation.created': '建立邀請',
  'invitation.revoked': '撤銷邀請',
  'membership.role_changed': '變更角色',
  'membership.revoked': '移除成員',
  'user.suspended': '停權使用者',
  'user.reactivated': '恢復使用者',
  'client.created': '建立品牌',
  'client.updated': '更新品牌',
  'client.workflow_updated': '更新審核流程',
  'platform_account.updated': '更新平台帳號',
  'post.created': '建立內容',
  'post.updated': '更新內容',
  'post.archived': '封存內容',
  'post.restored': '恢復內容',
  'post.approved': '核准內容',
  'post.review_submitted': '送出審核',
  'post.changes_requested': '退回修改',
  'schedule.created': '建立排程',
  'schedule.updated': '調整排程',
  'schedule.deleted': '取消排程',
  'publish.executed': '執行發布',
  'ai.generated': 'AI 產文',
  'ai.rewritten': 'AI 改寫',
  'system.settings_updated': '更新 Gemini／全站設定',
  'system.gemini_tested': '測試 Gemini 連線',
  'system.facebook_tested': '測試 Facebook 連線',
  'system.secrets_rotated': '輪替主密鑰',
  'system.backup': '建立備份',
  'system.restore': '還原備份',
  'security.login_succeeded': '登入成功',
  'security.login_failed': '登入失敗',
  'security.logout': '登出',
  'security.reauth_succeeded': '二次驗證成功',
  'security.reauth_failed': '二次驗證失敗',
  'security.permission_denied': '權限被拒',
});

const teamState = {
  members: [],
  invitations: [],
  events: [],
  activeSection: 'members',
};

function actorCanAssignOwner() {
  return state.actor?.legacy || state.actor?.systemRole === 'owner' || currentMembership()?.role === 'owner';
}

function canManageTeam() {
  return hasPermission('member.manage');
}

function canViewAudit() {
  return hasPermission('audit.view');
}

export function applyPermissionUi() {
  const canCreate = hasPermission('content.create');
  $$('[data-view-target="create"]').forEach((element) => element.classList.toggle('permission-hidden', !canCreate));
  $('#newTemplateButton')?.classList.toggle('permission-hidden', !hasPermission('template.manage'));
  $('#newCampaignButton')?.classList.toggle('permission-hidden', !hasPermission('campaign.manage'));
  $('#teamNavItem')?.classList.toggle('permission-hidden', !(canManageTeam() || canViewAudit()));
  $('#settingsNavItem')?.classList.toggle('permission-hidden', !(hasPermission('account.manage') || hasPermission('system.manage')));
  $('#teamPanel')?.classList.toggle('permission-hidden', !(canManageTeam() || canViewAudit()));
  $('#settingsForm')?.classList.toggle('permission-hidden', !(hasPermission('account.manage') || hasPermission('system.manage')));
  $$('[data-required-permission]').forEach((element) => {
    element.classList.toggle('permission-hidden', !hasPermission(element.dataset.requiredPermission));
  });
  $$('[data-required-any]').forEach((element) => {
    const permissions = String(element.dataset.requiredAny || '').split(',').map((item) => item.trim()).filter(Boolean);
    element.classList.toggle('permission-hidden', !permissions.some(hasPermission));
  });
  applySettingsPageFromLocation();
}

function roleOptions(selected) {
  return Object.entries(ROLE_LABELS).map(([value, label]) => (
    `<option value="${value}"${value === selected ? ' selected' : ''}${value === 'owner' && !actorCanAssignOwner() ? ' disabled' : ''}>${label}</option>`
  )).join('');
}

function renderMembers() {
  const list = $('#teamMemberList');
  if (!list) return;
  if (!canManageTeam()) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🔒</span><p>你沒有管理成員的權限。</p></div>';
    return;
  }
  if (!state.currentClientId) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🏷️</span><p>請先建立或選擇品牌，再管理團隊。</p></div>';
    return;
  }
  if (!teamState.members.length) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">♙</span><p>目前品牌尚無成員。</p></div>';
    return;
  }
  const canSuspend = hasPermission('system.manage');
  list.innerHTML = teamState.members.map((member) => {
    const user = member.user || {};
    const label = user.displayName || user.email || member.userId;
    const suspended = user.status === 'suspended';
    const isSelf = user.uid === state.actor?.uid;
    return `<article class="team-member-card" data-user-id="${escapeHtml(member.userId)}">
      <span class="team-member-avatar" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase() || 'U')}</span>
      <div class="team-member-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(user.email || member.userId)}</small><span class="team-status" data-status="${suspended ? 'suspended' : 'active'}">${suspended ? '已停權' : '使用中'}</span></div>
      <div class="team-member-controls">
        <div class="field compact-field"><label class="field-label" for="role-${escapeHtml(member.userId)}">角色</label><select id="role-${escapeHtml(member.userId)}" data-member-role="${escapeHtml(member.userId)}">${roleOptions(member.role)}</select></div>
        <button class="btn-text team-remove-button" type="button" data-remove-member="${escapeHtml(member.userId)}"${isSelf ? ' disabled' : ''}>移除</button>
        ${canSuspend && !isSelf ? `<button class="btn-text team-suspend-button" type="button" data-user-status="${escapeHtml(member.userId)}" data-next-status="${suspended ? 'active' : 'suspended'}">${suspended ? '恢復' : '停權'}</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

function invitationStatusLabel(status) {
  return { pending: '待接受', accepted: '已接受', expired: '已過期', revoked: '已撤銷' }[status] || status;
}

function renderInvitations() {
  const list = $('#teamInvitationList');
  if (!list) return;
  if (!canManageTeam()) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🔒</span><p>你沒有查看邀請的權限。</p></div>';
    return;
  }
  if (!state.currentClientId) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🏷️</span><p>請先建立或選擇品牌，再查看邀請。</p></div>';
    return;
  }
  if (!teamState.invitations.length) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">✉</span><p>目前沒有邀請紀錄。</p></div>';
    return;
  }
  list.innerHTML = teamState.invitations.map((invitation) => {
    const grants = (invitation.grants || []).map((grant) => ROLE_LABELS[grant.role] || grant.role).join('、');
    return `<article class="team-invitation-card"><div><strong>${escapeHtml(invitation.emailNormalized)}</strong><p>${escapeHtml(grants)} · ${escapeHtml(invitationStatusLabel(invitation.status))}</p><small>建立於 ${escapeHtml(formatDate(invitation.createdAt))}${invitation.expiresAt ? ` · 到期 ${escapeHtml(formatDate(invitation.expiresAt))}` : ''}</small></div>${invitation.status === 'pending' ? `<button class="btn-text" type="button" data-revoke-invitation="${escapeHtml(invitation.id)}">撤銷</button>` : ''}</article>`;
  }).join('');
}

function auditLabel(action) {
  return ACTION_LABELS[action] || action.replaceAll('.', ' · ');
}

function renderAudit() {
  const list = $('#auditEventList');
  if (!list) return;
  if (!canViewAudit()) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🔒</span><p>你沒有查看操作紀錄的權限。</p></div>';
    return;
  }
  if (!state.currentClientId) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">🏷️</span><p>請先建立或選擇品牌，再查看操作紀錄。</p></div>';
    return;
  }
  const query = String($('#auditSearch')?.value || '').trim().toLowerCase();
  const events = teamState.events.filter((event) => !query || [
    event.action, event.actorEmail, event.actorId, event.resourceType, event.resourceId, auditLabel(event.action),
  ].some((value) => String(value || '').toLowerCase().includes(query)));
  if (!events.length) {
    list.innerHTML = '<div class="empty-state module-empty"><span class="empty-icon">◷</span><p>沒有符合條件的操作紀錄。</p></div>';
    return;
  }
  list.innerHTML = events.map((event) => `<article class="audit-event-card"><span class="audit-event-mark" aria-hidden="true">◷</span><div><strong>${escapeHtml(auditLabel(event.action))}</strong><p>${escapeHtml(event.actorEmail || event.actorId)}${event.clientId ? '' : ' · 全站'}${event.resourceType ? ` · ${escapeHtml(event.resourceType)}` : ''}${event.resourceId ? ` #${escapeHtml(event.resourceId)}` : ''}</p><small>${escapeHtml(formatDate(event.createdAt))}</small></div></article>`).join('');
}

function renderSummary() {
  const summary = $('#teamSummary');
  if (!summary) return;
  const activeMembers = teamState.members.filter((member) => member.user?.status !== 'suspended').length;
  const pendingInvitations = teamState.invitations.filter((invitation) => invitation.status === 'pending').length;
  const owners = teamState.members.filter((member) => member.role === 'owner' && member.user?.status !== 'suspended').length;
  summary.innerHTML = [
    ['使用中成員', activeMembers], ['待接受邀請', pendingInvitations], ['Owner', owners], ['近期操作', teamState.events.length],
  ].map(([label, value]) => `<div class="module-summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderSections() {
  const available = {
    members: canManageTeam(),
    invitations: canManageTeam(),
    audit: canViewAudit(),
  };
  if (!available[teamState.activeSection]) teamState.activeSection = Object.keys(available).find((key) => available[key]) || 'members';
  $$('[data-team-section]').forEach((button) => {
    const allowed = available[button.dataset.teamSection];
    const active = allowed && button.dataset.teamSection === teamState.activeSection;
    button.classList.toggle('permission-hidden', !allowed);
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-team-section-panel]').forEach((panel) => {
    panel.classList.toggle('is-hidden', panel.dataset.teamSectionPanel !== teamState.activeSection);
  });
  $('#teamInviteCard')?.classList.toggle('permission-hidden', !canManageTeam() || !state.currentClientId);
  const workflowCard = $('#workflowSettingsCard');
  const workflowToggle = $('#approvalRequiredToggle');
  workflowCard?.classList.toggle('permission-hidden', !canManageTeam() || !state.currentClientId);
  if (workflowToggle) workflowToggle.checked = Boolean(state.clients.find((client) => client.id === state.currentClientId)?.approvalRequired);
}

export async function loadTeamManagement() {
  applyPermissionUi();
  const clientId = state.currentClientId;
  if (!clientId || !(canManageTeam() || canViewAudit())) {
    teamState.members = [];
    teamState.invitations = [];
    teamState.events = [];
    renderMembers();
    renderInvitations();
    renderAudit();
    renderSummary();
    renderSections();
    return;
  }
  const tasks = [];
  if (canManageTeam()) {
    tasks.push(api(`/api/clients/${encodeURIComponent(clientId)}/members`).then((data) => { teamState.members = data.members || []; }));
    tasks.push(api(`/api/invitations?clientId=${encodeURIComponent(clientId)}`).then((data) => { teamState.invitations = data.invitations || []; }));
  } else {
    teamState.members = [];
    teamState.invitations = [];
  }
  if (canViewAudit()) {
    tasks.push(api(`/api/audit-events?clientId=${encodeURIComponent(clientId)}&limit=50`).then((data) => { teamState.events = data.events || []; }));
  } else {
    teamState.events = [];
  }
  try {
    await Promise.all(tasks);
  } catch (error) {
    showToast(`團隊資料載入失敗：${error.message}`, 'error');
  }
  renderMembers();
  renderInvitations();
  renderAudit();
  renderSummary();
  renderSections();
}

async function createInvitation() {
  const email = $('#teamInviteEmail')?.value?.trim();
  const role = $('#teamInviteRole')?.value || 'editor';
  if (!email || !state.currentClientId) return showToast('請輸入受邀 Email 並選擇品牌。', 'error');
  const button = $('#createInvitationButton');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, grants: [{ clientId: state.currentClientId, role }] }),
    });
    $('#invitationLink').value = result.invitationUrl;
    $('#invitationLinkResult')?.classList.remove('is-hidden');
    $('#teamInviteStatus').textContent = '邀請已建立，請立即複製連結。';
    $('#teamInviteEmail').value = '';
    showToast('邀請已建立', 'success');
    await loadTeamManagement();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export function initTeamListeners() {
  $('#teamNavItem')?.addEventListener('click', () => loadTeamManagement());
  $('#refreshTeamButton')?.addEventListener('click', () => loadTeamManagement());
  $('#createInvitationButton')?.addEventListener('click', createInvitation);
  $('#copyInvitationLink')?.addEventListener('click', async () => {
    const link = $('#invitationLink')?.value || '';
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('邀請連結已複製', 'success');
    } catch {
      $('#invitationLink')?.select();
      showToast('請按 Ctrl+C 複製邀請連結', 'info');
    }
  });
  $('#teamSectionTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-team-section]');
    if (!button) return;
    teamState.activeSection = button.dataset.teamSection;
    renderSections();
  });
  $('#auditSearch')?.addEventListener('input', renderAudit);
  $('#teamPanel')?.addEventListener('change', async (event) => {
    const workflowToggle = event.target.closest('#approvalRequiredToggle');
    if (workflowToggle) {
      try {
        const updated = await api('/api/clients/' + encodeURIComponent(state.currentClientId) + '/workflow', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalRequired: workflowToggle.checked }),
        });
        const client = state.clients.find((item) => item.id === state.currentClientId);
        if (client) client.approvalRequired = Boolean(updated.approvalRequired);
        showToast(updated.approvalRequired ? '已啟用發布前審核。' : '已關閉發布前審核。', 'success');
      } catch (error) {
        workflowToggle.checked = !workflowToggle.checked;
        showToast(error.message || '流程設定更新失敗。', 'error');
      }
      return;
    }
    const select = event.target.closest('[data-member-role]');
    if (!select) return;
    try {
      await api(`/api/clients/${encodeURIComponent(state.currentClientId)}/members/${encodeURIComponent(select.dataset.memberRole)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: select.value }),
      });
      showToast('成員角色已更新', 'success');
      await loadTeamManagement();
    } catch (error) {
      showToast(error.message, 'error');
      await loadTeamManagement();
    }
  });
  $('#teamPanel')?.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-remove-member]');
    const statusButton = event.target.closest('[data-user-status]');
    const revokeButton = event.target.closest('[data-revoke-invitation]');
    try {
      if (removeButton) {
        if (!window.confirm('確定要將這位成員移出目前品牌嗎？')) return;
        await api(`/api/clients/${encodeURIComponent(state.currentClientId)}/members/${encodeURIComponent(removeButton.dataset.removeMember)}`, { method: 'DELETE' });
        showToast('成員已移除', 'success');
      } else if (statusButton) {
        const nextStatus = statusButton.dataset.nextStatus;
        if (nextStatus === 'suspended' && !window.confirm('停權後，這位使用者會失去所有品牌的登入權限。確定繼續嗎？')) return;
        await api(`/api/users/${encodeURIComponent(statusButton.dataset.userStatus)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }),
        });
        showToast(nextStatus === 'suspended' ? '使用者已停權' : '使用者已恢復', 'success');
      } else if (revokeButton) {
        await api(`/api/invitations/${encodeURIComponent(revokeButton.dataset.revokeInvitation)}/revoke`, { method: 'POST' });
        showToast('邀請已撤銷', 'success');
      } else {
        return;
      }
      await loadTeamManagement();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}
