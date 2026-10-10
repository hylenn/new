window.__mr=window.__mr||{};window.__mr['chatrooms']=4;
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

    function visibleModalIds() {
        var out = [];
        document.querySelectorAll('.modal').forEach(function (m) { if (getComputedStyle(m).display !== 'none') out.push(m.id || '(no-id)'); });
        if (document.querySelector('.companion-modal.active')) out.push('(companion)');
        return out;
    }
    var _baseline = [];
    function anyModalOpen() {
        return visibleModalIds().some(function (id) { return _baseline.indexOf(id) < 0; });
    }
    var _opening = false, _opened = false;
    // 首页「设置」：不依赖启动是否完全结束，也不会被别的弹窗挡住；打不开会一直重试
    function openSettingsModal() {
        if (_opened || _opening) return;
        _opening = true;
        var n = 0;
        var t = setInterval(function () {
            n++;
            var m = document.getElementById('settings-modal');
            if (m && typeof showModal === 'function') {
                if (!_baseline.length) _baseline = visibleModalIds().filter(function (id) { return id !== 'settings-modal'; });
                try { showModal(m); } catch (e) { m.style.display = 'flex'; m.classList.add('active'); }
                if (getComputedStyle(m).display !== 'none') {
                    clearInterval(t); _opening = false; _opened = true;
                    post('settings-opened');
                    return;
                }
            }
            if (n > 60) { clearInterval(t); _opening = false; post('settings-failed', { reason: m ? 'showModal 没能显示窗口' : '找不到设置窗口' }); }
        }, 250);
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

    // ── 内嵌页自己不滚动（键盘避让由首页按"可视区域"缩放整个聊天室来完成，这里不去干预）──
    function lockScroll() {
        if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
        var se = document.scrollingElement;
        if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0; }
        if (document.body.scrollTop) document.body.scrollTop = 0;
    }
    window.addEventListener('scroll', lockScroll, { passive: true });

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
        // ── 设置模式：所有窗口都关掉了，就回首页；另外永远有一个返回按钮 / 左边缘右滑，不会被困在里面 ──
        var armed = false, closedSince = 0;
        setInterval(function () {
            if (!window.__roomVisible || !_opened) { armed = false; closedSince = 0; return; }
            if (anyModalOpen() || getComputedStyle(document.getElementById('settings-modal')).display !== 'none') { armed = true; closedSince = 0; return; }
            if (!armed) return;
            if (!closedSince) closedSince = Date.now();
            else if (Date.now() - closedSince > 450) { armed = false; closedSince = 0; _opened = false; post('back'); }
        }, 150);
        var back = document.createElement('button');
        back.id = 'so-back';
        back.innerHTML = '<i class="fas fa-chevron-left"></i>';
        back.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147483000;width:40px;height:40px;border:none;border-radius:50%;background:rgba(var(--accent-color-rgb),.9);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.25);visibility:visible;';
        back.addEventListener('click', function () { _opened = false; post('back'); });
        document.body.appendChild(back);
        var ssx = 0, ssy = 0, strk = false;
        document.addEventListener('touchstart', function (e) { var t = e.touches[0]; strk = t.clientX < 22; ssx = t.clientX; ssy = t.clientY; }, { passive: true });
        document.addEventListener('touchend', function (e) { if (!strk) return; strk = false; var t = e.changedTouches[0]; if (t.clientX - ssx > 70 && Math.abs(t.clientY - ssy) < 60) { _opened = false; post('back'); } }, { passive: true });
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
            post('room-ready', { versions: window.__mr || {} });
        }
    }, 250);
    if (!SETTINGS_ONLY) setInterval(function () { if (window.__roomBooted) window._updateRoomMeta(); }, 5000);
})();
