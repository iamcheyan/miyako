# Agent Notes

## Android System Bar Layout

This app runs in Tauri Android with `enableEdgeToEdge()` enabled in the generated Android activity. That means the WebView can draw behind the Android status bar at the top and the 3-button/gesture navigation area at the bottom. Browser layout checks are not enough because desktop browsers do not include those Android system bars.

Rules:

- Keep the root app height bounded with both `100vh` and `100dvh` fallbacks. Older Android WebView builds can misreport `100dvh`, so `100vh` must remain in `src/App.css`.
- Define system bar variables at the app/root level:
  - `--system-top-inset` for the status bar.
  - `--system-bottom-inset` for CSS safe-area bottom.
  - `--android-nav-height` for Android WebView cases where `safe-area-inset-bottom` returns `0px`.
- Top content must avoid the status bar through `.page-content { padding-top: var(--system-top-inset); }`.
- Bottom fixed surfaces must avoid the Android navigation bar through padding or an equivalent reserved area:
  - `padding-bottom: calc(var(--system-bottom-inset) + var(--android-nav-height))`
- The collapsed mini player is also a bottom surface. Keep its bottom inset on `.mini-only` so the controls stay above Android 3-button navigation while the player remains visible.
- Do not redefine `--android-nav-height` inside `.app` with a fixed `0px`; JavaScript updates this variable at runtime for Android devices.
- Do not add a bottom navigation bar unless the user explicitly asks for it.
- Expanded fixed overlays, such as the full player, must also include both top and bottom system insets.

Verification:

- After layout changes, deploy to the physical FiiO Android device and inspect a screenshot.
- Confirm the search bar does not overlap the status bar.
- Confirm bottom fixed surfaces, if present, sit above the Android system navigation buttons.
- When both an emulator and the phone are connected, use `adb -t 1 ...` for the FiiO device shown as `transport_id:1`.
