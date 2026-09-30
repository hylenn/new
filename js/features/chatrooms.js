window.__mr=window.__mr||{};window.__mr['chatrooms']=1;
/**
 * chatrooms.js - 聊天室页（app.html，内嵌在首页 index.html 的 iframe 里）
 *
 * 首页负责聊天列表和切换；这个文件只负责"一个聊天室页面"这一侧：
 *   1. 把最后一句、未读数、单聊/群聊类型写回 sessionList（读-改-写，不会覆盖别的聊天室或别处的改动）
 *   2. 和首页握手：告诉首页"我准备好了"，接收"现在可见/不可见"，点左上角返回键/从左边缘右滑时通知首页返回
 *   3. 切回来时刷新共用的自定义回复
 */
(function () {
    'use strict';
    var EMBED = document.documentElement.classList.contains('embed');
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

    // 读-改-写：只改自己这一条的摘要字段
    var _busy = false;
    async function patchMyMeta(mutator) {
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
            if (pname && s.name !== pname) s.name = pname; // 在聊天室里改了昵称，列表也跟着变
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

    // ── 首页 → 聊天室 ──
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.__cr !== 1) return;
        if (d.type === 'visible') {
            window.__roomVisible = !!d.visible;
            patchMyMeta(function (s) { s.readAt = Date.now(); s.unread = 0; });
            if (d.visible) {
                if (typeof window._reloadSharedCustom === 'function') window._reloadSharedCustom().catch(function () {});
                setTimeout(function () {
                    try { if (typeof scrollToBottom === 'function') scrollToBottom(); } catch (err) {}
                    window.dispatchEvent(new Event('resize'));
                }, 60);
            } else {
                try { if (typeof saveData === 'function') saveData(); } catch (err) {}
            }
        }
    });

    if (!EMBED) return;

    // ── 左上角按钮：返回聊天列表 ──
    function goBack() {
        try { if (typeof saveData === 'function') saveData(); } catch (e) {}
        post('back');
    }
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

    // ── 启动完成后：群成员入口只在群聊里显示；告诉首页"准备好了" ──
    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        if (window.__roomBooted || tries > 80) {
            clearInterval(timer);
            var g = document.getElementById('groupchat-entry');
            if (g) g.style.display = (window.groupChatSettings && window.groupChatSettings.enabled) ? '' : 'none';
            window._updateRoomMeta();
            post('room-ready');
        }
    }, 250);
    setInterval(function () { if (window.__roomBooted) window._updateRoomMeta(); }, 5000);
})();
