// ==================================================
// MAIN — ES Module entry point
// ==================================================
// এই file টা HTML এ শুধু একবার load হবে (type="module")
// আর সব core/component/feature module এখানে import হবে
// ==================================================

import './core/utils.js?v=153676';
import './core/router.js?v=153676';
import './core/state.js?v=153676';
import './components/toast.js?v=153676';
import './components/avatar.js?v=153676';
import './components/image.js?v=153676';
import './components/sidebar.js?v=153676';
import './components/theme.js?v=153676';
import './components/composer.js?v=153676';
import './features/feed/reactions.js?v=153676';
import './features/search/search.js?v=153676';
import './features/feed/feed.js?v=153676';
import './features/feed/comments.js?v=153676';
import './features/explore/explore.js?v=153676';
import './features/settings/block.js?v=153676';
import './features/feed/post-edit.js?v=153676';
import './features/feed/post-menu.js?v=153676';
import './features/settings/report.js?v=153676';
import './components/emojiPicker.js?v=153676';
import './features/onboarding/onboarding.js?v=153676';
import './features/profile/mutual-followers.js?v=153676';
import './features/profile/profile-photos.js?v=153676';
import './features/profile/completion.js?v=153676';
import './features/profile/hero.js?v=153676';
import './features/notifications/notif-filter.js?v=153676';
import './features/settings/export-delete.js?v=153676';
import './features/settings/privacy.js?v=153676';
import './components/image-viewer.js?v=153676';
import './features/search/search-full-page.js?v=153676';

console.log('[MAIN] ES modules foundation loaded ✅');
