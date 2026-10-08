// ==================================================
// MAIN-LATE — ES Module entry point (after app.js)
// ==================================================
// এই file এর সব module app.js এর পরে execute হবে
// কারণ এরা app.js এর globals (._pushPage, _closeTopPage) use করে
// ==================================================

import './features/calls/call.js?v=153656';
import './features/saved/saved.js?v=153656';
import './features/messages/messages.js?v=153656';
import './features/notifications/notifications.js?v=153656';
import './features/reels/reels.js?v=153656';
import './features/stories/stories.js?v=153656';
import './features/stories/story-reactions.js?v=153656';

console.log('[MAIN-LATE] Late modules loaded ✅');
