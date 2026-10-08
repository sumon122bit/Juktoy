// ==================================================
// MAIN — ES Module entry point
// ==================================================
// এই file টা HTML এ শুধু একবার load হবে (type="module")
// আর সব core/component/feature module এখানে import হবে
// ==================================================

import './core/utils.js';
import './core/router.js';
import './core/state.js';
import './components/toast.js';
import './components/avatar.js';
import './components/image.js';
import './components/sidebar.js';
import './components/theme.js';
import './components/composer.js';
import './features/feed/reactions.js';
import './features/search/search.js';

console.log('[MAIN] ES modules foundation loaded ✅');
