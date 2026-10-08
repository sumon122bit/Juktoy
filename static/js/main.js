// ==================================================
// MAIN — ES Module entry point
// ==================================================
// এই file টা HTML এ শুধু একবার load হবে (type="module")
// আর সব core/component/feature module এখানে import হবে
// ==================================================

import './core/utils.js?v=153659';
import './core/router.js?v=153659';
import './core/state.js?v=153659';
import './components/toast.js?v=153659';
import './components/avatar.js?v=153659';
import './components/image.js?v=153659';
import './components/sidebar.js?v=153659';
import './components/theme.js?v=153659';
import './components/composer.js?v=153659';
import './features/feed/reactions.js?v=153659';
import './features/search/search.js?v=153659';
import './features/feed/feed.js?v=153659';
import './features/feed/comments.js?v=153659';
import './features/explore/explore.js?v=153659';
import './features/settings/block.js?v=153659';
import './features/feed/post-edit.js?v=153659';
import './features/feed/post-menu.js?v=153659';
import './features/settings/report.js?v=153659';
import './components/emojiPicker.js?v=153659';
import './features/onboarding/onboarding.js?v=153659';
import './features/profile/mutual-followers.js?v=153659';
import './features/profile/profile-photos.js?v=153659';
import './features/notifications/notif-filter.js?v=153659';

console.log('[MAIN] ES modules foundation loaded ✅');
