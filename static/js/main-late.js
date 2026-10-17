// ==================================================
// MAIN-LATE — ES Module entry point (after app.js)
// ==================================================
// এই file এর সব module app.js এর পরে execute হবে
// কারণ এরা app.js এর globals (._pushPage, _closeTopPage) use করে
// ==================================================

import './features/calls/call.js?v=153699';
import './features/saved/saved.js?v=153699';
import './features/messages/messages.js?v=153699';
import './features/messages/group-chat.js?v=153699';
import './core/page-stack.js?v=153699';
import './core/overlay.js?v=153699';
import './core/net.js?v=153699';
import './core/profile-last.js?v=153699';
import './features/sidebar/right-sidebar.js?v=153699';
import './features/messages/chat-tools.js?v=153699';
import './features/messages/chat-menu.js?v=153699';
import './features/messages/chat-msg-wire.js?v=153699';
import './features/messages/chat-compose.js?v=153699';
import './features/settings/settings.js?v=153699';
import './features/auth/security.js?v=153699';
import './features/auth/2fa.js?v=153699';
import './features/auth/email.js?v=153699';
import './features/auth/google.js?v=153699';
import './features/admin/admin.js?v=153699';
import './features/auth/sessions.js?v=153699';
import './features/auth/sensitive-actions.js?v=153699';
import './features/auth/security-dashboard.js?v=153699';
import './features/messages/chat-extras.js?v=153699';
import './features/reels/reel-progress.js?v=153699';
import './features/profile/extended.js?v=153699';
import './features/settings/settings-loader.js?v=153699';
import './features/notifications/notifications.js?v=153699';
import './features/notifications/post-from-notif.js?v=153699';
import './features/notifications/follow-back.js?v=153699';
import './features/reels/reels.js?v=153699';
import './features/stories/stories.js?v=153699';
import './features/stories/story-reactions.js?v=153699';

console.log('[MAIN-LATE] Late modules loaded ✅');
