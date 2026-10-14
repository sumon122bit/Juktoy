
// ==================================================
// S13-C — GOOGLE SIGN-IN (frontend)
// ==================================================

(function () {
  var btn = document.getElementById("btn-google-login");
  if (btn) {
    btn.addEventListener("click", function () {
      // Full-page redirect to backend (avoids popup blockers)
      window.location.href = "/api/auth/google/login";
    });
  }

  // Show error if redirected back with google_error
  var params = new URLSearchParams(window.location.search);
  var err = params.get("google_error");
  if (err) {
    var msgs = {
      missing_code: "Google থেকে অনুমতি আসেনি। আবার চেষ্টা করুন।",
      invalid_state: "নিরাপত্তা চেক ব্যর্থ। আবার চেষ্টা করুন।",
      not_configured: "Google Sign-In এখনো সেটআপ করা হয়নি।",
      token_exchange: "Google থেকে টোকেন পাওয়া যায়নি।",
      no_token: "Google অ্যাক্সেস টোকেন পাওয়া যায়নি।",
      userinfo: "Google প্রোফাইল পড়া যায়নি।",
      no_google_id: "Google আইডি পাওয়া যায়নি।",
      create_failed: "অ্যাকাউন্ট তৈরি করা যায়নি।",
      access_denied: "আপনি অনুমতি দেননি।",
      // S22 / Series 13 — new error codes
      "2fa_enabled": "এই ইমেইলের একটি অ্যাকাউন্টে 2FA চালু আছে। Google দিয়ে লগইন করা যাবে না — পাসওয়ার্ড দিয়ে লগইন করুন।",
    };
    var text = msgs[err] || ("Google error: " + err);
    setTimeout(function () {
      if (typeof showMessage === "function") window.showMessage(text, "error");
      else alert(text);
    }, 100);
    history.replaceState({}, "", window.location.pathname);
  }
})();
