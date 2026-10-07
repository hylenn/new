window.__mr=window.__mr||{};window.__mr['chatrooms']=1;
/**
 * chatrooms.js - 聊天室页（app.html，内嵌在首页 index.html 的 iframe 里）
 *
 * 首页负责聊天列表和切换；这个文件负责"一个聊天室页面"这一侧：
 *   1. 把最后一句、未读数、单聊/群聊类型、昵称写回 sessionList（读-改-写，不覆盖别处的改动）
 *   2. 和首页握手：准备好了 / 现在可见 / 返回
 *   3. 内嵌页自己不滚动（防止 iOS 键盘或自动滚动把整个聊天室连同顶栏推出画面）
 *   4. 首页「设置」模式（?settings=1）：只显示设置窗口，关掉就回首页
 */
(function () {
    'use strict';
    var ROOT = document.documentElement;
    var EMBED = ROOT.classList.contains('embed');
    var SETTINGS_ONLY = ROOT.classList.contains('settings-only');
    window.__roomVisible = false;

    function post(type, extra) {
        if (!EMBED || window.parent === window) return;
        try { window.parent.postMessage(Object.assign({ __cr: 1, type: type, id: (typeof SESSION_ID !== 'undefined' ? SESSION_ID : null) }, extra || {}), '*'); } catch (e) {}
    }

    function preview(m) {
        if (!m) return '';
        if (m.text) return String(m.text).replace(/\s+/g, ' ').slice(0, 30);
        if (m.image) return '[图片]';
        if (m.voice) return '[语音]';
        if (m.sticker) return '[表情]';
        return '';
    }

    var _busy = false;
    async function patchMyMeta(mutator) {
        if (SETTINGS_ONLY) return;
        if (typeof SESSION_ID === 'undefined' || !SESSION_ID || !window.localforage) return;
        if (_busy) { setTimeout(function () { patchMyMeta(mutator); }, 80); return; }
        _busy = true;
        try {
            var key = APP_PREFIX + 'sessionList';
            var list = await localforage.getItem(key);
            if (!Array.isArray(list)) return;
            var s = list.find(function (x) { return x.id === SESSION_ID; });
            if (!s) return;
            var before = JSON.stringify(s);
            mutator(s);
            if (JSON.stringify(s) !== before) {
                await localforage.setItem(key, list);
                try { sessionList = list; } catch (e) {}
                post('room-meta');
            }
        } catch (e) { console.warn('[chatrooms] 更新摘要失败', e); }
        finally { _busy = false; }
    }

    window._updateRoomMeta = function () {
        if (SETTINGS_ONLY) return;
        if (typeof messages === 'undefined' || !Array.isArray(messages)) return;
        var last = null;
        for (var i = messages.length - 1; i >= 0; i--) { if (preview(messages[i])) { last = messages[i]; break; } }
        var text = preview(last);
        var time = last ? new Date(last.timestamp).getTime() : 0;
        var group = !!(window.groupChatSettings && window.groupChatSettings.enabled);
        var visible = !!window.__roomVisible;
        var msgs = messages;
        var pname = (typeof settings !== 'undefined' && settings && settings.partnerName) ? String(settings.partnerName).trim() : '';
        patchMyMeta(function (s) {
            if (pname && s.name !== pname) s.name = pname; // 聊天室里的昵称为准，列表跟着变
            s.type = group ? 'group' : 'single';
            s.lastText = text;
            s.lastTime = time;
            var readAt = s.readAt || 0;
            var unread = 0;
            if (!visible) {
                for (var j = msgs.length - 1; j >= 0; j--) {
                    var t = new Date(msgs[j].timestamp).getTime();
                    if (t <= readAt) break;
                    if (msgs[j].sender === 'partner') unread++;
                }
            }
            s.unread = unread;
        });
    };

    function anyModalOpen() {
        var ms = document.querySelectorAll('.modal');
        for (var i = 0; i < ms.length; i++) {
            if (getComputedStyle(ms[i]).display !== 'none') return true;
        }
        // 陪伴相关的弹窗是用 .active 控制显示的（平时 display:flex 但透明不可点）
        if (document.querySelector('.companion-modal.active')) return true;
        return false;
    }
    function openSettingsModal() {
        if (!window.__roomBooted || anyModalOpen()) return;
        var m = document.getElementById('settings-modal');
        if (m && typeof showModal === 'function') showModal(m);
    }

    // ── 首页 → 聊天室 ──
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.__cr !== 1 || d.type !== 'visible') return;
        window.__roomVisible = !!d.visible;
        patchMyMeta(function (s) { s.readAt = Date.now(); s.unread = 0; });
        if (d.visible) {
            if (typeof window._reloadSharedCustom === 'function') window._reloadSharedCustom().catch(function () {});
            setTimeout(function () {
                try { if (!SETTINGS_ONLY && typeof scrollToBottom === 'function') scrollToBottom(); } catch (err) {}
                window.dispatchEvent(new Event('resize'));
                if (SETTINGS_ONLY) openSettingsModal();
            }, 80);
        } else {
            try { if (typeof saveData === 'function') saveData(); } catch (err) {}
        }
    });

    if (!EMBED) return;

    // ── 内嵌页不滚动 ──
    function lockScroll() {
        if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
        var se = document.scrollingElement;
        if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
        if (document.body.scrollTop) document.body.scrollTop = 0;
    }
    window.addEventListener('scroll', lockScroll, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('scroll', lockScroll);
        window.visualViewport.addEventListener('resize', lockScroll);
    }
    document.addEventListener('focusout', function () { setTimeout(function () { lockScroll(); post('unscroll'); }, 60); });
    document.addEventListener('focusin', function () { setTimeout(function () { lockScroll(); post('unscroll'); }, 300); });

    if (!SETTINGS_ONLY) {
        // ── 左上角按钮：返回聊天列表 ──
        var goBack = function () {
            try { if (typeof saveData === 'function') saveData(); } catch (e) {}
            post('back');
        };
        document.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('#session-manager-btn') : null;
            if (!b) return;
            e.stopPropagation(); e.preventDefault();
            goBack();
        }, true);
        // ── 从屏幕左边缘向右滑：返回 ──
        var sx = 0, sy = 0, tracking = false;
        document.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            tracking = t.clientX < 22;
            sx = t.clientX; sy = t.clientY;
        }, { passive: true });
        document.addEventListener('touchend', function (e) {
            if (!tracking) return;
            tracking = false;
            var t = e.changedTouches[0];
            if (t.clientX - sx > 70 && Math.abs(t.clientY - sy) < 60) goBack();
        }, { passive: true });
    } else {
        // ── 设置模式：所有窗口都关掉了，就回首页 ──
        var armed = false, closedSince = 0;
        setInterval(function () {
            if (!window.__roomVisible) { armed = false; closedSince = 0; return; }
            if (anyModalOpen()) { armed = true; closedSince = 0; return; }
            if (!armed) return;
            if (!closedSince) closedSince = Date.now();
            else if (Date.now() - closedSince > 450) { armed = false; closedSince = 0; post('back'); }
        }, 150);
    }

    // ── 启动完成后：群成员入口只在群聊里显示；告诉首页"准备好了" ──
    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        if (window.__roomBooted || tries > 80) {
            clearInterval(timer);
            if (!SETTINGS_ONLY) {
                var g = document.getElementById('groupchat-entry');
                if (g) g.style.display = (window.groupChatSettings && window.groupChatSettings.enabled) ? '' : 'none';
                window._updateRoomMeta();
            }
            post('room-ready');
        }
    }, 250);
    if (!SETTINGS_ONLY) setInterval(function () { if (window.__roomBooted) window._updateRoomMeta(); }, 5000);
})();
