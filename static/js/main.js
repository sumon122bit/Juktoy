// ==================================================
// MAIN — ES Module entry point
// ==================================================
// এই file টা HTML এ শুধু একবার load হবে (type="module")
// আর সব core/component/feature module এখানে import হবে
// ==================================================

import './core/utils.js?v=153648';
import './core/router.js?v=153648';
import './core/state.js?v=153648';
import './components/toast.js?v=153648';
import './components/avatar.js?v=153648';
import './components/image.js?v=153648';
import './components/sidebar.js?v=153648';
import './components/theme.js?v=153648';
import './components/composer.js?v=153648';
import './features/feed/reactions.js?v=153648';
import './features/search/search.js?v=153648';
import './features/feed/feed.js?v=153648';
import './features/feed/comments.js?v=153648';
import './features/explore/explore.js?v=153648';

console.log('[MAIN] ES modules foundation loaded ✅');
