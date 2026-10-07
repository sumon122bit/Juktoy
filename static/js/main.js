// ==================================================
// MAIN — ES Module entry point
// ==================================================
// এই file টা HTML এ শুধু একবার load হবে (type="module")
// আর সব core/component/feature module এখানে import হবে
// ==================================================

import './core/router.js';
import './core/state.js';

console.log('[MAIN] ES modules foundation loaded ✅');
