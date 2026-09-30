/**
 * chatrooms.js - 多聊天室（单聊 / 群聊）
 *
 * 数据隔离本来就有：每个会话（SESSION_ID）各自一份 settings / 消息 / 字卡回复 / 表情 / 头像。
 * 这个文件只负责：
 *   1. 把"会话管理"列表升级成聊天室列表（头像、名称、单聊/群聊标记、最后一句）
 *   2. 新建聊天室时可选单聊 / 群聊
 *   3. 把最后一条消息等摘要缓存到 sessionList，列表不用去读整份聊天记录
 * 样式全部沿用现有 class（session-item / modal-btn 等），不新增 CSS 文件。
 */
(function () {
    'use strict';

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function isGroupRoom(session) {
        if (session.id === SESSION_ID) {
            return !!(settings && settings.groupChat && settings.groupChat.enabled);
        }
        return session.type === 'group';
    }

    function messagePreview(m) {
        if (!m) return '';
        if (m.text) return String(m.text).replace(/\s+/g, ' ').slice(0, 30);
        if (m.image) return '[图片]';
        if (m.voice) return '[语音]';
        if (m.sticker) return '[表情]';
        return '';
    }

    // ── 当前会话的摘要写回 sessionList（由 core.js 的 saveData 调用，只有内容变了才写）──
    window._updateRoomMeta = function () {
        if (!SESSION_ID || !Array.isArray(sessionList)) return;
        var s = sessionList.find(function (x) { return x.id === SESSION_ID; });
        if (!s) return;
        var last = null;
        for (var i = messages.length - 1; i >= 0; i--) {
            if (messagePreview(messages[i])) { last = messages[i]; break; }
        }
        var type = (settings && settings.groupChat && settings.groupChat.enabled) ? 'group' : 'single';
        var text = messagePreview(last);
        var time = last ? new Date(last.timestamp).getTime() : 0;
        if (s.type === type && s.lastText === text && s.lastTime === time) return;
        s.type = type;
        s.lastText = text;
        s.lastTime = time;
        localforage.setItem(APP_PREFIX + 'sessionList', sessionList).catch(function () {});
    };

    function fmtTime(ts) {
        if (!ts) return '';
        var d = new Date(ts), now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        }
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    // ── 聊天室列表（覆盖 games.js 里的 renderSessionList，DOM 结构保持兼容：
    //    .session-item[data-id] / .session-info / .rename / .delete，listeners.js 的点击处理不用改）──
    window.renderSessionList = function () {
        var box = DOMElements.sessionModal.list;
        if (!sessionList.length) {
            box.innerHTML = '<div class="stats-empty" style="padding: 20px 0;"><p>还没有聊天室</p></div>';
            return;
        }
        box.innerHTML = sessionList.map(function (s) {
            var group = isGroupRoom(s);
            var cur = s.id === SESSION_ID;
            var preview = s.lastText || '还没有消息';
            var badge = group
                ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;margin-left:6px;background:rgba(var(--accent-color-rgb),0.15);color:var(--accent-color);font-weight:600;">群聊</span>'
                : '';
            var avatar = group
                ? '<i class="fas fa-users" style="font-size:16px;color:var(--accent-color);"></i>'
                : '<i class="fas fa-user" style="font-size:16px;color:var(--accent-color);"></i>';
            return '<div class="session-item ' + (cur ? 'active' : '') + '" data-id="' + esc(s.id) + '">'
                + '<div class="room-avatar" data-room-avatar="' + esc(s.id) + '" style="width:40px;height:40px;border-radius:50%;flex-shrink:0;margin-right:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(var(--accent-color-rgb),0.12);">' + avatar + '</div>'
                + '<div class="session-info" style="min-width:0;">'
                + '<div class="session-name" style="display:flex;align-items:center;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.name) + '</span>' + badge + '</div>'
                + '<div class="session-meta" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
                + (s.lastTime ? esc(fmtTime(s.lastTime)) + ' · ' : '') + esc(preview) + '</div>'
                + '</div>'
                + '<div class="session-actions">'
                + '<button class="session-action-btn rename" title="重命名"><i class="fas fa-pen"></i></button>'
                + '<button class="session-action-btn delete" title="删除"><i class="fas fa-trash"></i></button>'
                + '</div></div>';
        }).join('');

        // 单聊头像：异步补上（当前会话读内存缓存，其余读各自的存档）
        sessionList.forEach(function (s) {
            if (isGroupRoom(s)) return;
            var slot = box.querySelector('[data-room-avatar="' + s.id + '"]');
            if (!slot) return;
            var apply = function (src) {
                if (src && typeof src === 'string' && src.indexOf('oss://') !== 0) {
                    slot.innerHTML = '<img src="' + esc(src) + '" style="width:100%;height:100%;object-fit:cover;">';
                }
            };
            if (s.id === SESSION_ID) apply(window._avatarCache && window._avatarCache.partner);
            else localforage.getItem(APP_PREFIX + s.id + '_partnerAvatar').then(apply).catch(function () {});
        });
    };

    // ── 新建聊天室 ──
    var _roomType = 'single';

    function buildDialog() {
        if (document.getElementById('new-room-modal')) return;
        var wrap = document.createElement('div');
        wrap.className = 'modal';
        wrap.id = 'new-room-modal';
        wrap.style.zIndex = '3100';
        wrap.innerHTML =
            '<div class="modal-content">'
            + '<div class="modal-title"><i class="fas fa-plus"></i><span>新建聊天室</span></div>'
            + '<input type="text" class="modal-input" id="new-room-name" placeholder="聊天室名称" maxlength="20">'
            + '<div style="display:flex;gap:8px;margin:4px 0 8px;">'
            + '<button class="modal-btn modal-btn-primary" id="new-room-type-single" style="flex:1;"><i class="fas fa-user"></i> 单聊</button>'
            + '<button class="modal-btn modal-btn-secondary" id="new-room-type-group" style="flex:1;"><i class="fas fa-users"></i> 群聊</button>'
            + '</div>'
            + '<div id="new-room-hint" style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:6px;"></div>'
            + '<div class="modal-buttons">'
            + '<button class="modal-btn modal-btn-secondary" id="new-room-cancel">取消</button>'
            + '<button class="modal-btn modal-btn-primary" id="new-room-confirm">创建并进入</button>'
            + '</div></div>';
        document.body.appendChild(wrap);

        document.getElementById('new-room-type-single').addEventListener('click', function () { setType('single'); });
        document.getElementById('new-room-type-group').addEventListener('click', function () { setType('group'); });
        document.getElementById('new-room-cancel').addEventListener('click', function () { hideModal(wrap); });
        document.getElementById('new-room-confirm').addEventListener('click', function () {
            var name = document.getElementById('new-room-name').value.trim();
            createRoom(name, _roomType);
        });
    }

    function setType(t) {
        _roomType = t;
        var a = document.getElementById('new-room-type-single');
        var b = document.getElementById('new-room-type-group');
        a.className = 'modal-btn ' + (t === 'single' ? 'modal-btn-primary' : 'modal-btn-secondary');
        b.className = 'modal-btn ' + (t === 'group' ? 'modal-btn-primary' : 'modal-btn-secondary');
        document.getElementById('new-room-hint').textContent = t === 'single'
            ? '独立的梦角：头像、昵称、字卡回复、表情、设置都和其他聊天室分开。'
            : '群聊：收到的消息会由群成员轮流发出。进入后可以添加成员（名字 + 头像）。';
    }

    window.openNewRoomDialog = function () {
        buildDialog();
        document.getElementById('new-room-name').value = '';
        setType('single');
        showModal(document.getElementById('new-room-modal'), document.getElementById('new-room-name'));
    };

    async function createRoom(name, type) {
        var id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        var defaultName = (type === 'group' ? '群聊 ' : '聊天室 ') + (sessionList.length + 1);
        sessionList.push({ id: id, name: name || defaultName, createdAt: Date.now(), type: type, lastText: '', lastTime: 0 });
        await localforage.setItem(APP_PREFIX + 'sessionList', sessionList);
        if (type === 'group') {
            // 预先写入新房间的设置：进去就是群聊模式
            await localforage.setItem(APP_PREFIX + id + '_chatSettings', {
                groupChat: { enabled: true, showAvatar: true, showName: true, members: [] }
            });
            try { sessionStorage.setItem('openGroupSetupFor', id); } catch (e) {}
        }
        window.location.hash = id;
        window.location.reload();
    }

    // 新建群聊进入后，自动打开群聊设置让用户加成员
    window.addEventListener('load', function () {
        setTimeout(function () {
            try {
                if (sessionStorage.getItem('openGroupSetupFor') === SESSION_ID) {
                    sessionStorage.removeItem('openGroupSetupFor');
                    if (typeof updateGroupModeUI === 'function') updateGroupModeUI();
                    showModal(document.getElementById('group-chat-modal'));
                }
            } catch (e) {}
        }, 3500);
    });
})();
