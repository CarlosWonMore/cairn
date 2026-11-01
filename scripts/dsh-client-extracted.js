window.__ModuleLoader__.load({
	id: "dsh-desktop-next",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;const style = document.createElement('style'); style.textContent = "@scope (:root:has(.dshDesktopOnboardingContent)) { /*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n@layer properties {\n  @supports (((-webkit-hyphens: none)) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color: rgb(from red r g b)))) {\n    *, :before, :after, ::backdrop {\n      --tw-animation-delay: 0s;\n      --tw-animation-direction: normal;\n      --tw-animation-duration: initial;\n      --tw-animation-fill-mode: none;\n      --tw-animation-iteration-count: 1;\n      --tw-enter-blur: 0;\n      --tw-enter-opacity: 1;\n      --tw-enter-rotate: 0;\n      --tw-enter-scale: 1;\n      --tw-enter-translate-x: 0;\n      --tw-enter-translate-y: 0;\n      --tw-exit-blur: 0;\n      --tw-exit-opacity: 1;\n      --tw-exit-rotate: 0;\n      --tw-exit-scale: 1;\n      --tw-exit-translate-x: 0;\n      --tw-exit-translate-y: 0;\n    }\n  }\n}\n\n@layer theme {\n  :scope {\n    --font-sans: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\",\n      \"Noto Sans\", Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\",\n      \"Segoe UI Symbol\", \"Noto Color Emoji\";\n    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\",\n      \"Courier New\", monospace;\n    --default-font-family: var(--font-sans);\n    --default-mono-font-family: var(--font-mono);\n  }\n}\n\n@layer base {\n  *, :after, :before, ::backdrop {\n    box-sizing: border-box;\n    border: 0 solid;\n    margin: 0;\n    padding: 0;\n  }\n\n  ::file-selector-button {\n    box-sizing: border-box;\n    border: 0 solid;\n    margin: 0;\n    padding: 0;\n  }\n\n  html, :host {\n    -webkit-text-size-adjust: 100%;\n    tab-size: 4;\n    line-height: 1.5;\n    font-family: var(--default-font-family, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", \"Noto Sans\", Arial, sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\");\n    font-feature-settings: var(--default-font-feature-settings, normal);\n    font-variation-settings: var(--default-font-variation-settings, normal);\n    -webkit-tap-highlight-color: transparent;\n  }\n\n  hr {\n    height: 0;\n    color: inherit;\n    border-top-width: 1px;\n  }\n\n  abbr:where([title]) {\n    -webkit-text-decoration: underline dotted;\n    text-decoration: underline dotted;\n  }\n\n  h1, h2, h3, h4, h5, h6 {\n    font-size: inherit;\n    font-weight: inherit;\n  }\n\n  a {\n    color: inherit;\n    -webkit-text-decoration: inherit;\n    -webkit-text-decoration: inherit;\n    -webkit-text-decoration: inherit;\n    text-decoration: inherit;\n  }\n\n  b, strong {\n    font-weight: bolder;\n  }\n\n  code, kbd, samp, pre {\n    font-family: var(--default-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace);\n    font-feature-settings: var(--default-mono-font-feature-settings, normal);\n    font-variation-settings: var(--default-mono-font-variation-settings, normal);\n    font-size: 1em;\n  }\n\n  small {\n    font-size: 80%;\n  }\n\n  sub, sup {\n    vertical-align: baseline;\n    font-size: 75%;\n    line-height: 0;\n    position: relative;\n  }\n\n  sub {\n    bottom: -.25em;\n  }\n\n  sup {\n    top: -.5em;\n  }\n\n  table {\n    text-indent: 0;\n    border-color: inherit;\n    border-collapse: collapse;\n  }\n\n  :-moz-focusring:where(:not(iframe)) {\n    outline: auto;\n  }\n\n  progress {\n    vertical-align: baseline;\n  }\n\n  summary {\n    display: list-item;\n  }\n\n  ol, ul, menu {\n    list-style: none;\n  }\n\n  img, svg, video, canvas, audio, iframe, embed, object {\n    vertical-align: middle;\n    display: block;\n  }\n\n  img, video {\n    max-width: 100%;\n    height: auto;\n  }\n\n  button, input, select, optgroup, textarea {\n    font: inherit;\n    font-feature-settings: inherit;\n    font-variation-settings: inherit;\n    letter-spacing: inherit;\n    color: inherit;\n    opacity: 1;\n    background-color: #0000;\n    border-radius: 0;\n  }\n\n  ::file-selector-button {\n    font: inherit;\n    font-feature-settings: inherit;\n    font-variation-settings: inherit;\n    letter-spacing: inherit;\n    color: inherit;\n    opacity: 1;\n    background-color: #0000;\n    border-radius: 0;\n  }\n\n  :where(select:is([multiple], [size])) optgroup {\n    font-weight: bolder;\n  }\n\n  :where(select:is([multiple], [size])) optgroup option {\n    padding-inline-start: 20px;\n  }\n\n  ::file-selector-button {\n    margin-inline-end: 4px;\n  }\n\n  ::placeholder {\n    opacity: 1;\n  }\n\n  @supports (not ((-webkit-appearance: -apple-pay-button))) or (contain-intrinsic-size: 1px) {\n    ::placeholder {\n      color: currentColor;\n    }\n\n    @supports (color: color-mix(in lab, red, red)) {\n      ::placeholder {\n        color: color-mix(in oklab, currentcolor 50%, transparent);\n      }\n    }\n  }\n\n  textarea {\n    resize: vertical;\n  }\n\n  ::-webkit-search-decoration {\n    -webkit-appearance: none;\n  }\n\n  ::-webkit-date-and-time-value {\n    min-height: 1lh;\n    text-align: inherit;\n  }\n\n  ::-webkit-datetime-edit {\n    display: inline-flex;\n  }\n\n  ::-webkit-datetime-edit-fields-wrapper {\n    padding: 0;\n  }\n\n  ::-webkit-datetime-edit {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-year-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-month-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-day-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-hour-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-minute-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-second-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-millisecond-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-datetime-edit-meridiem-field {\n    padding-block: 0;\n  }\n\n  ::-webkit-calendar-picker-indicator {\n    line-height: 1;\n  }\n\n  :-moz-ui-invalid {\n    box-shadow: none;\n  }\n\n  button, input:where([type=\"button\"], [type=\"reset\"], [type=\"submit\"]) {\n    appearance: button;\n  }\n\n  ::file-selector-button {\n    appearance: button;\n  }\n\n  ::-webkit-inner-spin-button {\n    height: auto;\n  }\n\n  ::-webkit-outer-spin-button {\n    height: auto;\n  }\n\n  [hidden]:where(:not([hidden=\"until-found\"])) {\n    display: none !important;\n  }\n\n  * {\n    border-color: var(--border);\n    outline-color: var(--ring);\n  }\n\n  @supports (color: color-mix(in lab, red, red)) {\n    * {\n      outline-color: color-mix(in oklab, var(--ring) 50%, transparent);\n    }\n  }\n}\n\n@layer components, utilities;\n\n@property --tw-animation-delay {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0s;\n}\n\n@property --tw-animation-direction {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: normal;\n}\n\n@property --tw-animation-duration {\n  syntax: \"*\";\n  inherits: false\n}\n\n@property --tw-animation-fill-mode {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: none;\n}\n\n@property --tw-animation-iteration-count {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 1;\n}\n\n@property --tw-enter-blur {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-enter-opacity {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 1;\n}\n\n@property --tw-enter-rotate {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-enter-scale {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 1;\n}\n\n@property --tw-enter-translate-x {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-enter-translate-y {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-exit-blur {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-exit-opacity {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 1;\n}\n\n@property --tw-exit-rotate {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-exit-scale {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 1;\n}\n\n@property --tw-exit-translate-x {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\n@property --tw-exit-translate-y {\n  syntax: \"*\";\n  inherits: false;\n  initial-value: 0;\n}\n\nbody:has(.dshDesktopOnboardingContent) {\n  --background: var(--dsw-alias-bg-base);\n  --foreground: var(--dsw-alias-label-primary);\n  --card: var(--dsw-alias-bg-layer-1);\n  --popover: var(--dsw-alias-bg-layer-1);\n  --primary: var(--dsw-alias-button-primary-fill);\n  --primary-foreground: var(--dsw-alias-label-primary-foreground);\n  --secondary: var(--dsw-alias-interactive-bg-active);\n  --muted: var(--dsw-alias-bg-layer-2);\n  --muted-foreground: var(--dsw-alias-label-secondary);\n  --destructive: var(--dsw-alias-state-error-primary);\n  --border: var(--dsw-alias-border-l2);\n  --ring: var(--dsw-alias-border-l3);\n  --radius: .625rem;\n}\n\n.dshDesktopOnboardingContent {\n  color: var(--foreground);\n}\n\n.dshDesktopAccountSetup {\n  justify-content: center;\n  align-items: safe center;\n  height: 100%;\n  padding: 64px 32px;\n  display: flex;\n  overflow: auto;\n}\n\n.dshDesktopAccountSetup > div {\n  width: 100%;\n  max-width: 560px;\n}\n\n.dshDesktopAccountSetup h1 {\n  margin-bottom: 24px;\n  font-size: 32px;\n  font-weight: 500;\n}\n\n.dshDesktopAccountSetup p {\n  color: var(--muted-foreground);\n  margin-bottom: 16px;\n  line-height: 1.8;\n}\n\n.dshDesktopAccountActions {\n  flex-wrap: wrap;\n  gap: 16px;\n  margin-top: 32px;\n  display: flex;\n}\n\n.dshDesktopSetupContent {\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n}\n\n.dshSetupWizard {\n  --setup-navigation-inset: clamp(40px, 8.333vw, 120px);\n  flex-direction: column;\n  height: 100%;\n  display: flex;\n}\n\n.dshSetupWizard :is(button, [role=\"radio\"], [role=\"switch\"], label[for]) {\n  cursor: pointer;\n}\n\n.dshSetupWizard :is(button, [role=\"radio\"], [role=\"switch\"], label[for]):is(:disabled, [aria-disabled=\"true\"], [data-disabled]), .dshSetupWizard label:has(:disabled, [aria-disabled=\"true\"], [data-disabled]), .dshSetupWizard fieldset:disabled label[for] {\n  cursor: not-allowed;\n}\n\n.dshSetupProgress {\n  padding: 22px var(--setup-navigation-inset);\n  color: var(--muted-foreground);\n  -webkit-app-region: drag;\n  flex-shrink: 0;\n  justify-content: space-between;\n  align-items: center;\n  font-size: 11px;\n  display: flex;\n}\n\n.dshSetupProgress ol {\n  gap: 7px;\n  display: flex;\n}\n\n.dshSetupProgress li {\n  background: var(--border);\n  border-radius: 6px;\n  width: 6px;\n  height: 6px;\n}\n\n.dshSetupProgress li[aria-current=\"step\"] {\n  background: var(--foreground);\n  width: 22px;\n}\n\n.dshSetupNavigation {\n  padding: 24px var(--setup-navigation-inset) clamp(24px, 7.61vh, 70px);\n  flex-shrink: 0;\n}\n\n.dshSetupMain {\n  flex: 1;\n  min-height: 0;\n  padding: 24px clamp(32px, 6vw, 80px);\n  display: flex;\n  overflow: auto;\n}\n\n.dshSetupFieldset {\n  border: 0;\n  flex-direction: column;\n  width: 100%;\n  min-width: 0;\n  padding: 0;\n  display: flex;\n}\n\n.dshSetupPages {\n  flex-direction: column;\n  flex: 1;\n  justify-content: safe center;\n  display: flex;\n}\n\n.dshSetupWizard :is(.dshSetupPage, .dshSetupWelcome) {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  grid-template-areas: \"copy options\"\n                       \"actions options\";\n  align-items: center;\n  column-gap: clamp(32px, 5vw, 72px);\n  width: 100%;\n  max-width: 960px;\n  margin: auto;\n  padding: 0;\n  display: grid;\n}\n\n.dshSetupWizard .dshSetupCopy {\n  grid-area: copy;\n  align-self: end;\n  margin: 0;\n}\n\n.dshSetupWizard .dshSetupCopy h1 {\n  letter-spacing: -.035em;\n  outline: none;\n  font-size: clamp(30px, 4.4vw, 52px);\n  font-weight: 500;\n  line-height: 1.22;\n}\n\n.dshSetupWizard .dshSetupCopy > p {\n  white-space: pre-line;\n  margin-top: 24px;\n  font-size: 15px;\n  line-height: 1.9;\n}\n\n.dshSetupWizard .dshSetupOptions {\n  box-shadow: none;\n  background: none;\n  border: 0;\n  grid-area: options;\n  margin: 0;\n  padding: 0;\n}\n\n.dshSetupWizard .dshSetupOptions > [data-slot=\"card-content\"] {\n  padding: 0;\n}\n\n.dshSetupWizard .dshSetupOptions label:has([role=\"radio\"]) {\n  border-radius: 16px;\n  align-items: center;\n  padding: 18px 20px;\n}\n\n.dshSetupWizard .dshSetupOptions [role=\"radio\"] {\n  flex-shrink: 0;\n  order: 1;\n  margin-left: auto;\n}\n\n.dshSetupWizard .dshSetupActions {\n  grid-area: actions;\n  justify-content: flex-start;\n  align-self: start;\n  margin-top: 32px;\n}\n\n.dshSetupWizard .dshSetupActions button {\n  min-height: 42px;\n  padding-inline: 20px;\n}\n\n.dshSetupSuccessArtwork {\n  justify-content: center;\n  padding: 32px;\n  display: flex;\n}\n\n.dshSetupSuccessArtwork svg {\n  stroke-width: 1.25px;\n  width: 112px;\n  height: 112px;\n}\n\n@media (max-width: 760px) {\n  .dshSetupWizard :is(.dshSetupPage, .dshSetupWelcome) {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-areas: \"copy\"\n                         \"options\"\n                         \"actions\";\n    row-gap: 26px;\n    max-width: 500px;\n  }\n\n  .dshSetupWizard .dshSetupActions {\n    margin-top: 0;\n  }\n}\n\n.dshDesktopSetupContent:is([data-platform=\"darwin\"], [data-platform=\"win32\"]) {\n  padding-top: 36px;\n}\n\n.dshDesktopOnboardingContent :is(button, a, input, textarea, select, label, summary, [contenteditable=\"true\"], [role=\"button\"], [role=\"radio\"], [role=\"switch\"], [role=\"checkbox\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"slider\"]) {\n  -webkit-app-region: no-drag;\n}\n\nbody:has(.dshDesktopOnboardingContent) [data-slot=\"dialog-overlay\"], body:has(.dshDesktopOnboardingContent) [data-slot=\"dialog-content\"] {\n  z-index: 901;\n  -webkit-app-region: no-drag;\n}\n/*$vite$:1*/ }"; document.head.appendChild(style);
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region ../dsh-plugin-desktop/src/product-identity.ts
		/** Stable and Beta identities used to locate each edition's private app data. */
		var DESKTOP_RELEASE_IDENTITIES = Object.freeze({
			stable: Object.freeze({
				releaseChannel: "stable",
				packageName: "dsh-plugin-desktop",
				productName: "DSH Desktop",
				appId: "ai.deepseek.dsh.desktop",
				homeDirectoryName: ".dsh"
			}),
			beta: Object.freeze({
				releaseChannel: "beta",
				packageName: "dsh-plugin-desktop-beta",
				productName: "DSH Desktop Beta",
				appId: "ai.deepseek.dsh.desktop.beta",
				homeDirectoryName: ".dsh-beta"
			})
		});
		/** Stable release-channel identities that must stay aligned with electron-builder. */
		var DESKTOP_PRODUCT_IDENTITY = DESKTOP_RELEASE_IDENTITIES.stable;
		var OTHER_DESKTOP_PRODUCT_IDENTITY = DESKTOP_RELEASE_IDENTITIES.beta;
		var DESKTOP_PACKAGE_NAME = DESKTOP_PRODUCT_IDENTITY.packageName;
		OTHER_DESKTOP_PRODUCT_IDENTITY.packageName;
		DESKTOP_PRODUCT_IDENTITY.productName;
		DESKTOP_PRODUCT_IDENTITY.appId;
		DESKTOP_PRODUCT_IDENTITY.releaseChannel;
		DESKTOP_PRODUCT_IDENTITY.homeDirectoryName;
		//#endregion
		//#region src/client/desktop-settings-styles.ts
		/** Desktop settings section styles, installed independently of presentation mode. */
		var STYLE_ID$1 = "dsh-desktop-settings-styles";
		var CSS$1 = `
.dshDesktopSettings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: min(100%, 880px);
  padding: 2px 0 36px;
  color: var(--dsw-alias-label-primary);
}
.dshDesktopSettingsHeader h2,
.dshDesktopSettingsGroup h3 {
  margin: 0;
  font-weight: 600;
}
.dshDesktopSettingsHeader h2 { font-size: 22px; line-height: 1.35; }
.dshDesktopSettingsGroup h3 { font-size: 16px; line-height: 1.4; }
.dshDesktopSettingsHeader p,
.dshDesktopSettingsGroupIntro,
.dshDesktopSettingsHint {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.dshDesktopSettingsGroup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dshDesktopSettingsList { display: grid; gap: 8px; }
.dshDesktopSettingsChoice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-sizing: border-box;
  width: 100%;
  color: inherit;
  cursor: default;
  text-align: left;
  font: inherit;
}
.dshDesktopSettingsToggleRow,
.dshDesktopSettingsMaterialField,
.dshDesktopSettingsUpdateRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-width: 0;
  padding: 16px 0;
  border: 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  background: transparent;
}
.dshDesktopSettingsGroup > :is(.dshDesktopSettingsToggleRow, .dshDesktopSettingsMaterialField, .dshDesktopSettingsUpdateRow):first-child,
.dshDesktopSettingsGroup > .dshDesktopSettingsExpandableGroup:first-child > .dshDesktopSettingsToggleRow:first-child {
  padding-top: 0;
}
.dshDesktopSettingsGroup > :is(.dshDesktopSettingsToggleRow, .dshDesktopSettingsMaterialField, .dshDesktopSettingsUpdateRow):has(+ .dshDesktopSettingsHint:last-child),
.dshDesktopSettingsGroup > .dshDesktopSettingsExpandableGroup:has(+ .dshDesktopSettingsHint:last-child) > .dshDesktopSettingsToggleRow:last-child,
.dshDesktopSettingsGroup > .dshDesktopSettingsExpandableGroup:has(+ .dshDesktopSettingsHint:last-child) > .dshDesktopSettingsExpandedRows:last-child > :last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.dshDesktopSettingsGroup > :is(.dshDesktopSettingsToggleRow, .dshDesktopSettingsMaterialField, .dshDesktopSettingsUpdateRow):last-child,
.dshDesktopSettingsGroup > .dshDesktopSettingsExpandableGroup:last-child > .dshDesktopSettingsToggleRow:last-child,
.dshDesktopSettingsGroup > .dshDesktopSettingsExpandableGroup:last-child > .dshDesktopSettingsExpandedRows:last-child > :last-child {
  border-bottom: 0;
  padding-bottom: 0;
  margin-bottom: -8px;
}
.dshDesktopSettingsChoice[data-actionable="true"] { cursor: pointer; }
.dshDesktopSettingsChoice[data-actionable="true"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopSettingsChoice:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dshDesktopSettingsChoice[data-selected="true"] {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary);
}
.dshDesktopSettingsChoice[aria-disabled="true"]:not([data-selected="true"]) { opacity: .58; }
.dshDesktopSettingsChoiceCopy { display: block; flex: 1; min-width: 0; }
.dshDesktopSettingsToggleCopy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.dshDesktopSettingsToggleLabel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.dshDesktopSettingsToggleDescription {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
}
.dshDesktopSettingsChoiceAside { flex: 0 0 auto; margin-left: 12px; }
.dshDesktopSettingsDeleteConfirm { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; max-width: 320px; }
.dshDesktopSettingsDeleteWarning { color: var(--dsw-alias-state-warning-primary); font-size: 12px; line-height: 1.4; text-align: right; }
.dshDesktopSettingsDeleteActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.dshDesktopSettingsChoiceTitle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}
.dshDesktopSettingsChoiceBody {
  display: block;
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dshDesktopSettingsChoiceLink {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.dshDesktopSettingsChoiceLink:hover { text-decoration-thickness: 2px; }
.dshDesktopSettingsChoiceTitle .dshDesktopSettingsChoiceLink {
  text-decoration: none;
}
.dshDesktopSettingsChoiceTitle .dshDesktopSettingsChoiceLink:hover {
  opacity: .82;
}
.dshDesktopSettingsBadge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 400;
}
.dshDesktopSettingsForm {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.dshDesktopSettingsField {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshDesktopSettingsField > span { width: 100%; }
.dshDesktopSettingsInput {
  width: 100%;
  min-height: 36px;
  box-sizing: border-box;
  padding: 7px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dshDesktopSettingsInput:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.dshDesktopSettingsButton,
button.dshDesktopSettingsButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: fit-content;
  height: 36px;
  min-width: 90px;
  max-width: 280px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  white-space: nowrap;
}
.dshDesktopSettingsGroup > .dshDesktopSettingsButton {
  align-self: flex-start;
  justify-self: start;
}
.dshDesktopSettingsToolActions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: nowrap;
}
.dshDesktopSettingsToolActions .dshDesktopSettingsButton {
  min-width: 0;
  padding: 0 12px;
}
.dshDesktopSettingsDataPath {
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 18px;
  user-select: text;
}
.dshDesktopSettingsRowActions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.dshDesktopSettingsRowActions .dshDesktopSettingsButton {
  min-width: 0;
  padding: 0 12px;
}
.dshDesktopSettingsButton:hover:not(:disabled),
button.dshDesktopSettingsButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
a.dshDesktopSettingsButton,
a.dshDesktopSettingsButton:hover {
  color: var(--dsw-alias-label-primary);
  text-decoration: none;
}
.dshDesktopSettingsButtonSecondary,
button.dshDesktopSettingsButtonSecondary {
  color: var(--dsw-alias-label-primary);
}
.dshDesktopSettingsButtonDanger,
button.dshDesktopSettingsButtonDanger {
  color: var(--dsw-alias-state-error-primary);
}
.dshDesktopSettingsButton:disabled,
button.dshDesktopSettingsButton:disabled {
  cursor: default;
  opacity: .45;
}
.dshDesktopNativeActions[data-placement="settings"] {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopNativeActionMenuAnchor { position: relative; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenu {
  position: absolute;
  z-index: 2147483001;
  top: calc(100% + 5px);
  right: 0;
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: minmax(0, 1fr);
  min-width: 220px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 28%, transparent);
  -webkit-app-region: no-drag;
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 32px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: start;
  white-space: nowrap;
}
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem:disabled { cursor: default; opacity: .45; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem svg { width: 14px; height: 14px; stroke-width: 1.8; }
.dshDesktopNativeActions[data-placement="settings"] .dshDesktopActionMenuItem span { flex: 1; }
.dshDesktopSettingsHeaderButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}
.dshDesktopSettingsHeaderButton svg { width: 14px; height: 14px; margin-left: 5px; }
.dshDesktopSettingsHeaderButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopSettingsHeaderButton:disabled { cursor: not-allowed; opacity: .4; }
.dshDesktopNativeActionError {
  max-width: 260px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
  line-height: 1.4;
}
.dshDesktopSettingsMaterialCopy { min-width: 0; }
.dshDesktopSettingsSelect,
button.dshDesktopSettingsSelect {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  height: 36px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md, 8px);
  background-color: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  white-space: nowrap;
}
.dshDesktopSettingsSelect:hover:not(:disabled),
button.dshDesktopSettingsSelect:hover:not(:disabled) {
  background-color: var(--dsw-alias-interactive-bg-hover);
}
.dshDesktopSettingsSelect:disabled,
button.dshDesktopSettingsSelect:disabled {
  cursor: default;
  opacity: .45;
}
.dshDesktopSettingsSelectChevron {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dshDesktopSettingsNotice,
.dshDesktopSettingsError,
.dshDesktopSettingsSuccess {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
}
.dshDesktopSettingsNotice { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dshDesktopSettingsError { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dshDesktopSettingsSuccess { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.dshDesktopSettingsExpandableGroup,
.dshDesktopSettingsExpandedRows {
  display: flex;
  flex-direction: column;
}
.dshDesktopSettingsToggleControl {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.dshDesktopSettingsExpander {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshDesktopSettingsExpander:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshDesktopSettingsExpander:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dshDesktopSettingsExpander svg {
  transition: transform var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease);
}
.dshDesktopSettingsExpander[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
.dshDesktopSettingsToggle {
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dshDesktopSettingsToggle[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
}
.dshDesktopSettingsToggle:disabled { cursor: default; opacity: .5; }
.dshDesktopSettingsToggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dshDesktopSettingsToggleKnob {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 120ms ease;
}
.dshDesktopSettingsToggle[aria-checked="false"] .dshDesktopSettingsToggleKnob {
  background: var(--dsw-alias-switch-thumb);
}
.dshDesktopSettingsToggle[aria-checked="true"] .dshDesktopSettingsToggleKnob {
  transform: translateX(16px);
}
.dshDesktopSettingsLanStatus {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshDesktopSettingsLanStatus[data-state="ready"] .dshDesktopSettingsBadge {
  color: var(--dsw-alias-state-success-primary);
}
.dshDesktopSettingsLanStatus[data-state="failed"] .dshDesktopSettingsBadge {
  color: var(--dsw-alias-state-error-primary);
}
.dshDesktopSettingsLanStatus code,
.dshDesktopSettingsLanFingerprint code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.dshDesktopSettingsLanFingerprint {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.dshDesktopSettingsUrls {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshDesktopSettingsUrls a {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-brand-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.dshDesktopSettingsUrlRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
}
.dshDesktopSettingsUrlRow a {
  flex: 1;
  min-width: 0;
  width: auto;
  white-space: nowrap;
  overflow-x: auto;
  overflow-wrap: normal;
  padding-block: 4px;
  text-decoration: none;
}
.dshDesktopSettingsUrlCopy {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dshDesktopSettingsUrlCopy:hover { background: var(--dsw-alias-bg-layer-2); }
.dshDesktopSettingsUrlCopy:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshDesktopSettingsUrlCopy:disabled { opacity: 0.5; cursor: wait; }
.dshDesktopSettingsDialogBackdrop {
  position: fixed;
  z-index: 2147483002;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, #000 55%, transparent);
}
.dshDesktopSettingsDialog {
  width: min(440px, 100%);
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 24px 64px color-mix(in srgb, #000 38%, transparent);
}
.dshDesktopSettingsDialog h3 { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 16px; }
.dshDesktopSettingsDialog p { margin: 12px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.65; }
.dshDesktopSettingsDialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
@media (max-width: 720px) {
  .dshDesktopSettingsChoice,
  .dshDesktopSettingsUpdateRow,
  .dshDesktopSettingsToggleRow { align-items: flex-start; }
  .dshDesktopSettingsForm { align-items: stretch; flex-direction: column; }
}
/* Chromium's Windows and Linux <select> popup takes its fill from the control's
   own background-color and its text from the inherited color. Upstream's
   transparent selects (voice input, Cordis) therefore open a white popup with
   the dark palette's light text. An opaque option fill keeps that list readable;
   the closed control is unchanged, and macOS's native menu ignores it. */
body[data-ds-dark-theme] select :is(option, optgroup) { background-color: var(--dsw-alias-bg-layer-2); }
`;
		/** Install one scoped stylesheet; tolerate headless Client boot. */
		function installDesktopSettingsStyles(owner = DESKTOP_PACKAGE_NAME) {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ID$1) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.dataset.plugin = owner;
			style.dataset.pluginCss = `${owner}/desktop-settings`;
			style.textContent = CSS$1;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/client/sidebar-footer-styles.ts
		/**
		* Sidebar footer layout owned by Desktop Next.
		*
		* Upstream renders `sidebar.footer.action` as a `display: contents` anchor
		* inside a `flex-wrap: nowrap` row container, so several full-width launchers
		* become flex siblings on one line and crush each other, whereas a hard
		* `flex-direction: column` override stacks compact icon-only actions one per
		* row in the middle of an expanded sidebar. Next uses a balanced multi-column
		* grid in the expanded sidebar by default — keeping full-width launchers on
		* their own `1 / -1` rows while distributing compact icon actions evenly across
		* balanced rows and aligned columns — and switches back to a single vertical
		* column when the sidebar collapses into its narrow rail or when the user
		* disables the horizontal layout compatibility toggle.
		*/
		var STYLE_ID = "dsh-desktop-sidebar-footer-styles";
		var SIDEBAR_FOOTER_COMPAT_ATTRIBUTE = "data-dsh-sidebar-footer-compat";
		var SIDEBAR_FOOTER_BALANCED_ATTRIBUTE = "data-dsh-sidebar-footer-balanced";
		var FOOTER_SLOT_SELECTOR = "[data-slot=\"sidebar.footer.action\"]";
		var FOOTER_ITEM_ATTRIBUTE = "data-dsh-footer-item";
		var GRID_COLUMNS_VAR = "--dsh-footer-grid-columns";
		var COMPACT_COLUMN_GAP = 6;
		var MAX_COMPACT_ITEM_WIDTH = 96;
		var IGNORED_TEXT_TAGS = /* @__PURE__ */ new Set([
			"SVG",
			"STYLE",
			"SCRIPT",
			"NOSCRIPT",
			"TEMPLATE"
		]);
		var CSS = `
body [data-slot="sidebar.footer.action"] {
  display: grid !important;
  box-sizing: border-box;
  grid-template-columns: var(--dsh-footer-grid-columns, repeat(4, minmax(0, 1fr)));
  align-items: center;
  column-gap: 6px;
  row-gap: 4px;
  min-width: 0;
  width: calc(100% + 8px);
  margin-inline: -4px;
  max-height: min(40vh, 240px);
  padding: 0 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
html[data-dsh-sidebar-footer-balanced="off"]:not([data-dsh-sidebar-footer-compat="off"]) body [data-slot="sidebar.footer.action"] {
  display: flex !important;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: flex-start;
  column-gap: 4px;
}
body [class*="collapsed"] [data-slot="sidebar.footer.action"],
html[data-dsh-sidebar-footer-balanced="off"] body [class*="collapsed"] [data-slot="sidebar.footer.action"],
html[data-dsh-sidebar-footer-compat="off"] body [data-slot="sidebar.footer.action"] {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  justify-items: center;
}
body [data-slot="sidebar.footer.action"] > * {
  grid-column: 1 / -1;
  justify-self: stretch;
  flex: 0 0 100%;
  min-width: 0;
  max-width: 100%;
}
body [data-slot="sidebar.footer.action"] > [data-dsh-footer-item="compact"] {
  grid-column: span 1;
  justify-self: center;
  flex: 0 0 auto;
  width: max-content !important;
  max-width: 100%;
  padding-inline: 0 !important;
  order: 1;
}
body [class*="collapsed"] [data-slot="sidebar.footer.action"] > *,
html[data-dsh-sidebar-footer-compat="off"] body [data-slot="sidebar.footer.action"] > [data-dsh-footer-item="compact"] {
  grid-column: 1 / -1;
  justify-self: center;
}
`;
		function hasVisibleLabelText(node) {
			if (node.nodeType === 3) return (node.textContent ?? "").trim().length > 0;
			if (node.nodeType !== 1) return false;
			const el = node;
			if (typeof el.tagName === "string" && IGNORED_TEXT_TAGS.has(el.tagName.toUpperCase())) return false;
			const children = el.childNodes;
			if (!children) return false;
			for (let i = 0; i < children.length; i += 1) {
				const child = children[i];
				if (child && hasVisibleLabelText(child)) return true;
			}
			return false;
		}
		/**
		* Compute a balanced column count for compact footer items so multi-row wraps
		* divide evenly (e.g. 6 items wrap as 3+3 instead of greedy 5+1).
		*/
		function computeBalancedColumnCount(widths, containerWidth, columnGap = COMPACT_COLUMN_GAP) {
			const count = widths.length;
			if (count === 0) return 1;
			const available = Math.max(containerWidth, 1);
			const fitsColumns = (cols) => {
				let total = (cols - 1) * columnGap;
				for (let c = 0; c < cols; c += 1) {
					let colMax = 0;
					for (let i = c; i < count; i += cols) {
						const w = widths[i] ?? 0;
						if (w > colMax) colMax = w;
					}
					total += colMax;
				}
				return total <= available;
			};
			let maxCols = 1;
			for (let cols = count; cols >= 1; cols -= 1) if (fitsColumns(cols)) {
				maxCols = cols;
				break;
			}
			const minRows = Math.ceil(count / maxCols);
			if (minRows === 1) {
				if (count < 3) {
					const maxItemWidth = Math.max(...widths, 28);
					return Math.max(count, Math.min(4, Math.floor((available + columnGap) / (maxItemWidth + columnGap))));
				}
				return count;
			}
			const idealCols = Math.ceil(count / minRows);
			for (let cols = idealCols; cols <= maxCols; cols += 1) if (fitsColumns(cols)) return cols;
			return maxCols;
		}
		/** Build the CSS `grid-template-columns` value for balanced compact footer items. */
		function computeBalancedGridTemplate(widths, containerWidth, columnGap = COMPACT_COLUMN_GAP) {
			const cols = computeBalancedColumnCount(widths, containerWidth, columnGap);
			if (cols <= 1 || widths.length === 0) return "minmax(0, 1fr)";
			const equalColWidth = (Math.max(containerWidth, 1) - (cols - 1) * columnGap) / cols;
			const colMaxes = [];
			for (let c = 0; c < cols; c += 1) {
				let colMax = 28;
				for (let i = c; i < widths.length; i += cols) {
					const w = widths[i] ?? 0;
					if (w > colMax) colMax = w;
				}
				colMaxes.push(colMax);
			}
			if (Math.max(...colMaxes) <= equalColWidth) return `repeat(${cols}, minmax(0, 1fr))`;
			return colMaxes.map((w) => `minmax(0, ${Math.max(w, 1)}fr)`).join(" ");
		}
		function setAttrIfChanged(el, name, value) {
			if (el.getAttribute?.(name) !== value) el.setAttribute?.(name, value);
		}
		/**
		* Measure and balance direct children of a `sidebar.footer.action` slot element.
		*
		* Uses strict write -> read -> write batching so setting attributes never
		* interleaves with `getBoundingClientRect()` / `scrollWidth` reads (avoiding
		* synchronous layout thrashing).
		*/
		function balanceSidebarFooterSlot(slot, knownSlotWidth) {
			const children = slot.children ? Array.from(slot.children) : [];
			if (children.length === 0) return;
			const compactCandidates = [];
			for (const child of children) if (hasVisibleLabelText(child)) setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, "full");
			else {
				setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, "compact");
				compactCandidates.push(child);
			}
			const rawWidth = knownSlotWidth || slot.clientWidth || (typeof slot.getBoundingClientRect === "function" ? Math.floor(slot.getBoundingClientRect().width) : 0) || 216;
			const containerWidth = Math.max(rawWidth - 8, 120);
			const compactWidths = [];
			const oversizedChildren = [];
			for (const child of compactCandidates) {
				const rectW = typeof child.getBoundingClientRect === "function" ? Math.ceil(child.getBoundingClientRect().width) : 0;
				const naturalWidth = Math.max(rectW, child.scrollWidth ?? 0, 28);
				if (naturalWidth > MAX_COMPACT_ITEM_WIDTH || naturalWidth > containerWidth * .55) oversizedChildren.push(child);
				else compactWidths.push(naturalWidth);
			}
			for (const child of oversizedChildren) setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, "full");
			const template = computeBalancedGridTemplate(compactWidths, containerWidth, COMPACT_COLUMN_GAP);
			if (slot.style?.getPropertyValue?.(GRID_COLUMNS_VAR) !== template) slot.style?.setProperty?.(GRID_COLUMNS_VAR, template);
		}
		function syncAllSidebarFooterSlots() {
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
			const slots = document.querySelectorAll(FOOTER_SLOT_SELECTOR);
			for (const slot of slots) balanceSidebarFooterSlot(slot);
		}
		/** Toggle the expanded sidebar footer row layout compatibility mode. */
		function setSidebarFooterCompat(enabled) {
			if (typeof document === "undefined") return;
			const root = document.documentElement;
			if (!root) return;
			if (enabled) {
				if (typeof root.removeAttribute === "function") root.removeAttribute(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE);
				else if (root.dataset) delete root.dataset.dshSidebarFooterCompat;
			} else if (typeof root.setAttribute === "function") root.setAttribute(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE, "off");
			else if (root.dataset) root.dataset.dshSidebarFooterCompat = "off";
			syncAllSidebarFooterSlots();
		}
		/** Toggle the balanced multi-column grid distribution for compact footer items. */
		function setSidebarFooterBalanced(enabled) {
			if (typeof document === "undefined") return;
			const root = document.documentElement;
			if (!root) return;
			if (enabled) {
				if (typeof root.removeAttribute === "function") root.removeAttribute(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE);
				else if (root.dataset) delete root.dataset.dshSidebarFooterBalanced;
			} else if (typeof root.setAttribute === "function") root.setAttribute(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE, "off");
			else if (root.dataset) root.dataset.dshSidebarFooterBalanced = "off";
			syncAllSidebarFooterSlots();
		}
		/** Install the footer layout sheet and balanced-grid observer; tolerate headless Client boot. */
		function installSidebarFooterStyles() {
			if (typeof document === "undefined") return () => {};
			let style = document.getElementById(STYLE_ID);
			if (style) style.textContent = CSS;
			else {
				style = document.createElement("style");
				style.id = STYLE_ID;
				style.dataset.plugin = "dsh-desktop-next";
				style.textContent = CSS;
				document.head.appendChild(style);
			}
			const observedResizeSlots = /* @__PURE__ */ new WeakSet();
			const observedMutationTargets = /* @__PURE__ */ new WeakSet();
			const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
				for (const entry of entries) if (entry.target instanceof HTMLElement) balanceSidebarFooterSlot(entry.target, Math.floor(entry.contentRect?.width ?? 0));
			}) : null;
			let scheduled = false;
			let bootstrapObserver = null;
			let bootstrapActive = false;
			const scheduleRefresh = () => {
				if (scheduled) return;
				scheduled = true;
				queueMicrotask(() => {
					scheduled = false;
					refresh();
				});
			};
			const slotMutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(() => {
				scheduleRefresh();
			}) : null;
			const refresh = () => {
				if (typeof document.querySelectorAll !== "function") return;
				const slots = document.querySelectorAll(FOOTER_SLOT_SELECTOR);
				if (slots.length === 0) {
					if (bootstrapObserver && !bootstrapActive && document.body) {
						bootstrapActive = true;
						bootstrapObserver.observe(document.body, {
							childList: true,
							subtree: true
						});
					}
					return;
				}
				if (bootstrapObserver && bootstrapActive) {
					bootstrapObserver.disconnect();
					bootstrapActive = false;
				}
				for (const slot of slots) {
					if (resizeObserver && !observedResizeSlots.has(slot)) {
						observedResizeSlots.add(slot);
						resizeObserver.observe(slot);
					}
					if (slotMutationObserver && !observedMutationTargets.has(slot)) {
						observedMutationTargets.add(slot);
						slotMutationObserver.observe(slot, {
							childList: true,
							subtree: true
						});
						if (slot.parentElement && !observedMutationTargets.has(slot.parentElement)) {
							observedMutationTargets.add(slot.parentElement);
							slotMutationObserver.observe(slot.parentElement, { childList: true });
						}
					}
					balanceSidebarFooterSlot(slot);
				}
			};
			bootstrapObserver = typeof MutationObserver !== "undefined" ? new MutationObserver((mutations) => {
				for (const mutation of mutations) for (let i = 0; i < mutation.addedNodes.length; i += 1) {
					const node = mutation.addedNodes[i];
					if (node instanceof Element && (node.matches?.(FOOTER_SLOT_SELECTOR) || node.querySelector?.(FOOTER_SLOT_SELECTOR) !== null)) {
						scheduleRefresh();
						return;
					}
				}
			}) : null;
			refresh();
			return () => {
				bootstrapObserver?.disconnect();
				slotMutationObserver?.disconnect();
				resizeObserver?.disconnect();
				style?.remove();
				setSidebarFooterCompat(true);
				setSidebarFooterBalanced(true);
			};
		}
		var DEFAULT_PREFERENCES = Object.freeze({
			closeToTray: true,
			macosMaterial: "transparent",
			windowsMaterial: "off",
			linuxMaterial: "off",
			browserAccess: false,
			networkExposure: "loopback",
			port: 0,
			lanPort: 0,
			logLevel: "info",
			developerLogging: false,
			sidebarFooterCompat: true,
			sidebarFooterBalanced: true,
			notifications: true,
			turnCompleted: true,
			turnFailed: true,
			jobCompleted: false,
			jobFailed: false,
			scheduleCompleted: true,
			scheduleFailed: true
		});
		Object.freeze({
			...DEFAULT_PREFERENCES,
			macosMaterial: "off",
			windowsMaterial: "off",
			linuxMaterial: "off",
			browserAccess: false,
			networkExposure: "loopback",
			port: 0,
			lanPort: 0,
			logLevel: "info",
			developerLogging: false,
			sidebarFooterCompat: true,
			sidebarFooterBalanced: true,
			notifications: false,
			turnCompleted: false,
			turnFailed: false,
			jobCompleted: false,
			jobFailed: false,
			scheduleCompleted: false,
			scheduleFailed: false
		});
		//#endregion
		//#region src/client/settings-adapter.ts
		var shellFields = {
			macosMaterial: "macosMaterial",
			windowsMaterial: "windowsMaterial",
			linuxMaterial: "linuxMaterial",
			port: "port",
			openBrowser: "browserAccess",
			networkExposure: "networkExposure",
			logLevel: "logLevel",
			sidebarFooterCompat: "sidebarFooterCompat",
			sidebarFooterBalanced: "sidebarFooterBalanced"
		};
		var notificationFields = {
			enabled: "notifications",
			notifyOnTurnCompletion: "turnCompleted",
			notifyOnTurnFailure: "turnFailed",
			notifyOnJobCompletion: "jobCompleted",
			notifyOnJobFailure: "jobFailed",
			notifyOnScheduleCompletion: "scheduleCompleted",
			notifyOnScheduleFailure: "scheduleFailed"
		};
		function projectSettings(state, links = {
			localUrl: null,
			lanUrls: []
		}) {
			const enabled = !state.safeMode && state.phase === "ready";
			const market = state.features.market ? "community-market" : "disabled";
			const lan = state.lan;
			const lanUrls = links.lanUrls;
			return {
				current: state.selected,
				profiles: state.profiles.map((name) => ({
					name,
					exists: true,
					webCapable: !state.unavailableProfiles.includes(name),
					selectable: !state.unavailableProfiles.includes(name),
					deletable: name !== state.selected && name !== "desktop"
				})),
				aa: {
					requested: state.features.remoteControl,
					effective: enabled && state.features.remoteControl
				},
				market: {
					requested: market,
					effective: enabled ? market : "disabled",
					legacyDefaulted: false
				},
				web: {
					localUrl: links.localUrl ?? "",
					lanUrls,
					lanState: lan?.state ?? "inactive",
					lanError: lan?.errorCode ?? null,
					lanCaFingerprint: lan?.caFingerprint ?? null,
					lanCaUrls: lanUrls.map((value) => new URL("/.well-known/dsh-desktop-ca.crt", value).href)
				}
			};
		}
		var NextSettingsAdapter = class {
			bridge;
			current;
			persisted;
			fallbackBalanced;
			pendingSaves = 0;
			listeners = /* @__PURE__ */ new Set();
			tail = Promise.resolve();
			reading;
			shellSnapshot = this.snapshot();
			notificationSnapshot = this.snapshot();
			constructor(bridge) {
				this.bridge = bridge;
			}
			getSnapshot = () => this.current;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			desktopSettings = {
				getSnapshot: () => this.shellSnapshot,
				subscribe: this.subscribe,
				set: (field, value) => this.setField(shellFields, field, value)
			};
			notificationSettings = {
				getSnapshot: () => this.notificationSnapshot,
				subscribe: this.subscribe,
				set: (field, value) => this.setField(notificationFields, field, value)
			};
			snapshot(value, writable = false) {
				return {
					status: value ? "ready" : "loading",
					value,
					base: void 0,
					user: void 0,
					revision: void 0,
					writable
				};
			}
			applyState(state) {
				if (JSON.stringify(state) === JSON.stringify(this.current)) return;
				const previous = this.current;
				this.current = state;
				const p = state.preferences;
				const shellWritable = !state.safeMode;
				const notificationWritable = !state.safeMode && state.notificationsAvailable;
				const nextShell = {
					mode: "compatibility",
					macosMaterial: p.macosMaterial,
					windowsMaterial: p.windowsMaterial,
					linuxMaterial: p.linuxMaterial,
					port: p.port,
					openBrowser: p.browserAccess,
					networkExposure: p.networkExposure,
					logLevel: p.logLevel,
					sidebarFooterCompat: p.sidebarFooterCompat ?? true,
					sidebarFooterBalanced: p.sidebarFooterBalanced ?? this.fallbackBalanced ?? true
				};
				const nextNotification = {
					enabled: p.notifications,
					notifyOnTurnCompletion: p.turnCompleted,
					notifyOnTurnFailure: p.turnFailed,
					notifyOnJobCompletion: p.jobCompleted,
					notifyOnJobFailure: p.jobFailed,
					notifyOnScheduleCompletion: p.scheduleCompleted,
					notifyOnScheduleFailure: p.scheduleFailed
				};
				if (!previous || this.shellSnapshot.writable !== shellWritable || JSON.stringify(this.shellSnapshot.value) !== JSON.stringify(nextShell)) this.shellSnapshot = this.snapshot(nextShell, shellWritable);
				if (!previous || this.notificationSnapshot.writable !== notificationWritable || JSON.stringify(this.notificationSnapshot.value) !== JSON.stringify(nextNotification)) this.notificationSnapshot = this.snapshot(nextNotification, notificationWritable);
				for (const listener of this.listeners) listener();
			}
			refresh = () => this.reading ??= this.bridge.state().then((state) => {
				this.persisted = state;
				if (this.pendingSaves === 0 || !this.current) this.applyState(state);
				return state;
			}).finally(() => {
				this.reading = void 0;
			});
			enqueue(operation) {
				const next = this.tail.then(operation);
				this.tail = next.catch(() => {});
				return next;
			}
			async settle() {
				await this.reading?.catch(() => {});
				return this.refresh();
			}
			command = (command) => this.enqueue(async () => {
				try {
					await this.bridge.command(command);
				} finally {
					await this.settle();
				}
			});
			savePreferences = (patch) => {
				this.pendingSaves += 1;
				if (this.current && !this.current.safeMode) {
					const requiresLanConfirm = patch.networkExposure === "lan" && (!this.current.preferences.browserAccess || this.current.preferences.networkExposure !== "lan");
					const requiresPortConfirm = patch.port !== void 0 && patch.port !== this.current.preferences.port || patch.lanPort !== void 0 && patch.lanPort !== this.current.preferences.lanPort;
					if (!requiresLanConfirm && !requiresPortConfirm) {
						const preferences = {
							...this.current.preferences,
							...patch
						};
						if (!preferences.browserAccess) preferences.networkExposure = "loopback";
						this.applyState({
							...this.current,
							preferences
						});
					}
				}
				return this.enqueue(async () => {
					try {
						const preferences = {
							...(this.persisted ?? await this.refresh()).preferences,
							...patch
						};
						if (!preferences.browserAccess) preferences.networkExposure = "loopback";
						try {
							await this.bridge.command({
								type: "preferences",
								preferences
							});
							if (patch.sidebarFooterBalanced !== void 0) this.fallbackBalanced = void 0;
						} catch (cause) {
							if (patch.sidebarFooterBalanced !== void 0 && cause instanceof Error && cause.message.includes("Unknown Desktop preference")) {
								this.fallbackBalanced = patch.sidebarFooterBalanced;
								const { sidebarFooterBalanced: _, ...legacyPreferences } = preferences;
								await this.bridge.command({
									type: "preferences",
									preferences: legacyPreferences
								});
							} else throw cause;
						}
					} finally {
						this.pendingSaves -= 1;
						await this.settle();
					}
				});
			};
			/**
			* dsh 0.1.7's ConfigForm.set resolves true for Host acceptance and false for a
			* refused or skipped write; this bridge has no refusal path — a rejected save
			* rejects here — so a settled save is always an acceptance.
			*/
			setField(fields, field, value) {
				const key = Object.hasOwn(fields, field) ? fields[field] : void 0;
				if (!key) return Promise.reject(/* @__PURE__ */ new Error("Unsupported Desktop preference"));
				return this.savePreferences({ [key]: value }).then(() => true);
			}
			async readSettings() {
				return projectSettings(await this.refresh(), await this.bridge.browserLinks());
			}
			api = {
				read: () => this.readSettings(),
				createProfile: async (name) => {
					await this.command({
						type: "create",
						name
					});
					return this.readSettings();
				},
				deleteProfile: async (name) => {
					await this.command({
						type: "delete",
						name
					});
					return this.readSettings();
				},
				selectProfile: async (name) => {
					await this.command({
						type: "switch",
						name
					});
					return {
						accepted: true,
						restartRequired: false
					};
				},
				selectMarket: async () => {
					throw new Error("Manage markets in the Plugins page");
				},
				openBrowser: (url) => this.command({
					type: "open-browser-url",
					url
				}),
				copyBrowser: (url) => this.command({
					type: "copy-browser-url",
					url
				}),
				openTerminal: () => this.command({ type: "terminal" }),
				restart: () => this.command({ type: "restart-app" }),
				restartToRecovery: () => this.command({ type: "restart-recovery" }),
				reloadRenderer: () => this.command({ type: "reload" }),
				toggleDeveloperTools: () => this.command({ type: "devtools" }),
				checkForUpdates: () => this.command({ type: "check-updates" }),
				exportDiagnostics: () => this.command({ type: "diagnostics" })
			};
		};
		//#endregion
		//#region node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var mergeClasses$1 = (...classes) => classes.filter((className, index, array) => {
			return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
		}).join(" ").trim();
		//#endregion
		//#region node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toKebabCase$1 = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
		//#endregion
		//#region node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toCamelCase$1 = (string) => string.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase());
		//#endregion
		//#region node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toPascalCase$1 = (string) => {
			const camelCase = toCamelCase$1(string);
			return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
		};
		//#endregion
		//#region node_modules/lucide-react/dist/esm/defaultAttributes.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var defaultAttributes$1 = {
			xmlns: "http://www.w3.org/2000/svg",
			width: 24,
			height: 24,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		//#endregion
		//#region node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var hasA11yProp$1 = (props) => {
			for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
			return false;
		};
		//#endregion
		//#region node_modules/lucide-react/dist/esm/context.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var LucideContext$1 = (0, react.createContext)({});
		var useLucideContext$1 = () => (0, react.useContext)(LucideContext$1);
		//#endregion
		//#region node_modules/lucide-react/dist/esm/Icon.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Icon$1 = (0, react.forwardRef)(({ color, size, strokeWidth, absoluteStrokeWidth, className = "", children, iconNode, ...rest }, ref) => {
			const { size: contextSize = 24, strokeWidth: contextStrokeWidth = 2, absoluteStrokeWidth: contextAbsoluteStrokeWidth = false, color: contextColor = "currentColor", className: contextClass = "" } = useLucideContext$1() ?? {};
			const calculatedStrokeWidth = absoluteStrokeWidth ?? contextAbsoluteStrokeWidth ? Number(strokeWidth ?? contextStrokeWidth) * 24 / Number(size ?? contextSize) : strokeWidth ?? contextStrokeWidth;
			return (0, react.createElement)("svg", {
				ref,
				...defaultAttributes$1,
				width: size ?? contextSize ?? defaultAttributes$1.width,
				height: size ?? contextSize ?? defaultAttributes$1.height,
				stroke: color ?? contextColor,
				strokeWidth: calculatedStrokeWidth,
				className: mergeClasses$1("lucide", contextClass, className),
				...!children && !hasA11yProp$1(rest) && { "aria-hidden": "true" },
				...rest
			}, [...iconNode.map(([tag, attrs]) => (0, react.createElement)(tag, attrs)), ...Array.isArray(children) ? children : [children]]);
		});
		//#endregion
		//#region node_modules/lucide-react/dist/esm/createLucideIcon.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var createLucideIcon$1 = (iconName, iconNode) => {
			const Component = (0, react.forwardRef)(({ className, ...props }, ref) => (0, react.createElement)(Icon$1, {
				ref,
				iconNode,
				className: mergeClasses$1(`lucide-${toKebabCase$1(toPascalCase$1(iconName))}`, `lucide-${iconName}`, className),
				...props
			}));
			Component.displayName = toPascalCase$1(iconName);
			return Component;
		};
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Check = createLucideIcon$1("check", [["path", {
			d: "M20 6 9 17l-5-5",
			key: "1gmf2c"
		}]]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Copy = createLucideIcon$1("copy", [["rect", {
			width: "14",
			height: "14",
			x: "8",
			y: "8",
			rx: "2",
			ry: "2",
			key: "17jyea"
		}], ["path", {
			d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
			key: "zix9uf"
		}]]);
		//#endregion
		//#region ../dsh-plugin-desktop/src/desktop-network.ts
		/** Browser access can only be granted by an explicitly selected compatibility shell. */
		function desktopBrowserAccessAvailable(mode) {
			return mode === "compatibility";
		}
		/**
		* Resolve browser access while preserving already-exposed legacy LAN setups
		* only when the selected shell is compatible with an ordinary browser.
		*/
		function desktopBrowserAccessEnabled(mode, storedOpenBrowser, exposure) {
			return desktopBrowserAccessAvailable(mode) && (storedOpenBrowser || exposure === "lan");
		}
		//#endregion
		//#region src/client/DesktopSettingsSection.tsx
		/** Desktop-owned settings section registered into the official Settings shell. */
		var LAN_POLL_INTERVAL_MS = 250;
		var LAN_POLL_MAX_READS = 21;
		var LAN_STATE_LOCALE_KEYS = {
			inactive: "lanStatusInactive",
			starting: "lanStatusStarting",
			ready: "lanStatusReady",
			failed: "lanStatusFailed"
		};
		function waitForLanPoll(signal) {
			return new Promise((resolve, reject) => {
				if (signal.aborted) {
					reject(signal.reason);
					return;
				}
				const timer = setTimeout(() => {
					signal.removeEventListener("abort", cancel);
					resolve();
				}, LAN_POLL_INTERVAL_MS);
				const cancel = () => {
					clearTimeout(timer);
					reject(signal.reason);
				};
				signal.addEventListener("abort", cancel, { once: true });
			});
		}
		function isAbortError(cause) {
			return cause instanceof Error && cause.name === "AbortError";
		}
		/** Refresh Host state, briefly following an in-flight hot LAN transition. */
		async function readDesktopSettingsUntilLanSettled(api, publish, signal, wait = waitForLanPoll) {
			let latest;
			for (let read = 0; read < LAN_POLL_MAX_READS; read += 1) {
				signal.throwIfAborted();
				latest = await api.read();
				signal.throwIfAborted();
				publish(latest);
				if (latest.web.lanState !== "starting" || read === 20) return latest;
				await wait(signal);
			}
			throw new Error("dsh-plugin-desktop: unreachable LAN settings polling state");
		}
		/** Persist ordinary-browser permission and refresh the already-running edge. */
		async function persistDesktopBrowserAccessHot(settings, checked, currentExposure, refresh) {
			if (!checked && currentExposure === "lan") await settings.set("networkExposure", "loopback");
			await settings.set("openBrowser", checked);
			return refresh();
		}
		/** Persist LAN intent and refresh its hot HTTPS ingress state. */
		async function persistDesktopNetworkExposureHot(settings, exposure, refresh) {
			await settings.set("networkExposure", exposure);
			return refresh();
		}
		/** URLs are advertised only after the user explicitly enables browser access. */
		function desktopBrowserUrlsShouldRender(browserAccess, _networkExposure) {
			return browserAccess;
		}
		/** Keep cancellation side-effect free; only explicit confirmation enables LAN. */
		function resolveDesktopLanConfirmation(confirmed, dismiss, enableLan) {
			dismiss();
			if (confirmed) enableLan();
		}
		function useScope(scope) {
			const subscribe = (0, react.useCallback)((listener) => scope.subscribe(listener), [scope]);
			const snapshot = (0, react.useCallback)(() => scope.getSnapshot(), [scope]);
			return (0, react.useSyncExternalStore)(subscribe, snapshot);
		}
		function Choice({ title, body, aside, selected, reselectable, disabled, action, status, badge }) {
			const actionable = disabled !== true && (!selected || reselectable === true);
			const choose = () => {
				if (actionable) action();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "radio",
				className: "dshDesktopSettingsChoice",
				"data-selected": selected ? "true" : void 0,
				"data-actionable": actionable ? "true" : void 0,
				"aria-checked": selected,
				"aria-disabled": disabled === true ? "true" : void 0,
				tabIndex: disabled === true ? -1 : 0,
				onClick: choose,
				onKeyDown: (event) => {
					if (event.target !== event.currentTarget || event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					choose();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dshDesktopSettingsChoiceCopy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshDesktopSettingsChoiceTitle",
						children: [
							title,
							badge !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshDesktopSettingsBadge",
								children: badge
							}),
							status !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshDesktopSettingsBadge",
								children: status
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshDesktopSettingsChoiceBody",
						children: body
					})]
				}), aside]
			});
		}
		function RepositoryLink({ href, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				className: "dshDesktopSettingsChoiceLink",
				href,
				target: "_blank",
				rel: "noopener noreferrer",
				onClick: (event) => {
					event.stopPropagation();
				},
				children
			});
		}
		function DesktopSettingsSelect({ value, options, disabled, ariaLabel, onChange }) {
			const [open, setOpen] = (0, react.useState)(false);
			const selected = options.find((option) => option.value === value) ?? options[0];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: options.map((option) => ({
					id: option.value,
					label: option.label
				})),
				selectedId: value,
				onSelect: (id) => {
					setOpen(false);
					if (id !== value) onChange(id);
				},
				align: "end",
				portal: true,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dshDesktopSettingsSelect",
					"aria-label": ariaLabel,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					disabled,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: selected?.label ?? value }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: "dshDesktopSettingsSelectChevron" })]
				})
			});
		}
		function DesktopSettingsToggleRow({ label, description, titleId, badge, checked, disabled, onChange, expander }) {
			const generatedId = (0, react.useId)();
			const labelId = titleId ?? generatedId;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopSettingsToggleRow",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dshDesktopSettingsToggleCopy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshDesktopSettingsToggleLabel",
						id: labelId,
						children: [label, badge !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshDesktopSettingsBadge",
							children: badge
						})]
					}), description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshDesktopSettingsToggleDescription",
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshDesktopSettingsToggleControl",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "switch",
						className: "dshDesktopSettingsToggle",
						"aria-checked": checked,
						"aria-labelledby": labelId,
						disabled,
						onClick: () => {
							onChange(!checked);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshDesktopSettingsToggleKnob",
							"aria-hidden": "true"
						})
					}), expander !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopSettingsExpander",
						"aria-label": expander.label,
						title: expander.label,
						"aria-expanded": expander.open,
						"aria-controls": expander.controls,
						onClick: expander.onToggle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })
					})]
				})]
			});
		}
		function profileState(profile, t) {
			if (!profile.exists || !profile.webCapable || !profile.selectable) return t("profileUnavailable");
			return t("profileReady");
		}
		var MARKET_OPTIONS = [
			{
				id: "disabled",
				title: "marketDisabled",
				body: "marketDisabledBody"
			},
			{
				id: "community-market",
				title: "communityMarket",
				body: "communityMarketBody"
			},
			{
				id: "dsh-market",
				title: "dshMarket",
				body: "dshMarketBody"
			}
		];
		var COMMUNITY_MARKET_URL = "https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market";
		var DSH_MARKET_URL = "https://github.com/dsh-market/dsh-market";
		var AWESOME_DSH_PLUGIN_URL = "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin";
		function marketTitle(option, t) {
			if (option.id === "community-market") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryLink, {
				href: COMMUNITY_MARKET_URL,
				children: t(option.title)
			});
			if (option.id === "dsh-market") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryLink, {
				href: DSH_MARKET_URL,
				children: t(option.title)
			});
			return t(option.title);
		}
		function marketBody(option, t) {
			if (option.id !== "dsh-market") return t(option.body);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				t(option.body),
				" ",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RepositoryLink, {
					href: AWESOME_DSH_PLUGIN_URL,
					children: "awesome-dsh-plugin"
				})
			] });
		}
		function DesktopBrowserUrl({ url, api, t, onOpen }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!copied) return;
				const timer = setTimeout(() => setCopied(false), 2e3);
				return () => clearTimeout(timer);
			}, [copied]);
			const link = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				href: url,
				onClick: onOpen,
				target: "_blank",
				rel: "noopener noreferrer",
				children: url
			});
			if (!api.copyBrowser) return link;
			const copy = async () => {
				setBusy(true);
				setFailed(false);
				setCopied(false);
				try {
					await api.copyBrowser(url);
					setCopied(true);
				} catch {
					setFailed(true);
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopSettingsUrlRow",
				children: [link, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dshDesktopSettingsUrlCopy",
					disabled: busy,
					"aria-label": `${t("copyBrowserUrl")} ${new URL(url).host}`,
					title: t(copied ? "browserUrlCopied" : "copyBrowserUrl"),
					onClick: () => {
						copy();
					},
					children: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, { size: 16 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Copy, { size: 16 })
				})]
			}), failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "alert",
				className: "dshDesktopSettingsError",
				children: t("operationFailed")
			})] });
		}
		/** Render the Desktop settings page. */
		function DesktopSettingsSection({ t, close, api, platform, version, initialMode, setMode: persistMode, desktopSettings, notificationSettings, capabilities, openPlugins, introNotice, browserActions, extraSections }) {
			const desktop = useScope(desktopSettings);
			const notifications = useScope(notificationSettings);
			const [view, setView] = (0, react.useState)();
			const [profileName, setProfileName] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)("load");
			const [loadFailed, setLoadFailed] = (0, react.useState)(false);
			const [operationFailed, setOperationFailed] = (0, react.useState)(false);
			const [aaStatus, setAaStatus] = (0, react.useState)("idle");
			const [restart, setRestart] = (0, react.useState)("none");
			const [pendingProfileDelete, setPendingProfileDelete] = (0, react.useState)();
			const [confirmLan, setConfirmLan] = (0, react.useState)(false);
			const [sidebarFooterOpen, setSidebarFooterOpen] = (0, react.useState)(false);
			const sidebarFooterRegionId = (0, react.useId)();
			const [notificationsOpen, setNotificationsOpen] = (0, react.useState)(false);
			const notificationsRegionId = (0, react.useId)();
			const [updateCheck, setUpdateCheck] = (0, react.useState)("idle");
			const lanPoll = (0, react.useRef)();
			const publishView = (0, react.useCallback)((next) => {
				setView((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
			}, []);
			const refreshView = (0, react.useCallback)(async () => {
				lanPoll.current?.abort();
				const controller = new AbortController();
				lanPoll.current = controller;
				try {
					return await readDesktopSettingsUntilLanSettled(api, publishView, controller.signal);
				} finally {
					if (lanPoll.current === controller) lanPoll.current = void 0;
				}
			}, [api, publishView]);
			const load = (0, react.useCallback)(async () => {
				setBusy("load");
				setLoadFailed(false);
				setOperationFailed(false);
				try {
					await refreshView();
				} catch (cause) {
					if (!isAbortError(cause)) setLoadFailed(true);
				} finally {
					setBusy((current) => current === "load" ? void 0 : current);
				}
			}, [refreshView]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => () => {
				lanPoll.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (restart !== "restarting") return;
				const timer = setTimeout(() => {
					setRestart("required");
				}, 8e3);
				return () => {
					clearTimeout(timer);
				};
			}, [restart]);
			const run = (0, react.useCallback)(async (operation, invoke) => {
				setBusy(operation);
				setOperationFailed(false);
				if (operation !== "select-aa") setAaStatus("idle");
				try {
					await invoke();
				} catch {
					setOperationFailed(true);
				} finally {
					setBusy((current) => current === operation ? void 0 : current);
				}
			}, []);
			const runPreference = (0, react.useCallback)(async (invoke) => {
				setOperationFailed(false);
				try {
					await invoke();
				} catch {
					setOperationFailed(true);
				}
			}, []);
			const requestRestart = () => {
				setRestart("restarting");
			};
			const profileBusy = busy === "load" || busy === "create-profile" || busy === "select-profile" || busy === "delete-profile";
			const settingsWritable = desktop.status === "ready" && desktop.writable;
			const notificationsWritable = notifications.status === "ready" && notifications.writable;
			const storedMode = desktop.value?.mode ?? initialMode;
			const configuredNetworkExposure = desktop.value?.networkExposure ?? "loopback";
			const browserAccess = desktopBrowserAccessEnabled(storedMode, desktop.value?.openBrowser ?? false, configuredNetworkExposure);
			const mode = storedMode;
			const networkExposure = browserAccess ? configuredNetworkExposure : "loopback";
			const notificationValue = notifications.value ?? {
				enabled: true,
				notifyOnTurnCompletion: true,
				notifyOnTurnFailure: true,
				notifyOnJobCompletion: true,
				notifyOnJobFailure: true,
				notifyOnScheduleCompletion: true,
				notifyOnScheduleFailure: true
			};
			const createProfile = (event) => {
				event.preventDefault();
				const name = profileName.trim();
				if (name.length === 0) return;
				run("create-profile", async () => {
					setView(await api.createProfile(name));
					setProfileName("");
				});
			};
			const selectProfile = (name) => {
				run("select-profile", async () => {
					if ((await api.selectProfile(name)).restartRequired) requestRestart();
					else setView(await refreshView());
				});
			};
			const deleteProfile = (name) => {
				run("delete-profile", async () => {
					setView(await api.deleteProfile(name));
					setPendingProfileDelete(void 0);
				});
			};
			const selectAa = (enabled) => {
				setAaStatus("saving");
				run("select-aa", async () => {
					try {
						if (!api.selectAa) throw new Error("AA selection is unavailable");
						const response = await api.selectAa(enabled);
						setView((current) => current === void 0 ? current : {
							...current,
							aa: {
								requested: enabled,
								effective: current.aa?.effective ?? false
							}
						});
						setAaStatus("saved");
						if (response.restartRequired) requestRestart();
						else setView(await refreshView());
					} catch (cause) {
						setAaStatus("failed");
						throw cause;
					}
				});
			};
			const selectMarket = (provider) => {
				run("select-market", async () => {
					const response = await api.selectMarket(provider);
					setView((current) => current === void 0 ? current : {
						...current,
						market: {
							requested: provider,
							effective: current.market.effective,
							legacyDefaulted: false
						}
					});
					if (response.restartRequired) requestRestart();
					else setView(await refreshView());
				});
			};
			const openBrowser = (event, url) => {
				if (!api.openBrowser) return;
				event.preventDefault();
				runPreference(() => api.openBrowser(url));
			};
			const setMode = (next) => {
				run("mode", async () => {
					await persistMode(next);
					requestRestart();
				});
			};
			const setMaterial = (next) => {
				runPreference(async () => {
					if (platform === "darwin") {
						if (next !== "off" && next !== "transparent") throw new Error(`dsh-plugin-desktop: invalid macOS material ${JSON.stringify(next)}`);
						await desktopSettings.set("macosMaterial", next);
					} else if (platform === "linux") {
						if (next !== "off" && next !== "transparent") throw new Error(`dsh-plugin-desktop: invalid Linux material ${JSON.stringify(next)}`);
						await desktopSettings.set("linuxMaterial", next);
					}
					if (capabilities?.materialRequiresRestart !== false) requestRestart();
				});
			};
			const setNotification = (field, checked) => {
				runPreference(async () => {
					await notificationSettings.set(field, checked);
				});
			};
			const runUpdateCheck = () => {
				setUpdateCheck("checking");
				api.checkForUpdates().then(() => {
					setUpdateCheck("idle");
				}).catch(() => {
					setUpdateCheck("failed");
				});
			};
			const setBrowserAccess = (checked) => {
				runPreference(async () => {
					if (checked) {
						if (!desktopBrowserAccessAvailable(mode)) return;
						await persistDesktopBrowserAccessHot(desktopSettings, true, configuredNetworkExposure, refreshView);
						return;
					}
					await persistDesktopBrowserAccessHot(desktopSettings, false, configuredNetworkExposure, refreshView);
				});
			};
			const setNetworkExposure = (exposure) => {
				runPreference(async () => {
					if (exposure === "lan" && (!desktopBrowserAccessAvailable(mode) || !browserAccess)) return;
					await persistDesktopNetworkExposureHot(desktopSettings, exposure, refreshView);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopSettings",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dshDesktopSettingsHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("intro") })]
					}),
					introNotice ?? (capabilities?.pluginSelectors === false && openPlugins !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshDesktopSettingsNotice dshNextPluginSettingsNotice",
						"data-next-plugin-settings-notice": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("pluginSettingsMovedNotice") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
							onClick: () => {
								openPlugins();
								close?.();
							},
							children: t("goToPlugins")
						})]
					})),
					operationFailed && aaStatus !== "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshDesktopSettingsError",
						role: "alert",
						children: t("operationFailed")
					}),
					restart !== "none" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshDesktopSettingsSuccess",
						role: "status",
						children: t(restart === "restarting" ? "restarting" : "restartRequired")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-profile-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-profile-title",
								children: t("profileTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("profileIntro")
							})] }),
							busy === "load" && view === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsHint",
								children: t("loading")
							}),
							loadFailed && view === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsError",
								role: "alert",
								children: t("unavailable")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshDesktopSettingsButton",
								onClick: () => {
									load();
								},
								children: t("retry")
							})] }),
							view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshDesktopSettingsList",
								role: "radiogroup",
								"aria-labelledby": "dsh-desktop-profile-title",
								children: view.profiles.map((profile) => {
									const current = profile.name === view.current;
									const deleteAction = profile.deletable && !current && restart === "none" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshDesktopSettingsChoiceAside",
										onClick: (event) => {
											event.stopPropagation();
										},
										children: pendingProfileDelete === profile.name ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dshDesktopSettingsDeleteConfirm",
											role: "group",
											"aria-label": t("confirmDeleteProfile"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshDesktopSettingsDeleteWarning",
												children: t("deleteProfileWarning")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dshDesktopSettingsDeleteActions",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dshDesktopSettingsButton dshDesktopSettingsButtonDanger",
													disabled: profileBusy,
													onClick: () => {
														deleteProfile(profile.name);
													},
													children: busy === "delete-profile" ? t("deletingProfile") : t("confirmDeleteProfile")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
													disabled: profileBusy,
													onClick: () => {
														setPendingProfileDelete(void 0);
													},
													children: t("cancelDeleteProfile")
												})]
											})]
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
											disabled: profileBusy,
											onClick: () => {
												setPendingProfileDelete(profile.name);
											},
											children: t("deleteProfile")
										})
									}) : void 0;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
										title: profile.name,
										body: profileState(profile, t),
										selected: current,
										disabled: !profile.selectable || profileBusy || restart !== "none",
										action: () => {
											selectProfile(profile.name);
										},
										status: current ? t("activeProfile") : void 0,
										aside: deleteAction
									}, profile.name);
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								className: "dshDesktopSettingsForm",
								onSubmit: createProfile,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dshDesktopSettingsField",
									children: [t("profileName"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dshDesktopSettingsInput",
										value: profileName,
										maxLength: 128,
										autoComplete: "off",
										placeholder: t("profileNamePlaceholder"),
										disabled: profileBusy || restart !== "none",
										onChange: (event) => {
											setProfileName(event.currentTarget.value);
										}
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									className: "dshDesktopSettingsButton",
									disabled: profileName.trim().length === 0 || profileBusy || restart !== "none",
									children: busy === "create-profile" ? t("creatingProfile") : t("create")
								})]
							})] })
						]
					}),
					capabilities?.pluginSelectors !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-market-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-market-title",
								children: t("marketTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("marketIntro")
							})] }),
							view?.market.legacyDefaulted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								children: t("legacyMarketNotice")
							}),
							view !== void 0 && view.market.requested !== view.market.effective && restart === "none" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								role: "status",
								children: t("marketLoadFailed")
							}),
							view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshDesktopSettingsList",
								role: "radiogroup",
								"aria-labelledby": "dsh-desktop-market-title",
								children: MARKET_OPTIONS.filter((option) => capabilities?.markets === void 0 || capabilities.markets.includes(option.id)).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
									title: marketTitle(option, t),
									badge: option.id === "community-market" ? t("beta") : void 0,
									body: marketBody(option, t),
									selected: view.market.requested === option.id,
									reselectable: view.market.requested === option.id && view.market.requested !== view.market.effective,
									disabled: capabilities?.featuresReadOnly === true || busy !== void 0 || restart !== "none",
									action: () => {
										selectMarket(option.id);
									},
									status: view.market.requested === option.id && view.market.requested !== view.market.effective ? t("retryMarket") : view.market.requested === option.id ? t("selected") : void 0
								}, option.id))
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-aa-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-aa-title",
								children: t("aaTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("aaIntro")
							})] }),
							view?.aa?.requested === true && !view.aa.effective && restart === "none" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								role: "status",
								children: t("aaLoadFailed")
							}),
							aaStatus === "saving" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								role: "status",
								children: t("aaSaving")
							}),
							aaStatus === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsError",
								role: "alert",
								children: t("aaSaveFailed")
							}),
							aaStatus === "saved" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsSuccess",
								role: "status",
								children: t(restart === "restarting" ? "restarting" : restart === "required" ? "restartRequired" : "aaSaved")
							}),
							view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshDesktopSettingsList",
								role: "radiogroup",
								"aria-labelledby": "dsh-desktop-aa-title",
								children: [false, true].map((enabled) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
									title: t(enabled ? "aaEnabled" : "aaDisabled"),
									badge: enabled ? t("beta") : void 0,
									body: t(enabled ? "aaEnabledBody" : "aaDisabledBody"),
									selected: (view.aa?.requested ?? false) === enabled,
									reselectable: enabled && view.aa?.requested === true && !view.aa.effective,
									disabled: capabilities?.featuresReadOnly === true || busy !== void 0 || restart !== "none",
									action: () => {
										selectAa(enabled);
									},
									status: enabled && view.aa?.requested === true && !view.aa.effective ? t("retryAa") : (view.aa?.requested ?? false) === enabled ? t("selected") : void 0
								}, String(enabled)))
							})
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-presentation-title",
						children: [
							capabilities?.windowModes !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-presentation-title",
								children: t("presentationTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("presentationIntro")
							})] }),
							desktop.status === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								children: t("readOnly")
							}),
							capabilities?.windowModes !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsList",
								role: "radiogroup",
								"aria-labelledby": "dsh-desktop-presentation-title",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
										title: t("compatibilityMode"),
										body: t("compatibilityModeBody"),
										selected: mode === "compatibility",
										disabled: !settingsWritable || busy !== void 0 || restart !== "none",
										action: () => {
											setMode("compatibility");
										},
										status: mode === "compatibility" ? t("selected") : void 0
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
										title: t("extendedMode"),
										body: platform === "linux" ? t("extendedUnavailableLinux") : t("extendedModeBody"),
										selected: mode === "extended",
										disabled: platform === "linux" || !settingsWritable || busy !== void 0 || restart !== "none",
										action: () => {
											setMode("extended");
										},
										status: mode === "extended" ? t("selected") : void 0
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
										title: t("advancedMode"),
										body: platform === "linux" ? t("advancedUnavailableLinux") : t("advancedModeBody"),
										selected: mode === "advanced",
										disabled: platform === "linux" || !settingsWritable || busy !== void 0 || restart !== "none",
										action: () => {
											setMode("advanced");
										},
										status: mode === "advanced" ? t("selected") : void 0
									})
								]
							}),
							platform === "darwin" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsMaterialField",
								"data-desktop-material-row": "",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshDesktopSettingsMaterialCopy",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										id: capabilities?.windowModes === false ? "dsh-desktop-presentation-title" : void 0,
										className: "dshDesktopSettingsChoiceTitle",
										children: t("windowMaterial")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceBody",
										children: t("windowMaterialBody")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsSelect, {
									value: desktop.value?.macosMaterial ?? "transparent",
									ariaLabel: t("windowMaterial"),
									disabled: !settingsWritable || restart !== "none",
									options: [{
										value: "off",
										label: t("windowMaterialOff")
									}, {
										value: "transparent",
										label: t("windowMaterialTransparent")
									}],
									onChange: setMaterial
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsExpandableGroup",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
									titleId: capabilities?.windowModes === false && platform !== "darwin" ? "dsh-desktop-presentation-title" : void 0,
									label: t("sidebarFooterCompat"),
									description: t("sidebarFooterCompatBody"),
									checked: desktop.value?.sidebarFooterCompat !== false,
									disabled: !settingsWritable || restart !== "none",
									onChange: (checked) => {
										runPreference(async () => {
											await desktopSettings.set("sidebarFooterCompat", checked);
										});
									},
									expander: {
										open: sidebarFooterOpen,
										controls: sidebarFooterRegionId,
										label: t("sidebarFooterCompat"),
										onToggle: () => {
											setSidebarFooterOpen((open) => !open);
										}
									}
								}), sidebarFooterOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									id: sidebarFooterRegionId,
									className: "dshDesktopSettingsExpandedRows",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("sidebarFooterBalanced"),
										description: t("sidebarFooterBalancedBody"),
										checked: desktop.value?.sidebarFooterBalanced !== false,
										disabled: desktop.value?.sidebarFooterCompat === false || !settingsWritable || restart !== "none",
										onChange: (checked) => {
											runPreference(async () => {
												await desktopSettings.set("sidebarFooterBalanced", checked);
											});
										}
									})
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-web-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-web-title",
								children: t("webTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("webIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
								label: t("openBrowser"),
								checked: browserAccess,
								disabled: !desktopBrowserAccessAvailable(mode) || !settingsWritable,
								onChange: setBrowserAccess
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								children: t("browserCompatibilityNotice")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
								label: t("lanAccess"),
								badge: t("beta"),
								checked: networkExposure === "lan",
								disabled: !browserAccess || !settingsWritable,
								onChange: (checked) => {
									if (checked && capabilities?.nativeLanConfirmation !== true) setConfirmLan(true);
									else if (checked) setNetworkExposure("lan");
									else setNetworkExposure("loopback");
								}
							}),
							view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsLanStatus",
								"data-state": view.web.lanState,
								role: "status",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshDesktopSettingsChoiceTitle",
									children: [t("lanStatus"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsBadge",
										children: t(LAN_STATE_LOCALE_KEYS[view.web.lanState])
									})]
								}), view.web.lanError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshDesktopSettingsChoiceBody",
									children: [
										t("lanError"),
										": ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: view.web.lanError })
									]
								})]
							}),
							desktopBrowserUrlsShouldRender(browserAccess, networkExposure) && view !== void 0 && view.web.localUrl !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsUrls",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceTitle",
										children: t("browserUrls")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopBrowserUrl, {
										url: view.web.localUrl,
										api,
										t,
										onOpen: (event) => openBrowser(event, view.web.localUrl)
									}, view.web.localUrl),
									view.web.lanUrls.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceTitle",
										children: t("lanHttpsUrls")
									}),
									view.web.lanUrls.map((url) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopBrowserUrl, {
										url,
										api,
										t,
										onOpen: (event) => openBrowser(event, url)
									}, url))
								]
							}),
							browserActions,
							networkExposure === "lan" && view !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsNotice",
								children: t("lanTrustNotice")
							}), (view.web.lanCaFingerprint !== null || view.web.lanCaUrls.length > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsUrls",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceTitle",
										children: t("lanCaTitle")
									}),
									view.web.lanCaFingerprint !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dshDesktopSettingsLanFingerprint",
										children: [
											t("lanCaFingerprint"),
											": ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: view.web.lanCaFingerprint })
										]
									}),
									view.web.lanCaUrls.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceBody",
										children: t("lanCaDownloads")
									}),
									view.web.lanCaUrls.map((url) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: url,
										target: "_blank",
										rel: "noopener noreferrer",
										children: url
									}, url))
								]
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-notifications-title",
						children: [notifications.status === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshDesktopSettingsNotice",
							children: t("readOnly")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsExpandableGroup",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
								titleId: "dsh-desktop-notifications-title",
								label: t("notificationsEnabled"),
								description: t("notificationsIntro"),
								checked: notificationValue.enabled,
								disabled: !notificationsWritable,
								onChange: (checked) => {
									setNotification("enabled", checked);
								},
								expander: {
									open: notificationsOpen,
									controls: notificationsRegionId,
									label: t("notificationsTitle"),
									onToggle: () => {
										setNotificationsOpen((open) => !open);
									}
								}
							}), notificationsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								id: notificationsRegionId,
								className: "dshDesktopSettingsExpandedRows",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("turnCompletion"),
										checked: notificationValue.notifyOnTurnCompletion,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnTurnCompletion", checked);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("turnFailure"),
										checked: notificationValue.notifyOnTurnFailure,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnTurnFailure", checked);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("scheduleCompletion"),
										checked: notificationValue.notifyOnScheduleCompletion,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnScheduleCompletion", checked);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("scheduleFailure"),
										checked: notificationValue.notifyOnScheduleFailure,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnScheduleFailure", checked);
										}
									}),
									capabilities?.jobNotifications !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("jobCompletion"),
										checked: notificationValue.notifyOnJobCompletion,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnJobCompletion", checked);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
										label: t("jobFailure"),
										checked: notificationValue.notifyOnJobFailure,
										disabled: !notificationValue.enabled || !notificationsWritable,
										onChange: (checked) => {
											setNotification("notifyOnJobFailure", checked);
										}
									})] })
								]
							})]
						})]
					}),
					capabilities?.updates !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-updates-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-updates-title",
								children: t("updatesTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsGroupIntro",
								children: t("updatesIntro")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsUpdateRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshDesktopSettingsChoiceCopy",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceTitle",
										children: t("currentVersion")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshDesktopSettingsChoiceBody",
										children: `v${version}`
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshDesktopSettingsButton",
									disabled: updateCheck === "checking",
									onClick: runUpdateCheck,
									children: t(updateCheck === "checking" ? "checkingForUpdates" : "checkForUpdates")
								})]
							}),
							updateCheck === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshDesktopSettingsError",
								role: "alert",
								children: t("checkForUpdatesError")
							})
						]
					}),
					capabilities?.logging !== false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"aria-labelledby": "dsh-desktop-logging-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								id: "dsh-desktop-logging-title",
								children: t("loggingTitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
								label: t("developerLogging"),
								description: t("developerLoggingBody"),
								checked: desktop.value?.developerLogging === true,
								disabled: !settingsWritable,
								onChange: (checked) => {
									runPreference(async () => {
										await desktopSettings.set("developerLogging", checked);
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshDesktopSettingsToggleRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshDesktopSettingsToggleLabel",
									children: t("logLevel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsSelect, {
									value: desktop.value?.logLevel ?? "info",
									ariaLabel: t("logLevel"),
									disabled: !settingsWritable,
									options: [
										{
											value: "debug",
											label: "Debug"
										},
										{
											value: "info",
											label: "Info"
										},
										{
											value: "warn",
											label: "Warn"
										},
										{
											value: "error",
											label: "Error"
										}
									],
									onChange: (value) => {
										runPreference(async () => {
											await desktopSettings.set("logLevel", value);
										});
									}
								})]
							})
						]
					}),
					extraSections,
					confirmLan && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshDesktopSettingsDialogBackdrop",
						role: "presentation",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsDialog",
							role: "alertdialog",
							"aria-modal": "true",
							"aria-labelledby": "dsh-desktop-lan-warning-title",
							"aria-describedby": "dsh-desktop-lan-warning-body",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "dsh-desktop-lan-warning-title",
									children: t("lanWarningTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: "dsh-desktop-lan-warning-body",
									children: t("lanWarningBody")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshDesktopSettingsDialogActions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
										onClick: () => {
											resolveDesktopLanConfirmation(false, () => {
												setConfirmLan(false);
											}, () => {
												setNetworkExposure("lan");
											});
										},
										children: t("lanCancel")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dshDesktopSettingsButton dshDesktopSettingsButtonDanger",
										onClick: () => {
											resolveDesktopLanConfirmation(true, () => {
												setConfirmLan(false);
											}, () => {
												setNetworkExposure("lan");
											});
										},
										children: t("lanConfirm")
									})]
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var mergeClasses = (...classes) => classes.filter((className, index, array) => {
			return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
		}).join(" ").trim();
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toCamelCase = (string) => string.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase());
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var toPascalCase = (string) => {
			const camelCase = toCamelCase(string);
			return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
		};
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/defaultAttributes.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var defaultAttributes = {
			xmlns: "http://www.w3.org/2000/svg",
			width: 24,
			height: 24,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var hasA11yProp = (props) => {
			for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
			return false;
		};
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/context.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var LucideContext = (0, react.createContext)({});
		var useLucideContext = () => (0, react.useContext)(LucideContext);
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/Icon.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Icon = (0, react.forwardRef)(({ color, size, strokeWidth, absoluteStrokeWidth, className = "", children, iconNode, ...rest }, ref) => {
			const { size: contextSize = 24, strokeWidth: contextStrokeWidth = 2, absoluteStrokeWidth: contextAbsoluteStrokeWidth = false, color: contextColor = "currentColor", className: contextClass = "" } = useLucideContext() ?? {};
			const calculatedStrokeWidth = absoluteStrokeWidth ?? contextAbsoluteStrokeWidth ? Number(strokeWidth ?? contextStrokeWidth) * 24 / Number(size ?? contextSize) : strokeWidth ?? contextStrokeWidth;
			return (0, react.createElement)("svg", {
				ref,
				...defaultAttributes,
				width: size ?? contextSize ?? defaultAttributes.width,
				height: size ?? contextSize ?? defaultAttributes.height,
				stroke: color ?? contextColor,
				strokeWidth: calculatedStrokeWidth,
				className: mergeClasses("lucide", contextClass, className),
				...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
				...rest
			}, [...iconNode.map(([tag, attrs]) => (0, react.createElement)(tag, attrs)), ...Array.isArray(children) ? children : [children]]);
		});
		//#endregion
		//#region ../dsh-plugin-desktop/node_modules/lucide-react/dist/esm/createLucideIcon.mjs
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var createLucideIcon = (iconName, iconNode) => {
			const Component = (0, react.forwardRef)(({ className, ...props }, ref) => (0, react.createElement)(Icon, {
				ref,
				iconNode,
				className: mergeClasses(`lucide-${toKebabCase(toPascalCase(iconName))}`, `lucide-${iconName}`, className),
				...props
			}));
			Component.displayName = toPascalCase(iconName);
			return Component;
		};
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Bug = createLucideIcon("bug", [
			["path", {
				d: "M12 20v-9",
				key: "1qisl0"
			}],
			["path", {
				d: "M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z",
				key: "uouzyp"
			}],
			["path", {
				d: "M14.12 3.88 16 2",
				key: "qol33r"
			}],
			["path", {
				d: "M21 21a4 4 0 0 0-3.81-4",
				key: "1b0z45"
			}],
			["path", {
				d: "M21 5a4 4 0 0 1-3.55 3.97",
				key: "5cxbf6"
			}],
			["path", {
				d: "M22 13h-4",
				key: "1jl80f"
			}],
			["path", {
				d: "M3 21a4 4 0 0 1 3.81-4",
				key: "1fjd4g"
			}],
			["path", {
				d: "M3 5a4 4 0 0 0 3.55 3.97",
				key: "1d7oge"
			}],
			["path", {
				d: "M6 13H2",
				key: "82j7cp"
			}],
			["path", {
				d: "m8 2 1.88 1.88",
				key: "fmnt4t"
			}],
			["path", {
				d: "M9 7.13V6a3 3 0 1 1 6 0v1.13",
				key: "1vgav8"
			}]
		]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var ChevronDown = createLucideIcon("chevron-down", [["path", {
			d: "m6 9 6 6 6-6",
			key: "qrunsl"
		}]]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var LifeBuoy = createLucideIcon("life-buoy", [
			["circle", {
				cx: "12",
				cy: "12",
				r: "10",
				key: "1mglay"
			}],
			["path", {
				d: "m4.93 4.93 4.24 4.24",
				key: "1ymg45"
			}],
			["path", {
				d: "m14.83 9.17 4.24-4.24",
				key: "1cb5xl"
			}],
			["path", {
				d: "m14.83 14.83 4.24 4.24",
				key: "q42g0n"
			}],
			["path", {
				d: "m9.17 14.83-4.24 4.24",
				key: "bqpfvv"
			}],
			["circle", {
				cx: "12",
				cy: "12",
				r: "4",
				key: "4exip2"
			}]
		]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var RefreshCw = createLucideIcon("refresh-cw", [
			["path", {
				d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
				key: "v9h5vc"
			}],
			["path", {
				d: "M21 3v5h-5",
				key: "1q7to0"
			}],
			["path", {
				d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
				key: "3uifl3"
			}],
			["path", {
				d: "M8 16H3v5",
				key: "1cv678"
			}]
		]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var RotateCw = createLucideIcon("rotate-cw", [["path", {
			d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",
			key: "1p45f6"
		}], ["path", {
			d: "M21 3v5h-5",
			key: "1q7to0"
		}]]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var SquareTerminal = createLucideIcon("square-terminal", [
			["path", {
				d: "m7 11 2-2-2-2",
				key: "1lz0vl"
			}],
			["path", {
				d: "M11 13h4",
				key: "1p7l4v"
			}],
			["rect", {
				width: "18",
				height: "18",
				x: "3",
				y: "3",
				rx: "2",
				ry: "2",
				key: "1m3agn"
			}]
		]);
		/**
		* @license lucide-react v1.33.0 - ISC
		*
		* This source code is licensed under the ISC license.
		* See the LICENSE file in the root directory of this source tree.
		*/
		var Wrench = createLucideIcon("wrench", [["path", {
			d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
			key: "1ngwbx"
		}]]);
		//#endregion
		//#region ../dsh-plugin-desktop/src/client/DesktopNativeActions.tsx
		/** Shared launcher-backed actions rendered in settings and extended title bars. */
		/** Shared restart-menu order for Settings and the independent Desktop title bar. */
		function DesktopRestartMenuItems({ busy, t, onReload, onRestart, onRestartToRecovery }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dshDesktopActionMenuItem",
					role: "menuitem",
					disabled: busy,
					onClick: onReload,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshCw, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("reloadRenderer") })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dshDesktopActionMenuItem",
					role: "menuitem",
					disabled: busy,
					onClick: onRestart,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCw, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restartDesktop") })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dshDesktopActionMenuItem",
					role: "menuitem",
					disabled: busy,
					onClick: onRestartToRecovery,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LifeBuoy, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restartToRecovery") })]
				})
			] });
		}
		/** Developer menu intentionally owns only the Developer Tools toggle. */
		function DesktopDeveloperMenuItems({ busy, t, onToggleDeveloperTools }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dshDesktopActionMenuItem",
				role: "menuitem",
				disabled: busy,
				onClick: onToggleDeveloperTools,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Bug, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("toggleDeveloperTools") })]
			});
		}
		function DesktopNativeActions({ api, t, placement, terminalAvailable = true }) {
			const [exportingDiagnostics, setExportingDiagnostics] = (0, react.useState)(false);
			const [opening, setOpening] = (0, react.useState)(false);
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [rendererAction, setRendererAction] = (0, react.useState)();
			const [restartMenuOpen, setRestartMenuOpen] = (0, react.useState)(false);
			const [developerMenuOpen, setDeveloperMenuOpen] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)();
			const developerMenuRef = (0, react.useRef)(null);
			const restartMenuRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!developerMenuOpen && !restartMenuOpen) return;
				const dismiss = (event) => {
					if (!developerMenuRef.current?.contains(event.target)) setDeveloperMenuOpen(false);
					if (!restartMenuRef.current?.contains(event.target)) setRestartMenuOpen(false);
				};
				const escape = (event) => {
					if (event.key === "Escape") {
						setDeveloperMenuOpen(false);
						setRestartMenuOpen(false);
					}
				};
				document.addEventListener("mousedown", dismiss);
				document.addEventListener("keydown", escape);
				return () => {
					document.removeEventListener("mousedown", dismiss);
					document.removeEventListener("keydown", escape);
				};
			}, [developerMenuOpen, restartMenuOpen]);
			(0, react.useEffect)(() => {
				if (restartMenuOpen) restartMenuRef.current?.querySelector("[role=\"menuitem\"]")?.focus();
			}, [restartMenuOpen]);
			const restartKeys = (event) => {
				const trigger = restartMenuRef.current?.querySelector("[aria-haspopup=\"menu\"]");
				if (event.key === "Escape" && restartMenuOpen) {
					event.preventDefault();
					event.stopPropagation();
					setRestartMenuOpen(false);
					trigger?.focus();
					return;
				}
				if (event.key === "Tab") {
					setRestartMenuOpen(false);
					return;
				}
				if (![
					"ArrowDown",
					"ArrowUp",
					"Home",
					"End"
				].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				if (!restartMenuOpen) {
					setRestartMenuOpen(true);
					return;
				}
				const items = [...restartMenuRef.current?.querySelectorAll("[role=\"menuitem\"]:not(:disabled)") ?? []];
				const index = items.indexOf(document.activeElement);
				items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
			};
			const busy = exportingDiagnostics || opening || restarting || rendererAction !== void 0;
			const exportDiagnostics = () => {
				if (busy || api.exportDiagnostics === void 0) return;
				setExportingDiagnostics(true);
				setFailed(void 0);
				api.exportDiagnostics().catch(() => {
					setFailed("diagnostics");
				}).finally(() => {
					setExportingDiagnostics(false);
				});
			};
			const open = () => {
				if (busy) return;
				setOpening(true);
				setFailed(void 0);
				api.openTerminal().catch(() => {
					setFailed("terminal");
				}).finally(() => {
					setOpening(false);
				});
			};
			const restart = (recovery = false) => {
				if (busy) return;
				setRestarting(true);
				setRestartMenuOpen(false);
				setFailed(void 0);
				(recovery ? api.restartToRecovery : api.restart)().catch(() => {
					setFailed("restart");
				}).finally(() => {
					setRestarting(false);
				});
			};
			const runRendererAction = (action) => {
				if (busy) return;
				const operation = action === "reload" ? api.reloadRenderer : api.toggleDeveloperTools;
				setRendererAction(action);
				setDeveloperMenuOpen(false);
				setRestartMenuOpen(false);
				setFailed(void 0);
				operation().catch(() => {
					setFailed(action);
				}).finally(() => {
					setRendererAction(void 0);
				});
			};
			const failureKey = failed === "diagnostics" ? "exportDiagnosticsError" : failed === "terminal" ? "openTerminalError" : failed === "restart" ? "restartDesktopError" : failed === "reload" ? "reloadRendererError" : "toggleDeveloperToolsError";
			if (placement === "settings") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopNativeActions",
				"data-placement": placement,
				children: [
					failed !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshDesktopNativeActionError",
						role: "alert",
						children: t(failureKey)
					}),
					api.exportDiagnostics !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopSettingsHeaderButton",
						disabled: busy,
						onClick: exportDiagnostics,
						children: t(exportingDiagnostics ? "exportingDiagnostics" : "exportDiagnostics")
					}),
					terminalAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopSettingsHeaderButton",
						disabled: busy,
						onClick: open,
						children: t(opening ? "openingTerminal" : "openTerminal")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshDesktopNativeActionMenuAnchor",
						ref: restartMenuRef,
						onKeyDown: restartKeys,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dshDesktopSettingsHeaderButton",
							"aria-expanded": restartMenuOpen,
							"aria-haspopup": "menu",
							disabled: busy,
							onClick: () => {
								setRestartMenuOpen((value) => !value);
							},
							children: [t(restarting ? "restartingDesktop" : "restartDesktop"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronDown, { "aria-hidden": "true" })]
						}), restartMenuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshDesktopActionMenu",
							role: "menu",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopRestartMenuItems, {
								busy,
								t,
								onReload: () => {
									runRendererAction("reload");
								},
								onRestart: () => {
									restart();
								},
								onRestartToRecovery: () => {
									restart(true);
								}
							})
						})]
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopNativeActions",
				"data-placement": placement,
				children: [
					failed !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshDesktopNativeActionError",
						role: "alert",
						children: t(failureKey)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopTitlebarIconButton",
						"aria-label": t("openTerminal"),
						title: t("openTerminal"),
						disabled: busy,
						onClick: open,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SquareTerminal, { "aria-hidden": "true" })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshDesktopNativeActionMenuAnchor",
						ref: restartMenuRef,
						onKeyDown: restartKeys,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshDesktopTitlebarIconButton",
							"aria-label": t("restartOptions"),
							"aria-expanded": restartMenuOpen,
							"aria-haspopup": "menu",
							title: t("restartOptions"),
							disabled: busy,
							onClick: () => {
								setDeveloperMenuOpen(false);
								setRestartMenuOpen((value) => !value);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RotateCw, { "aria-hidden": "true" })
						}), restartMenuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshDesktopActionMenu",
							role: "menu",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopRestartMenuItems, {
								busy,
								t,
								onReload: () => {
									runRendererAction("reload");
								},
								onRestart: () => {
									restart();
								},
								onRestartToRecovery: () => {
									restart(true);
								}
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshDesktopNativeActionMenuAnchor",
						ref: developerMenuRef,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshDesktopTitlebarIconButton",
							"aria-label": t("developerOptions"),
							"aria-expanded": developerMenuOpen,
							"aria-haspopup": "menu",
							title: t("developerOptions"),
							disabled: busy,
							onClick: () => {
								setRestartMenuOpen(false);
								setDeveloperMenuOpen((value) => !value);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Wrench, { "aria-hidden": "true" })
						}), developerMenuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshDesktopActionMenu",
							role: "menu",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopDeveloperMenuItems, {
								busy,
								t,
								onToggleDeveloperTools: () => {
									runRendererAction("devtools");
								}
							})
						})]
					})
				]
			});
		}
		//#endregion
		//#region ../dsh-plugin-desktop/src/client/desktop-settings-locales.ts
		/** Desktop-owned settings copy. */
		var zh = {
			language: "zh",
			loggingTitle: "日志",
			developerLogging: "开发者日志",
			developerLoggingBody: "立即记录模型、工具、重试、HTTP、进程通信和界面诊断的元数据，不主动采集提示词、工具参数或响应正文；日志会随诊断 ZIP 导出。会话事件可按序号与官方 Session Log 对照。",
			logLevel: "日志级别",
			remoteControl: "远程控制",
			remoteControlNew: "新功能",
			aaSaving: "正在保存手机连接设置…",
			aaLoadFailed: "手机连接未能启动。选择“重试加载”以重试；如果仍然失败，请检查日志。",
			retryAa: "重试加载",
			aaSaveFailed: "未能保存手机连接设置。请重试。",
			aaSaved: "手机连接设置已保存。",
			aaTitle: "Agents-Anywhere",
			aaIntro: "通过 Agents-Anywhere，在手机或浏览器中访问这台电脑上的 DSH。",
			aaDisabled: "关闭手机连接",
			aaDisabledBody: "不在手机或浏览器中通过 Agents-Anywhere 访问这台电脑。",
			aaEnabled: "开启手机连接",
			aaEnabledBody: "开启后，打开侧边栏中的“手机连接”完成设置。",
			beta: "Beta",
			nav: "桌面设置",
			title: "DSH Desktop 设置",
			intro: "管理 Profile，设置窗口外观、连接方式和通知。",
			pluginSettingsMovedNotice: "插件市场和远程控制设置已移至插件页面。",
			goToPlugins: "前往插件页面",
			loading: "正在读取桌面设置…",
			retry: "重试",
			unavailable: "暂时无法读取桌面设置。",
			operationFailed: "暂时无法完成这项操作，请稍后重试。",
			exportDiagnostics: "导出诊断信息",
			exportingDiagnostics: "正在准备导出…",
			exportDiagnosticsError: "未能准备诊断信息。请重试。",
			openTerminal: "打开 DSH 终端",
			openingTerminal: "正在打开…",
			openTerminalError: "未能打开 DSH 终端。请重试；如果仍然失败，可导出诊断信息排查。",
			updatesTitle: "版本与更新",
			updatesIntro: "查看当前版本，并检查是否有可用的新版本。发现新版本后，Desktop 会引导你下载并安装。",
			currentVersion: "当前版本",
			checkForUpdates: "检查更新",
			checkingForUpdates: "正在检查…",
			checkForUpdatesError: "暂时无法检查更新，请稍后再试。",
			restartDesktop: "重启",
			restartingDesktop: "正在重启…",
			restartOptions: "重启选项",
			restartToRecovery: "重启到恢复模式",
			restartDesktopError: "暂时无法重启 DSH Desktop，请稍后再试。",
			developerOptions: "开发者选项",
			reloadRenderer: "重新加载界面",
			reloadRendererError: "未能重新加载界面。请重试。",
			toggleDeveloperTools: "切换开发者工具",
			toggleDeveloperToolsError: "暂时无法切换开发者工具，请稍后再试。",
			readOnly: "当前设置为只读，无法保存更改。",
			restarting: "选择已保存，DSH Desktop 正在重启以应用改动。",
			restartRequired: "选择已保存，重启 DSH Desktop 后生效。",
			profileTitle: "Profile",
			profileIntro: "Profile 是一套配置环境。选择启动时使用的 Profile，或创建新的 Profile。",
			profileReady: "可使用",
			profileUnavailable: "不适用于桌面版",
			activeProfile: "当前",
			profileName: "Profile 名称",
			profileNamePlaceholder: "例如：work",
			creatingProfile: "正在创建…",
			create: "创建",
			deleteProfile: "删除",
			confirmDeleteProfile: "删除 Profile",
			cancelDeleteProfile: "取消",
			deleteProfileWarning: "将删除此 Profile 的本地配置和插件文件，且无法撤销。",
			deletingProfile: "正在删除…",
			marketTitle: "插件市场",
			marketIntro: "选择一个插件市场。一次只能启用一个。",
			marketDisabled: "关闭插件市场",
			marketDisabledBody: "不加载插件市场界面。",
			communityMarket: "dsh-community-market",
			communityMarketBody: "DSH Desktop 内置的开放插件市场，支持添加和选择自定义插件数据源。",
			dshMarket: "dsh-market",
			dshMarketBody: "社区热门的插件市场，数据来自",
			legacyMarketNotice: "从旧版升级后，插件市场会保持关闭，直到你在这里明确选择。",
			marketLoadFailed: "所选插件市场未能加载。请选择其他市场，或选择“重试加载”。",
			selected: "已选择",
			retryMarket: "重试加载",
			presentationTitle: "窗口模式",
			presentationIntro: "选择窗口布局和桌面操作方式。",
			compatibilityMode: "兼容模式",
			compatibilityModeBody: "使用官方客户端布局，顶部提供独立的桌面控制栏。兼容性最好。",
			extendedMode: "扩展模式",
			extendedModeBody: "在官方内容区域外提供独立顶栏和侧边栏，可搭配玻璃背景。",
			extendedUnavailableLinux: "扩展模式目前支持 macOS 和 Windows。",
			advancedMode: "增强模式",
			advancedModeBody: "使用桌面专用布局，调整侧边栏、内容面板和窗口操作方式。",
			advancedUnavailableLinux: "增强模式目前支持 macOS 和 Windows。",
			switchPresentationMode: "切换窗口模式",
			switchingPresentationMode: "正在保存并准备重启…",
			switchPresentationModeError: "未能切换窗口模式。请重试。",
			windowMaterial: "窗口材质",
			windowMaterialBody: "设置窗口背景效果。更改后需重启应用才能生效。",
			windowMaterialOff: "纯色背景",
			windowMaterialTransparent: "玻璃背景",
			webTitle: "浏览器与局域网",
			webIntro: "允许在浏览器中打开当前 Profile，并选择可访问的设备范围。",
			openBrowser: "允许在浏览器中打开",
			browserCompatibilityNotice: "浏览器访问仅在兼容模式下可用；如需开启，请先选择兼容模式。",
			lanAccess: "局域网访问（需要 HTTPS）",
			lanStatus: "局域网 HTTPS 状态",
			lanStatusInactive: "未开启",
			lanStatusStarting: "正在启动",
			lanStatusReady: "已就绪",
			lanStatusFailed: "启动失败",
			lanError: "错误代码",
			browserUrls: "浏览器访问地址",
			copyBrowserUrl: "复制地址",
			browserUrlCopied: "已复制",
			lanHttpsUrls: "局域网 HTTPS 地址",
			lanTrustNotice: "请在访问设备上安装并信任下方证书。仅跳过浏览器的证书警告，不能保证页面功能正常；部分浏览器仍可能限制相关安全功能。",
			lanCaTitle: "设置信任证书",
			lanCaFingerprint: "本地 CA SHA-256 指纹",
			lanCaDownloads: "在需要访问 DSH Desktop 的设备上下载、安装并信任此证书：",
			lanWarningTitle: "开启局域网访问？",
			lanWarningBody: "同一局域网中，持有访问链接的人可以通过 DSH 操作这台电脑。请仅与可信任的人共享链接。连接使用 HTTPS；访问设备需要安装并信任本机提供的证书。",
			lanCancel: "取消",
			lanConfirm: "开启局域网访问",
			notificationsTitle: "桌面通知",
			notificationsIntro: "在任务完成或失败时接收系统通知。通知不会显示会话内容。",
			notificationsEnabled: "启用桌面通知",
			turnCompletion: "本轮任务完成",
			turnFailure: "本轮任务失败",
			jobCompletion: "后台任务完成",
			jobFailure: "后台任务失败",
			scheduleCompletion: "自动化任务完成",
			scheduleFailure: "自动化任务失败"
		};
		var en = {
			language: "en",
			loggingTitle: "Logging",
			developerLogging: "Developer logging",
			developerLoggingBody: "Trace model, tool, retry, HTTP, IPC and UI metadata immediately. Prompts, tool arguments and response bodies are not collected by these observers. Logs are included in diagnostic ZIP exports. Match session events to the official Session Log by sequence number.",
			logLevel: "Log level",
			remoteControl: "Remote control",
			remoteControlNew: "New feature",
			aaSaving: "Saving phone connection settings…",
			aaLoadFailed: "Phone connection could not start. Select Retry loading to try again. If it still fails, check the logs.",
			retryAa: "Retry loading",
			aaSaveFailed: "Could not save phone connection settings. Please try again.",
			aaSaved: "Phone connection settings saved.",
			aaTitle: "Agents-Anywhere",
			aaIntro: "Use Agents-Anywhere to access DSH on this computer from your phone or a browser.",
			aaDisabled: "Turn off phone connection",
			aaDisabledBody: "Do not use Agents-Anywhere to access this computer from a phone or browser.",
			aaEnabled: "Turn on phone connection",
			aaEnabledBody: "After enabling, open Phone connection in the sidebar to finish setup.",
			beta: "Beta",
			nav: "Desktop settings",
			title: "DSH Desktop settings",
			intro: "Manage Profiles and set up window appearance, connections, and notifications.",
			pluginSettingsMovedNotice: "Plugin market and remote control settings have moved to the Plugins page.",
			goToPlugins: "Go to Plugins",
			loading: "Loading Desktop settings…",
			retry: "Try again",
			unavailable: "Desktop settings are temporarily unavailable.",
			operationFailed: "This action could not be completed. Please try again shortly.",
			exportDiagnostics: "Export Diagnostics",
			exportingDiagnostics: "Preparing export…",
			exportDiagnosticsError: "Could not prepare diagnostics. Please try again.",
			openTerminal: "Open DSH Terminal",
			openingTerminal: "Opening…",
			openTerminalError: "Could not open DSH Terminal. Please try again. If it still fails, export diagnostics to investigate.",
			updatesTitle: "Version and updates",
			updatesIntro: "See the installed version and check whether a newer release is available. When one is found, Desktop guides you through downloading and installing it.",
			currentVersion: "Current version",
			checkForUpdates: "Check for updates",
			checkingForUpdates: "Checking…",
			checkForUpdatesError: "Updates could not be checked just now. Please try again shortly.",
			restartDesktop: "Restart",
			restartingDesktop: "Restarting…",
			restartOptions: "Restart options",
			restartToRecovery: "Restart in Recovery Mode",
			restartDesktopError: "DSH Desktop could not be restarted just now. Please try again shortly.",
			developerOptions: "Developer options",
			reloadRenderer: "Reload interface",
			reloadRendererError: "Could not reload the interface. Please try again.",
			toggleDeveloperTools: "Toggle Developer Tools",
			toggleDeveloperToolsError: "Developer Tools could not be toggled just now. Please try again shortly.",
			readOnly: "These settings are read-only. Changes cannot be saved.",
			restarting: "Your choice was saved. DSH Desktop is restarting to apply the change.",
			restartRequired: "Your choice was saved and will take effect after DSH Desktop restarts.",
			profileTitle: "Profile",
			profileIntro: "A Profile is a configuration environment. Choose the Profile used at startup or create a new one.",
			profileReady: "Available",
			profileUnavailable: "Not compatible with Desktop",
			activeProfile: "Current",
			profileName: "Profile name",
			profileNamePlaceholder: "For example: work",
			creatingProfile: "Creating…",
			create: "Create",
			deleteProfile: "Delete",
			confirmDeleteProfile: "Delete Profile",
			cancelDeleteProfile: "Cancel",
			deleteProfileWarning: "This deletes the Profile’s local configuration and plugin files. This cannot be undone.",
			deletingProfile: "Deleting…",
			marketTitle: "Plugin market",
			marketIntro: "Choose a plugin market. Only one can be enabled at a time.",
			marketDisabled: "Turn off plugin market",
			marketDisabledBody: "Do not load a plugin market interface.",
			communityMarket: "dsh-community-market",
			communityMarketBody: "The open plugin market built into DSH Desktop, with support for custom plugin data sources.",
			dshMarket: "dsh-market",
			dshMarketBody: "A popular community plugin market powered by data from",
			legacyMarketNotice: "After upgrading from an earlier version, the plugin market stays off until you explicitly choose one here.",
			marketLoadFailed: "The selected plugin market could not load. Choose another market or select Retry loading.",
			selected: "Selected",
			retryMarket: "Try loading again",
			presentationTitle: "Window mode",
			presentationIntro: "Choose a window layout and desktop controls.",
			compatibilityMode: "Compatibility mode",
			compatibilityModeBody: "Use the official client layout with an independent Desktop control bar above it. This mode offers the best compatibility.",
			extendedMode: "Extended mode",
			extendedModeBody: "Add an independent titlebar and sidebar around the official content area, with optional glass effects.",
			extendedUnavailableLinux: "Extended mode is currently available on macOS and Windows.",
			advancedMode: "Enhanced mode",
			advancedModeBody: "Use a desktop layout with adjusted sidebars, content panels, and window controls.",
			advancedUnavailableLinux: "Enhanced mode is currently available on macOS and Windows.",
			switchPresentationMode: "Switch window mode",
			switchingPresentationMode: "Saving and preparing to restart…",
			switchPresentationModeError: "Could not switch window mode. Please try again.",
			windowMaterial: "Window material",
			windowMaterialBody: "Set the window background effect. Restart the app to apply changes.",
			windowMaterialOff: "Solid background",
			windowMaterialTransparent: "Glass background",
			webTitle: "Browser and local network",
			webIntro: "Allow browser access to the current Profile and choose which devices can reach it.",
			openBrowser: "Allow opening this Profile in a browser",
			browserCompatibilityNotice: "Browser access is only available in compatibility mode. Select compatibility mode first to enable it.",
			lanAccess: "Local-network access (HTTPS required)",
			lanStatus: "Local-network HTTPS status",
			lanStatusInactive: "Off",
			lanStatusStarting: "Starting",
			lanStatusReady: "Ready",
			lanStatusFailed: "Failed to start",
			lanError: "Error code",
			browserUrls: "Browser addresses",
			copyBrowserUrl: "Copy address",
			browserUrlCopied: "Copied",
			lanHttpsUrls: "Local-network HTTPS addresses",
			lanTrustNotice: "Install and trust the certificate below on each device you use to connect. Bypassing a browser certificate warning does not guarantee that the page will work; some browsers may still restrict security-related features.",
			lanCaTitle: "Trust the certificate",
			lanCaFingerprint: "Local CA SHA-256 fingerprint",
			lanCaDownloads: "Download, install, and trust this certificate on each device that will access DSH Desktop:",
			lanWarningTitle: "Enable local-network access?",
			lanWarningBody: "Anyone on the same local network who has the access link can use DSH to operate this computer. Share the link only with people you trust. Connections use HTTPS; each device must install and trust the certificate provided by this computer.",
			lanCancel: "Cancel",
			lanConfirm: "Enable local-network access",
			notificationsTitle: "Desktop notifications",
			notificationsIntro: "Receive system notifications when tasks finish or fail. Notifications do not show conversation content.",
			notificationsEnabled: "Enable Desktop notifications",
			turnCompletion: "Current turn completed",
			turnFailure: "Current turn failed",
			jobCompletion: "Background job completed",
			jobFailure: "Background job failed",
			scheduleCompletion: "Automation task completed",
			scheduleFailure: "Automation task failed"
		};
		//#endregion
		//#region src/client/permissions.tsx
		/** One official-component dialog for every native permission entry point. */
		function DesktopPermissionsSection({ service, language }) {
			const zh = language.startsWith("zh");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "dshDesktopSettingsGroup",
				"aria-label": zh ? "系统权限" : "System permissions",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshDesktopSettingsUpdateRow",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshDesktopSettingsUpdateSummary",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: zh ? "系统权限" : "System permissions" })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopPermissionsButton, {
						service,
						language,
						className: "dshDesktopSettingsButton"
					})]
				})
			});
		}
		function DesktopPermissionsButton({ service, language, iconOnly = false, disabled = false, label: customLabel, permission, className }) {
			const [open, setOpen] = (0, react.useState)(false);
			const zh = language.startsWith("zh");
			const label = customLabel ?? (zh ? "授权设置" : "Permissions");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: iconOnly ? "ghost" : "outline",
				size: "sm",
				"aria-label": label,
				disabled,
				className: iconOnly ? "dshNextSettingsGear" : className,
				icon: iconOnly ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, {}) : void 0,
				onClick: () => {
					setOpen(true);
				},
				children: iconOnly ? null : label
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopPermissionsDialog, {
				open,
				onClose: () => {
					setOpen(false);
				},
				service,
				language,
				permission
			})] });
		}
		function DesktopPermissionsDialog({ open, onClose, service, language, permission }) {
			const zh = language.startsWith("zh");
			const body = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const dialog = open ? body.current?.closest("[role=\"dialog\"]") : null;
				if (!dialog) return;
				const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
				const buttons = () => [...dialog.querySelectorAll("button:not(:disabled)")];
				const trapTab = (event) => {
					if (event.key !== "Tab") return;
					const targets = buttons();
					const first = targets[0], last = targets.at(-1);
					if (!targets.includes(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						(event.shiftKey ? last : first)?.focus();
					}
				};
				buttons()[0]?.focus();
				document.addEventListener("keydown", trapTab);
				return () => {
					document.removeEventListener("keydown", trapTab);
					previous?.focus({ preventScroll: true });
				};
			}, [open]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title: permission === "microphone" ? zh ? "麦克风权限" : "Microphone permission" : zh ? "系统权限" : "System permissions",
				closeLabel: zh ? "关闭" : "Close",
				className: "dshNextPermissionsDialog",
				description: zh ? "按需授权。更改系统权限后，可能需要重启应用。" : "Grant access when needed. You may need to restart the app after changing system permissions.",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: body,
					children: open && (service ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermissionDetails, {
						service,
						language,
						permission
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: zh ? "请在运行 DSH 的桌面应用中管理系统权限。" : "Manage system permissions in the desktop app running DSH."
					}))
				})
			});
		}
		function PermissionDetails({ service, language, permission: onlyPermission }) {
			const t = (zh, en) => language.startsWith("zh") ? zh : en;
			const [snapshots, setSnapshots] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)("");
			const pending = (0, react.useRef)(false);
			const revision = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				let disposed = false;
				const refresh = () => {
					if (pending.current) return;
					const current = ++revision.current;
					const permissions = onlyPermission ? [onlyPermission] : [
						"microphone",
						"screen",
						"accessibility"
					];
					Promise.all(permissions.map((permission) => service.query(permission))).then((values) => {
						if (!disposed && current === revision.current) {
							setSnapshots(values);
							setFailure("");
						}
					}).catch((error) => {
						if (!disposed && current === revision.current) setFailure(String(error));
					});
				};
				refresh();
				window.addEventListener("focus", refresh);
				return () => {
					disposed = true;
					window.removeEventListener("focus", refresh);
				};
			}, [service, onlyPermission]);
			const perform = async (permission, action) => {
				if (pending.current) return;
				pending.current = true;
				revision.current++;
				setBusy(true);
				setFailure("");
				try {
					await service[action](permission);
					const snapshot = await service.query(permission);
					setSnapshots((values) => values.map((value) => value.permission === permission ? snapshot : value));
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				} finally {
					pending.current = false;
					setBusy(false);
				}
			};
			const labels = (permission) => ({
				granted: t("已允许", "Allowed"),
				denied: permission === "microphone" ? t("已拒绝", "Denied") : t("未授权", "Not granted"),
				restricted: t("受系统限制", "Restricted"),
				"not-determined": t("尚未授权", "Not requested"),
				unknown: t("由系统管理", "Managed by the system")
			});
			const guidance = {
				screen: t("开启后 macOS 会要求重新打开应用。", "macOS asks to reopen the app after you turn this on."),
				accessibility: t("若系统设置中已显示开启，请移除本应用后重新添加。", "If System Settings already shows it on, remove the app from the list and add it again.")
			};
			const descriptions = {
				screen: t("用于截图，让 AI 读取屏幕内容。", "Take screenshots so AI can read what is on screen."),
				accessibility: t("允许 Computer Use 操作鼠标和键盘。", "Allow Computer Use to control the mouse and keyboard."),
				microphone: t("允许需要录音的功能使用麦克风。", "Allow features that record audio to use the microphone.")
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextPermissionList",
				children: [failure && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "alert",
					className: "dshDesktopSettingsError",
					children: failure
				}), (onlyPermission ? [onlyPermission] : [
					"screen",
					"accessibility",
					"microphone"
				]).map((permission) => {
					const snapshot = snapshots.find((value) => value.permission === permission);
					const label = {
						microphone: t("麦克风", "Microphone"),
						screen: t("屏幕录制", "Screen recording"),
						accessibility: t("辅助功能", "Accessibility")
					}[permission];
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshNextPermissionRow",
						role: "group",
						"aria-label": label,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextPermissionCopy",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshDesktopSettingsHint",
									children: descriptions[permission]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshNextPermissionStatus",
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: snapshot?.status === "granted" ? "done" : snapshot?.status === "denied" || snapshot?.status === "restricted" ? "error" : "idle" }), snapshot ? labels(permission)[snapshot.status] : t("正在读取…", "Loading…")]
								}),
								snapshot?.status === "denied" && permission !== "microphone" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshDesktopSettingsHint",
									children: guidance[permission]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextPluginActions",
							children: [snapshot?.canRequest && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: busy,
								onClick: () => {
									perform(permission, "request");
								},
								children: t("请求授权", "Request access")
							}), snapshot?.canOpenSettings && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: busy,
								onClick: () => {
									perform(permission, "openSettings");
								},
								children: t("打开系统设置", "Open system settings")
							})]
						})]
					}, permission);
				})]
			});
		}
		//#endregion
		//#region src/client/desktop-state.ts
		function useDesktopState(adapter) {
			const state = (0, react.useSyncExternalStore)(adapter.subscribe, adapter.getSnapshot);
			(0, react.useEffect)(() => {
				adapter.refresh().catch(() => {});
				const timer = setInterval(() => {
					if (!document.hidden) adapter.refresh().catch(() => {});
				}, 2e3);
				return () => clearInterval(timer);
			}, [adapter]);
			return state;
		}
		//#endregion
		//#region src/update-state.ts
		function updateLabel(state, language) {
			const t = (zh, en) => language.toLowerCase().startsWith("zh") ? zh : en;
			switch (state.phase) {
				case "checking": return t("正在检查更新…", "Checking for updates…");
				case "current": return t("已是最新版本", "Up to date");
				case "available": return t(`发现新版本 ${state.version}`, `Update available: ${state.version}`);
				case "downloading": {
					const progress = state.total ? `${Math.min(100, Math.floor((state.received ?? 0) / state.total * 100))}%` : `${Math.floor((state.received ?? 0) / 1048576)} MB`;
					return t(`正在下载更新 ${progress}`, `Downloading update ${progress}`);
				}
				case "preparing": return t("正在准备安装…", "Preparing update…");
				case "ready": return t(`${state.version} 已下载，安装并重启`, `${state.version} downloaded — Install and restart`);
				case "installing": return t("正在安装并重启…", "Installing and restarting…");
				case "error":
					if (state.error === "development") return t("开发环境可检查更新，请使用安装版进行更新。", "Updates can be checked in development. Install a packaged build to update.");
					if (state.error === "unsupported") return t("当前平台暂不支持应用内更新。", "In-app updates are unavailable on this platform.");
					if (state.error === "service") return t("暂时无法获取 Next 更新，请稍后重试。", "Next updates are temporarily unavailable. Try again later.");
					return t("更新未完成，请重试。", "The update could not be completed. Please retry.");
				default: return t("检查更新", "Check for updates");
			}
		}
		function updateAction(state) {
			if (state.phase === "ready") return "install-update";
			if (state.phase === "available" || state.phase === "error" && state.version && state.error !== "service") return "download-update";
			if ([
				"idle",
				"current",
				"error"
			].includes(state.phase)) return "check-updates";
		}
		var RELEASES_URL = "https://github.com/anywhere-labs/dsh-desktop/releases";
		function releaseNotesUrl(version) {
			return version ? `${RELEASES_URL}/tag/v${encodeURIComponent(version)}` : RELEASES_URL;
		}
		//#endregion
		//#region src/client/updates.tsx
		function NextUpdateSettings({ state, language, run }) {
			const update = state.platform === "darwin" || state.platform === "win32" ? state.updates : void 0;
			if (!update && state.platform !== "linux") return null;
			const t = (zh, en) => language.startsWith("zh") ? zh : en;
			const action = update ? updateAction(update) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshDesktopSettingsGroup",
				"data-next-updates": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: state.platform === "linux" ? t("桌面版本", "Desktop version") : t("应用更新", "App updates") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshDesktopSettingsHint",
						children: ["DSH NEXT · ", state.version]
					}),
					update && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: update.phase === "error" ? "alert" : "status",
							children: updateLabel(update, language)
						}),
						update.phase === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshDesktopSettingsHint",
							children: t("安装时会重启应用并中断正在运行的任务，Profile 和会话会保留。", "Installation restarts the app and interrupts running tasks. Profiles and sessions are retained.")
						}),
						update.phase === "downloading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("progress", {
							style: { width: "100%" },
							"aria-label": t("更新下载进度", "Update download progress"),
							max: update.total ?? 1,
							value: update.total ? update.received ?? 0 : void 0
						}),
						!update.installable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshDesktopSettingsHint",
							children: t("应用内安装更新需要使用 macOS 或 Windows 安装版。", "Install a packaged macOS or Windows build to use in-app updates.")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsDialogActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								className: "dshDesktopSettingsButton",
								href: releaseNotesUrl(update.version),
								target: "_blank",
								rel: "noopener noreferrer",
								children: t("更新公告", "Release notes")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								className: "dshDesktopSettingsButton",
								disabled: state.busy || !action || action !== "check-updates" && !update.installable,
								onClick: () => {
									if (action) run({ type: action });
								},
								children: action === "install-update" ? t("安装并重启", "Install and restart") : action === "download-update" ? t("下载更新", "Download update") : t("检查更新", "Check for updates")
							})]
						})
					] })
				]
			});
		}
		//#endregion
		//#region src/client/settings.tsx
		/** Mount the existing Desktop page and controls against Next's native adapter. */
		function desktopTranslate(language) {
			const copy = language.startsWith("zh") ? zh : en;
			return (key) => {
				if (key === "title") return language.startsWith("zh") ? "DSH NEXT 设置" : "DSH NEXT settings";
				if (key === "presentationTitle") return language.startsWith("zh") ? "窗口外观" : "Window appearance";
				if (key === "windowMaterialBody") return language.startsWith("zh") ? "设置窗口背景效果，更改后立即生效。" : "Set the window background effect. Changes apply immediately.";
				if (key === "sidebarFooterCompat") return language.startsWith("zh") ? "侧边栏底部图标横向排列" : "Arrange sidebar footer icons in a row";
				if (key === "sidebarFooterCompatBody") return language.startsWith("zh") ? "展开侧边栏时将底部的紧凑图标按钮并排显示在同一行；关闭后恢复逐行纵向排列，更改后立即生效。" : "Place compact icon actions on a single row while the sidebar is expanded. Turn off to stack every item vertically. Changes apply immediately.";
				if (key === "sidebarFooterBalanced") return language.startsWith("zh") ? "多行图标均衡排列" : "Balance multi-row icon layout";
				if (key === "sidebarFooterBalancedBody") return language.startsWith("zh") ? "图标超出单行时自动均分每行数量并按列居中对齐；关闭后按顺序排满换行。" : "Distribute icons evenly across rows and align columns when wrapping. Turn off to wrap greedily in order.";
				if (key === "deleteProfileWarning") return language.startsWith("zh") ? "此 Profile 将移入恢复备份目录。共享的会话和设置会保留。" : "Move this Profile to recovery backups. Shared sessions and settings are retained.";
				if (key === "presentationIntro") return language.startsWith("zh") ? "设置当前平台支持的窗口外观。" : "Choose the window appearance supported on this platform.";
				if (key === "browserCompatibilityNotice") return language.startsWith("zh") ? "开关即时生效；关闭访问会断开已有的浏览器连接。" : "Changes take effect immediately. Disabling access disconnects existing browser connections.";
				return Object.hasOwn(copy, key) ? copy[key] : key;
			};
		}
		function NextDesktopSettings({ adapter, language, onOpenPlugins }) {
			const state = useDesktopState(adapter);
			const t = desktopTranslate(language);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-next-desktop-settings": "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsSection, {
					t,
					api: adapter.api,
					version: state?.version ?? "",
					platform: state?.platform === "darwin" || state?.platform === "win32" ? state.platform : "linux",
					initialMode: "compatibility",
					setMode: async () => {
						throw new Error("Window modes are not supported in Next");
					},
					desktopSettings: adapter.desktopSettings,
					notificationSettings: adapter.notificationSettings,
					capabilities: {
						logging: false,
						windowModes: false,
						pluginSelectors: false,
						updates: false,
						materialRequiresRestart: false,
						nativeLanConfirmation: true,
						jobNotifications: false
					},
					introNotice: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshDesktopSettingsNotice dshNextPluginSettingsNotice",
						"data-next-plugin-settings-notice": true,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: language.startsWith("zh") ? "插件市场和远程控制设置已移至插件页面。" : "Plugin market and remote control settings have moved to the Plugins page." }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							className: "dshDesktopSettingsButton",
							onClick: onOpenPlugins,
							children: language.startsWith("zh") ? "前往插件页面" : "Go to Plugins"
						})]
					}),
					browserActions: state && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NextBrowserActions, {
						adapter,
						state,
						language
					}),
					extraSections: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [adapter.bridge.permissions && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopPermissionsSection, {
						service: adapter.bridge.permissions,
						language
					}), state && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NextDesktopOptions, {
						adapter,
						state,
						language
					})] })
				})
			});
		}
		function NextDesktopActions({ adapter, language }) {
			const state = useDesktopState(adapter);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopNativeActions, {
				api: adapter.api,
				t: desktopTranslate(language),
				placement: "settings",
				terminalAvailable: state?.platform === "darwin" || state?.platform === "win32"
			});
		}
		function NextBrowserActions({ adapter, state, language }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)("");
			const run = async () => {
				setBusy(true);
				setFailure("");
				try {
					await adapter.command({ type: "export-ca" });
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			if (!state.browserUrl || state.lan?.state !== "ready") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [failure && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "alert",
				className: "dshDesktopSettingsError",
				children: failure
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshDesktopSettingsDialogActions",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
					disabled: busy || state.busy,
					onClick: () => {
						run();
					},
					children: language.startsWith("zh") ? "导出 CA 证书" : "Export CA certificate"
				})
			})] });
		}
		/**
		* The data directory in use and how it was chosen: a choice made in the app wins over
		* `DSH_DESKTOP_NEXT_HOME`, which wins over `~/.dsh`. Changing or backing up never moves data.
		*/
		function NextDataDirectory({ state, language, unavailable, run }) {
			const t = (cn, en) => language.startsWith("zh") ? cn : en;
			const source = state.dataDirectory?.source;
			const environmentHome = state.dataDirectory?.environmentHome ?? null;
			const label = source === "desktop" ? t("应用内选择", "Chosen in app") : source === "environment" ? "DSH_DESKTOP_NEXT_HOME" : source === "default" ? t("默认", "Default") : void 0;
			const overridden = source === "desktop" && environmentHome !== null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshDesktopSettingsUpdateRow",
				"data-next-data-directory": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dshDesktopSettingsToggleCopy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshDesktopSettingsToggleLabel",
							children: [t("数据目录", "Data directory"), label && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshDesktopSettingsBadge",
								title: t("优先级：应用内选择 > DSH_DESKTOP_NEXT_HOME > 默认目录", "Precedence: chosen in app > DSH_DESKTOP_NEXT_HOME > default"),
								children: label
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: "dshDesktopSettingsDataPath",
							children: state.home
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dshDesktopSettingsToggleDescription",
							children: [overridden && t("应用内选择优先于 DSH_DESKTOP_NEXT_HOME。", "The directory chosen in the app takes precedence over DSH_DESKTOP_NEXT_HOME. "), t("如需重置当前数据目录，请先备份，再到恢复助手中操作。", "To reset this data directory, back it up first, then use the recovery assistant.")]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dshDesktopSettingsRowActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
						disabled: unavailable,
						onClick: () => run({ type: "change-data-directory" }),
						children: t("切换", "Change")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
						disabled: unavailable,
						onClick: () => run({ type: "backup-data-directory" }),
						children: t("备份", "Back up")
					})]
				})]
			});
		}
		/** Next-only preferences use the existing Desktop form and switch components. */
		function NextDesktopOptions({ adapter, state, language }) {
			const t = (cn, en) => language.startsWith("zh") ? cn : en;
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)("");
			const run = async (operation) => {
				setBusy(true);
				setFailure("");
				try {
					await operation();
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
			};
			const savePreference = async (patch) => {
				setFailure("");
				try {
					await adapter.savePreferences(patch);
				} catch (error) {
					setFailure(error instanceof Error ? error.message : String(error));
				}
			};
			const action = (type, cn, en, unavailable = false) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dshDesktopSettingsButton dshDesktopSettingsButtonSecondary",
				disabled: busy || state.busy || unavailable,
				onClick: () => {
					run(() => adapter.command({ type }));
				},
				children: t(cn, en)
			}, type);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				failure && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "alert",
					className: "dshDesktopSettingsError",
					children: failure
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NextUpdateSettings, {
					state,
					language,
					run: (command) => {
						run(() => adapter.command(command));
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dshDesktopSettingsGroup",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("后台运行", "Background operation") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
						label: t("关闭窗口后保持后台运行", "Keep running after closing the window"),
						description: state.trayAvailable ? t("可从托盘重新打开窗口。", "Reopen the window from the tray.") : t("系统托盘不可用，关闭主窗口将退出应用。", "The tray is unavailable; closing the main window quits the application."),
						checked: state.preferences.closeToTray,
						disabled: state.safeMode,
						onChange: (closeToTray) => {
							savePreference({ closeToTray });
						}
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dshDesktopSettingsGroup",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("桌面工具", "Desktop tools") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsToolActions",
							children: [
								action("restart-onboarding", "设置向导", "Setup wizard", state.safeMode),
								action("open-home", "打开数据目录", "Open data directory"),
								action("open-profile", "打开 Profile 目录", "Open Profile directory"),
								action("open-logs", "打开日志目录", "Open log directory"),
								action("devtools", "开发者工具", "Developer Tools")
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NextDataDirectory, {
							state,
							language,
							unavailable: busy || state.busy || state.safeMode,
							run: (command) => {
								run(() => adapter.command(command));
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsMaterialField",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshDesktopSettingsToggleLabel",
								children: t("日志级别", "Log level")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsSelect, {
								ariaLabel: t("日志级别", "Log level"),
								value: state.preferences.logLevel,
								disabled: state.safeMode,
								options: [
									"debug",
									"info",
									"warn",
									"error"
								].map((value) => ({
									value,
									label: value
								})),
								onChange: (logLevel) => {
									savePreference({ logLevel });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopSettingsToggleRow, {
							label: t("开发者日志", "Developer logging"),
							description: t("记录模型请求、工具执行和通信的耗时与结果，以及每 30 秒一次的内存使用情况，不记录聊天正文或工具输入输出。日志保留七天，最多占用 200 MiB。会话事件可按序号与官方 Session Log 对照。", "Record model requests, tool execution and communication timing and outcomes, plus memory usage every 30 seconds, without chat bodies or tool inputs and outputs. History is retained for seven days, up to 200 MiB. Match session events to the official Session Log by sequence number."),
							checked: state.preferences.developerLogging,
							disabled: state.safeMode,
							onChange: (developerLogging) => {
								savePreference({ developerLogging });
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopSettingsUpdateRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshDesktopSettingsChoiceCopy",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshDesktopSettingsChoiceTitle",
									children: t("恢复助手", "Recovery assistant")
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshDesktopSettingsButton",
								onClick: () => {
									run(() => adapter.command({
										type: "controls",
										page: "recovery"
									}));
								},
								children: t("打开恢复助手", "Open recovery assistant")
							})]
						})
					]
				})
			] });
		}
		//#endregion
		//#region src/client/styles.ts
		/** Next-owned surfaces; window dragging belongs to the official frontend. */
		var STYLES$1 = `
.dshNextSafeModeNotice{position:absolute;right:16px;bottom:16px;max-width:300px;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px/1.5 system-ui,sans-serif;pointer-events:auto;-webkit-app-region:no-drag}
.dshNextSafeModeNotice p{margin:5px 0 8px}.dshNextSafeModeNotice button{font:inherit;border:1px solid currentColor;border-radius:5px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}

.dshNextSafeModeNotice .dshNextSafeModeDismiss{float:right;border:0;margin:-4px -4px 0 8px;padding:0 6px;font-size:20px;line-height:24px}

/* Respect the native-material preference without replacing official layout. */
html[data-next-material='off'][data-platform='darwin'] :has(> [data-shell-overlay]) {
  background: var(--dsw-alias-bg-base);
}

/* Keep Settings nav items at their 40x164 geometry and scroll with the official l2 gutter. */
body [data-shortcut-modal='settings'] > nav {
  min-height: 0;
}
body [data-shortcut-modal='settings'] > nav > :first-child,
body [data-shortcut-modal='settings'] > nav > :last-child > * {
  flex: none;
}
body [data-shortcut-modal='settings'] > nav > :last-child {
  flex: 1;
  min-height: 0;
  margin-right: -10px;
  padding-right: calc(10px - var(--dsh-scrollbar-width, 5px));
  padding-bottom: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
`;
		function installWindowStyles() {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-desktop-next/window-controls";
			style.textContent = STYLES$1;
			document.head.append(style);
			return () => style.remove();
		}
		//#endregion
		//#region src/client/onboarding.tsx
		/** Sequence existing Desktop setup content inside the official onboarding surface. */
		function pendingSnapshot(value) {
			return value?.required || value?.accountPending || value?.restartPending ? value : null;
		}
		function registerDesktopOnboarding(ctx, content) {
			const bridge = window.dshDesktopSetup;
			if (!bridge) return;
			ctx.slots.inject("onboarding.desktop.before", () => ctx.slots.register({
				name: "onboarding.desktop.before",
				inject: () => ({
					bridge,
					content,
					zh: ctx.locale.getLocale().active.startsWith("zh")
				})
			}, DesktopOnboarding));
		}
		function DesktopOnboarding({ bridge, content, zh, renderSurface, renderLoading, renderNext, renderNavigation, accountStatus, openLogin }) {
			const [snapshot, setSnapshot] = (0, react.useState)();
			const [error, setError] = (0, react.useState)("");
			const [revision, refresh] = (0, react.useState)(0);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let disposed = false;
				bridge.read().then((value) => {
					if (disposed) return;
					setError("");
					setSnapshot(pendingSnapshot(value));
				}).catch((cause) => {
					if (!disposed) setError(String(cause));
				});
				return () => {
					disposed = true;
				};
			}, [bridge, revision]);
			(0, react.useEffect)(() => {
				if (!snapshot?.accountPending || snapshot.required || accountStatus !== "credential-stored") return;
				let disposed = false;
				bridge.dismissAccount(snapshot.profile).then(async () => {
					const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null;
					if (!disposed) setSnapshot(next);
				}).catch((cause) => {
					if (!disposed) setError(String(cause));
				});
				return () => {
					disposed = true;
				};
			}, [
				bridge,
				snapshot,
				accountStatus
			]);
			if (error) return renderSurface(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "alert",
				style: { padding: 48 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					onClick: () => {
						setError("");
						setSnapshot(void 0);
						refresh((value) => value + 1);
					},
					children: zh ? "重试" : "Retry"
				})]
			}));
			if (snapshot === void 0) return renderLoading();
			if (snapshot === null) return renderNext();
			if (!snapshot.required && !snapshot.accountPending) {
				const apply = async () => {
					if (busy || !bridge.applyPending) return;
					setBusy(true);
					try {
						await bridge.applyPending(snapshot.profile);
						setSnapshot(null);
					} catch (cause) {
						setError(String(cause));
					} finally {
						setBusy(false);
					}
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderNext(), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
					tone: "success",
					holdMs: 8e3,
					text: zh ? "桌面设置已保存，下次重启后生效。" : "Desktop settings saved. They will take effect after restarting.",
					actions: [{
						label: zh ? "立即重启" : "Restart now",
						onClick: () => {
							apply();
						}
					}],
					onDone: () => {
						setSnapshot(null);
					}
				})] });
			}
			if (!snapshot.required) {
				if (accountStatus === "credential-stored") return renderLoading();
				const dismiss = async (login) => {
					if (busy) return;
					setBusy(true);
					try {
						await bridge.dismissAccount(snapshot.profile);
						const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null;
						setSnapshot(next);
						if (login) openLogin();
					} catch (cause) {
						setError(String(cause));
					} finally {
						setBusy(false);
					}
				};
				return renderSurface(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
					className: "dshDesktopAccountSetup",
					"aria-labelledby": "desktop-account-title",
					"aria-busy": busy,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							id: "desktop-account-title",
							children: zh ? "桌面设置已完成" : "Desktop setup is complete"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: zh ? `登录 DeepSeek，开始使用 Profile「${snapshot.profile}」。` : `Sign in to DeepSeek to get started with Profile “${snapshot.profile}”.` }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: zh ? "登录后，如当前 Profile 尚未完成官方引导，将继续进行设置。你也可以在登录窗口中选择使用 API Key，或稍后登录。" : "After sign-in, any unfinished official setup for this Profile will continue. You can also choose an API key in the sign-in dialog, or sign in later." }),
						accountStatus === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: zh ? "暂时无法读取登录状态，可以稍后在账号菜单中登录。" : "Account status is unavailable. You can sign in later from the account menu."
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshDesktopAccountActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								disabled: busy || accountStatus !== "signed-out",
								onClick: () => {
									dismiss(true);
								},
								children: zh ? "登录 DeepSeek" : "Sign in to DeepSeek"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: busy,
								onClick: () => {
									dismiss(false);
								},
								children: zh ? "暂时跳过" : "Not now"
							})]
						})
					] })
				}));
			}
			return renderSurface(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshDesktopSetupContent",
				"data-platform": snapshot.input.platform,
				children: content(snapshot, zh ? "zh" : "en", async (profile, selection) => {
					await bridge.finish(profile, selection);
					if (snapshot.edition === "desktop") try {
						setSnapshot(pendingSnapshot(await bridge.read()));
					} catch (cause) {
						setError(String(cause));
					}
					else setSnapshot(selection === void 0 ? null : void 0);
				}, renderNavigation)
			}));
		}
		//#endregion
		//#region ../dsh-community-market/src/client/api.ts
		async function readJson(response) {
			const value = await response.json();
			if (!response.ok) throw new MarketApiError(typeof value.error === "string" ? value.error : `request failed: ${response.status}`, response.status, typeof value.code === "string" ? value.code : void 0, typeof value.details === "string" ? value.details : void 0);
			return value;
		}
		/** HTTP facts used to localize safe Client-facing Market failures. */
		var MarketApiError = class extends Error {
			status;
			code;
			details;
			constructor(message, status, code, details) {
				super(message);
				this.status = status;
				this.code = code;
				this.details = details;
				this.name = "MarketApiError";
			}
		};
		async function readMarketState(signal) {
			return await readJson(await fetch("/api/community-market/state", {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		//#endregion
		//#region src/client/computer-use-command-ui.tsx
		var COMPUTER_USE_COMMAND_NAME = "computer-use";
		function isOrderedSubsequence(target, query) {
			if (query.length === 0) return true;
			if (query.length > target.length) return false;
			let queryIndex = 0;
			for (let index = 0; index < target.length && queryIndex < query.length; index += 1) if (target.charAt(index) === query.charAt(queryIndex)) queryIndex += 1;
			return queryIndex === query.length;
		}
		function ComputerUseCommandIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				stroke: "currentColor",
				strokeWidth: 1,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.53 2.43L7.02 4.24" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12.05 3.88L10.72 5.21" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.49 6.45L4.32 6.94" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.96 11.97L5.29 10.64" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.99 7.9L14.24 9.84L11.14 11.12L9.89 14.15Z" })
				]
			});
		}
		function ComputerUsePluginArtwork({ size = 36, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				className,
				viewBox: "0 0 36 36",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
					stroke: "url(#dsh-next-computer-use-art)",
					strokeWidth: 2.2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.9 7.93L15.73 11.01" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M24.29 10.4L22.02 12.66" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8.03 14.77L11.14 15.6" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.53 24.15L12.79 21.89" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: "M17.38 17.23L28.01 20.53L22.74 22.7L20.61 27.86Z",
							fill: "url(#dsh-next-computer-use-art)",
							fillOpacity: .2
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
					id: "dsh-next-computer-use-art",
					x1: "8",
					y1: "8",
					x2: "28",
					y2: "28",
					gradientUnits: "userSpaceOnUse",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", { stopColor: "#54ECE7" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
						offset: "1",
						stopColor: "#658EFF"
					})]
				}) })]
			});
		}
		function computerUseCommandCopy(zh) {
			return zh ? {
				label: "电脑操作（Next）",
				description: "开启或关闭 Computer Use（Next）"
			} : {
				label: "Computer Use (Next)",
				description: "Enable or disable Computer Use (Next)"
			};
		}
		function enrichComputerUseCandidate(candidate, zh) {
			if (candidate.name !== COMPUTER_USE_COMMAND_NAME) return candidate;
			const copy = computerUseCommandCopy(zh);
			return {
				...candidate,
				label: copy.label,
				description: copy.description,
				icon: ComputerUseCommandIcon
			};
		}
		function enrichComputerUseCandidates(candidates, zh) {
			let changed = false;
			const next = candidates.map((candidate) => {
				const enriched = enrichComputerUseCandidate(candidate, zh);
				if (enriched !== candidate) changed = true;
				return enriched;
			});
			return changed ? next : candidates;
		}
		function decorateCommandTriggerSource(source, isZh) {
			if (source.trigger !== "/" || source.name !== "command") return () => {};
			const target = source;
			const originalCandidates = target.candidates.bind(source);
			target.candidates = async (session, req) => {
				const zh = isZh();
				const enriched = enrichComputerUseCandidates(await originalCandidates(session, req), zh);
				if (req.query !== "" && !enriched.some((row) => row.name === COMPUTER_USE_COMMAND_NAME)) {
					const lowerLabel = computerUseCommandCopy(zh).label.toLowerCase();
					const lowerQuery = req.query.toLowerCase();
					if (isOrderedSubsequence(lowerLabel, lowerQuery)) {
						const rawTarget = (await originalCandidates(session, {
							...req,
							query: ""
						})).find((row) => row.name === COMPUTER_USE_COMMAND_NAME);
						if (rawTarget !== void 0) {
							const { section: _section, ...withoutSection } = rawTarget;
							const candidate = enrichComputerUseCandidate(withoutSection, zh);
							return lowerLabel.startsWith(lowerQuery) ? [candidate, ...enriched] : [...enriched, candidate];
						}
					}
				}
				return enriched;
			};
			return () => {
				target.candidates = originalCandidates;
			};
		}
		function registerComputerUseCommandUi(ctx) {
			ctx.inject(["inputTriggers", "locale"], (inner) => {
				inner.effect(() => {
					const t = inner.locale.bind("desktop-next");
					const isZh = () => t("language") === "zh";
					const disposers = /* @__PURE__ */ new Set();
					const decorated = /* @__PURE__ */ new WeakSet();
					const attach = (source) => {
						if (decorated.has(source)) return;
						if (source.trigger !== "/" || source.name !== "command") return;
						decorated.add(source);
						const dispose = decorateCommandTriggerSource(source, isZh);
						disposers.add(() => {
							dispose();
							decorated.delete(source);
						});
					};
					const service = inner.inputTriggers;
					for (const existing of service.live?.sources ?? []) attach(existing);
					const originalRegisterSource = service.registerSource.bind(inner.inputTriggers);
					service.registerSource = (src) => {
						attach(src);
						return originalRegisterSource(src);
					};
					return () => {
						service.registerSource = originalRegisterSource;
						for (const dispose of disposers) dispose();
						disposers.clear();
					};
				}, "Decorate /computer-use command trigger row");
			});
		}
		//#endregion
		//#region src/client/computer-use.tsx
		/** Configure the shipped provider through the official Plugins slot and manager. */
		var PROVIDER = "@deepseek-ai/dsh-experimental-computer-use-cua-driver-native";
		var COMPUTER_USE_SETTINGS_ROUTE = "/api/desktop-next/computer-use";
		/** The official Computer Use bundle and its macOS provider, which take over PTC sessions while the bundle is on. */
		var OFFICIAL_BUNDLE = "@deepseek-ai/dsh-cua-bundle";
		var OFFICIAL_PROVIDER = "@deepseek-ai/dsh-experimental-cua-macos";
		var computerUseCache = /* @__PURE__ */ new WeakMap();
		function getComputerUseCache(context) {
			let entry = computerUseCache.get(context);
			if (!entry) {
				entry = {
					loaded: false,
					row: void 0,
					commandMode: true,
					commandModeLoaded: false
				};
				computerUseCache.set(context, entry);
			}
			return entry;
		}
		function ComputerUseSettings({ context, zh, mode = "overview" }) {
			const t = (chinese, english) => zh ? chinese : english;
			const cache = getComputerUseCache(context);
			const [revision, refresh] = (0, react.useState)(0);
			const [row, setRow] = (0, react.useState)(() => cache.row);
			const [loading, setLoading] = (0, react.useState)(() => !cache.loaded);
			const [busy, setBusy] = (0, react.useState)(false);
			const [commandMode, setCommandMode] = (0, react.useState)(() => cache.commandMode);
			const [commandBusy, setCommandBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [official, setOfficial] = (0, react.useState)(void 0);
			const [officialProvider, setOfficialProvider] = (0, react.useState)(void 0);
			const [officialSupported, setOfficialSupported] = (0, react.useState)(false);
			const [officialBusy, setOfficialBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const reload = () => {
					refresh((value) => value + 1);
				};
				const off = context.remote.$on("plugin-manager/changed", reload);
				const reset = context.on("connection/reset", reload);
				window.addEventListener("focus", reload);
				return () => {
					off();
					reset();
					window.removeEventListener("focus", reload);
				};
			}, [context]);
			(0, react.useEffect)(() => {
				let disposed = false;
				if (!cache.loaded) setLoading(true);
				context.remote.pluginManager.listPlugins().then((result) => {
					if (disposed) return;
					if (!result.ok) throw new Error(result.error.message);
					const rows = result.value.filter((item) => item.moduleName === PROVIDER);
					const next = rows.length === 1 ? rows[0] : void 0;
					cache.row = next;
					cache.loaded = true;
					setRow(next);
					setOfficialProvider(result.value.find((item) => item.moduleName === OFFICIAL_PROVIDER));
				}).catch((failure) => {
					if (!disposed) {
						if (!cache.loaded) setRow(void 0);
						setError(String(failure));
					}
				}).finally(() => {
					if (!disposed) setLoading(false);
				});
				return () => {
					disposed = true;
				};
			}, [
				cache,
				context,
				revision
			]);
			(0, react.useEffect)(() => {
				if (mode !== "page") return;
				let disposed = false;
				context.remote.pluginManager.listBundles().then((result) => {
					if (disposed) return;
					if (!result.ok) throw new Error(result.error.message);
					setOfficial(result.value.find((bundle) => bundle.name === OFFICIAL_BUNDLE));
				}).catch((failure) => {
					if (!disposed) setError(String(failure));
				});
				return () => {
					disposed = true;
				};
			}, [
				context,
				mode,
				revision
			]);
			(0, react.useEffect)(() => {
				if (mode !== "page" || typeof fetch !== "function") return;
				let disposed = false;
				fetch(COMPUTER_USE_SETTINGS_ROUTE, { method: "GET" }).then(async (response) => {
					if (!response.ok) return;
					const payload = await response.json();
					if (!disposed && payload && typeof payload.commandMode === "boolean") {
						cache.commandMode = payload.commandMode;
						cache.commandModeLoaded = true;
						setCommandMode(payload.commandMode);
					}
					if (!disposed) setOfficialSupported(payload?.officialSupported === true);
				}).catch(() => {});
				return () => {
					disposed = true;
				};
			}, [
				cache,
				mode,
				revision
			]);
			const change = async (enabled) => {
				if (!row || busy || loading) return;
				setBusy(true);
				setError("");
				setNotice("");
				try {
					const result = await context.remote.pluginManager.setPluginEnabled(row.entryId, enabled);
					if (!result.ok) throw new Error(result.error.message);
					const change = result.value;
					if (change.application === "failed") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
					if (change.application === "restart-required") setNotice(t("已保存，请重启后台服务以应用。", "Saved. Restart the background service to apply."));
					if (change.application === "overridden") setNotice(t("已保存，但当前配置覆盖了此开关。", "Saved, but another configuration overrides this switch."));
					const next = {
						...row,
						enabled
					};
					cache.row = next;
					setRow(next);
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
					refresh((value) => value + 1);
				}
			};
			const changeCommandMode = async (nextMode) => {
				if (busy || commandBusy || loading) return;
				setCommandBusy(true);
				setError("");
				setNotice("");
				try {
					const response = await fetch(COMPUTER_USE_SETTINGS_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ commandMode: nextMode })
					});
					if (!response.ok) throw new Error(t("无法保存 Computer Use（Next）命令模式设置。", "Could not save the Computer Use (Next) command mode setting."));
					const payload = await response.json();
					const resolved = payload && typeof payload.commandMode === "boolean" ? payload.commandMode : nextMode;
					cache.commandMode = resolved;
					cache.commandModeLoaded = true;
					setCommandMode(resolved);
					setNotice(resolved ? t("已开启按需命令加载（/computer-use）。", "On-demand command loading (/computer-use) enabled.") : t("已关闭按需命令加载，Computer Use（Next）工具将在所有会话中常驻。", "On-demand command loading disabled; Computer Use (Next) tools remain active across sessions."));
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setCommandBusy(false);
				}
			};
			const changeOfficial = async (enabled) => {
				if (!official || officialBusy) return;
				setOfficialBusy(true);
				setError("");
				setNotice("");
				try {
					const result = await context.remote.pluginManager.setBundleEnabled(OFFICIAL_BUNDLE, enabled);
					if (!result.ok) throw new Error(result.error.message);
					const change = result.value;
					if (change.application === "failed" || change.application === "cancelled") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
					if (change.application === "restart-required") setNotice(t("已保存，请重启后台服务以应用。", "Saved. Restart the background service to apply."));
					if (change.application === "overridden") setNotice(t("已保存，但当前配置覆盖了此开关。", "Saved, but another configuration overrides this switch."));
					setOfficial({
						...official,
						enabled
					});
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setOfficialBusy(false);
					refresh((value) => value + 1);
				}
			};
			const status = loading ? t("正在读取…", "Loading…") : !row ? t("当前 Profile 中不可用", "Unavailable in this Profile") : !row.enabled ? t("已停用", "Disabled") : row.fiberPhase === "active" ? t("运行中", "Running") : row.fiberPhase === "failed" ? t("加载失败", "Failed to load") : t("等待加载", "Waiting to load");
			const commandSwitchLabel = t("按需命令加载（/computer-use）", "On-demand command loading (/computer-use)");
			const commandActive = Boolean(row?.enabled && commandMode);
			const officialAvailable = officialSupported && official !== void 0;
			const officialActive = officialAvailable && official.enabled && officialProvider?.fiberPhase === "active";
			const components = official === void 0 ? [commandActive] : [commandActive, officialActive];
			const running = components.filter(Boolean).length;
			const componentCount = [
				t(`共 ${String(components.length)} 个`, `${String(components.length)} total`),
				...running > 0 ? [t(`${String(running)} 运行中`, `${String(running)} running`)] : [],
				...running < components.length ? [t(`${String(components.length - running)} 已停用`, `${String(components.length - running)} off`)] : []
			].join(" · ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextComputerUse",
				"data-next-computer-use": true,
				children: [
					mode !== "page" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshNextPluginActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopPermissionsButton, {
							service: window.desktopNext?.permissions,
							language: zh ? "zh" : "en",
							label: t("权限设置", "Permission settings")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							label: t("启用 Computer Use（Next）", "Enable Computer Use (Next)"),
							checked: row?.enabled ?? false,
							disabled: loading || busy || !row || row.readOnlyReason !== void 0,
							onChange: (enabled) => {
								change(enabled);
							}
						})]
					}) }),
					mode === "page" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshDesktopSettingsHint",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: PROVIDER })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							role: "status",
							className: "dshNextPermissionStatus",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: row?.enabled && row.fiberPhase === "active" ? "done" : row?.fiberPhase === "failed" ? "error" : "idle" }), status]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dshNextComponentSection",
							"data-next-computer-use-options": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshNextComponentSectionHead",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: "dshNextComponentSectionTitle",
									children: t("包含的组件", "Components")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshNextComponentSectionCount",
									children: componentCount
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: "dshNextComponentRows",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
									className: "dshNextComponentRow",
									"data-plugin-row": "computer-use-command",
									...commandActive ? {} : { "data-state": "off" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dshNextComponentRowLine",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dshNextComponentRowIcon",
												"aria-hidden": "true",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUsePluginArtwork, { size: 30 })
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dshNextComponentRowMain",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dshNextComponentRowId",
														children: commandSwitchLabel
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dshNextComponentRowModule",
														children: t("默认开启：普通会话不常驻加载 Computer Use（Next）工具与系统提示词，避免占用上下文；需要时可在会话中通过 /computer-use 命令手动加载（/computer-use off 关闭）。若关闭此项，则恢复在所有会话中常驻加载。", "Enabled by default: Computer Use (Next) tools and guidance are not loaded into sessions by default to save context; run /computer-use in a session to load them on demand (/computer-use off to unload). Turn off to keep them resident in all sessions.")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														className: "dshNextComponentRowModule",
														children: "computer-use"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														className: "dshNextComponentRowModule",
														children: PROVIDER
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dshNextComponentRowState",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: commandActive ? "done" : "idle" }), commandActive ? t("运行中", "Running") : t("已关闭", "Off")]
											}),
											row?.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
												label: commandSwitchLabel,
												checked: commandMode,
												disabled: loading || busy || commandBusy,
												onChange: (enabled) => {
													changeCommandMode(enabled);
												}
											}) : null
										]
									})
								}), official !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfficialComputerUseRow, {
									t,
									official,
									provider: officialProvider,
									available: officialAvailable,
									disabled: loading || officialBusy || official.readOnlyReason !== void 0,
									onChange: (enabled) => {
										changeOfficial(enabled);
									},
									onOpen: () => {
										context.get("pluginNavigation")?.openBundle(OFFICIAL_BUNDLE);
									}
								})]
							})]
						}),
						window.desktopNext?.permissions ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermissionDetails, {
							service: window.desktopNext.permissions,
							language: zh ? "zh" : "en"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("请在运行 DSH 的桌面应用中管理系统权限。", "Manage system permissions in the desktop app running DSH.") })
					] }),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: notice,
						onDone: () => {
							setNotice("");
						}
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: error,
						onDone: () => {
							setError("");
						}
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshNextPluginActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							onClick: () => {
								setError("");
								refresh((value) => value + 1);
							},
							children: t("重试", "Retry")
						})
					})
				]
			});
		}
		/**
		* The switch for the official Computer Use bundle. Where it cannot run, it stays off and refuses input. While the bundle
		* is on, the whole row opens the bundle's own page; the switch keeps its own clicks.
		* @param props.official - the bundle as the plugin manager lists it.
		* @param props.provider - the bundle's macOS provider row, once the bundle has loaded.
		* @param props.available - whether this system can run the official Computer Use.
		* @param props.disabled - whether a read or write is in flight or the profile locks the bundle.
		* @param props.onOpen - open the bundle's page in the Plugins panel.
		*/
		function OfficialComputerUseRow({ t, official, provider, available, disabled, onChange, onOpen }) {
			const enabled = available && official.enabled;
			const active = enabled && provider?.fiberPhase === "active";
			const failed = enabled && !active && (official.error !== void 0 || provider?.fiberPhase === "failed");
			const state = !available ? t("当前系统不支持", "Not supported on this system") : !enabled ? t("已关闭", "Off") : active ? t("运行中", "Running") : failed ? t("加载失败", "Failed to load") : t("等待加载", "Waiting to load");
			const title = t("官方 Computer Use", "Official Computer Use");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: "dshNextComponentRow",
				"data-plugin-row": "official-computer-use",
				...active ? {} : { "data-state": "off" },
				...enabled ? { "data-opens": "" } : {},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshNextComponentRowLine",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshNextComponentRowIcon",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUsePluginArtwork, { size: 30 })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextComponentRowMain",
							children: [
								enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dshNextComponentRowOpen",
									onClick: onOpen,
									"aria-label": t("查看官方 Computer Use 的插件详情", "View the official Computer Use plugin details"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshNextComponentRowId",
										children: title
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: "dshNextComponentRowOpenIcon" })]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshNextComponentRowId",
									children: title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshNextComponentRowModule",
									children: t("仅支持 macOS 14 及以上的 PTC 模式。开启后，PTC 模式的会话改用官方 Computer Use，取代 Computer Use（Next）；其他模式仍使用 Computer Use（Next）。", "Supports PTC mode on macOS 14 and later only. When on, the official Computer Use replaces Computer Use (Next) in PTC sessions; other modes keep Computer Use (Next).")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: "dshNextComponentRowModule",
									children: OFFICIAL_BUNDLE
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshNextComponentRowState",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: active ? "done" : failed ? "error" : "idle" }), state]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshNextComponentRowSwitch",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
								label: t("启用官方 Computer Use", "Enable official Computer Use"),
								checked: enabled,
								disabled: !available || disabled,
								title: available ? void 0 : t("官方 Computer Use 仅支持 macOS 14 及以上", "The official Computer Use requires macOS 14 or later"),
								onChange
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/upstream-family-labels.ts
		/**
		* Official names that differ between the DSH releases Next and Beta follow. Like
		* src/upstream-family.ts, this file is a declared difference between the variants
		* (scripts/verify-desktop-variants.mjs); it stays free of imports because renderer bundles use it.
		*/
		/**
		* How the official `@deepseek-ai/dsh-experimental-plugin-market-bundle` presents itself in its locale files from 0.2.2 on.
		* Next's rc.4 bundle still calls itself "Custom plugin markets"; Desktop already uses the 0.2.2 name.
		*/
		var OFFICIAL_PLUGIN_INDEX = {
			title: {
				zh: "自定义插件索引",
				en: "Custom plugin indexes"
			},
			description: {
				zh: "在插件页添加“发现”标签页，从你添加的插件索引中浏览和安装插件。",
				en: "Adds a Discover tab to Plugins, where you browse and install plugins from plugin indexes you add."
			}
		};
		//#endregion
		//#region src/client/market-toggle.ts
		var COMMUNITY_MARKET = "dsh-community-market";
		var DSH_MARKET = "dshmarket";
		var OFFICIAL_MARKET = "@deepseek-ai/dsh-experimental-plugin-market-bundle";
		var BUILT_IN_MARKET_SOURCES = [
			{
				key: "dsh-1024store",
				bundle: COMMUNITY_MARKET,
				providerId: "com.deepseek1024.catalog",
				title: {
					zh: "DSH 1024Store（社区插件市场）",
					en: "DSH 1024Store (Community Market)"
				},
				description: {
					zh: "社区插件市场内置源，提供经过策展的插件目录与版本索引。",
					en: "Built-in Community Market provider with curated plugin listings and version metadata."
				},
				homepage: "https://deepseek1024.com",
				defaultSyncUrl: "https://deepseek1024.com/api/v2/plugins",
				sources: [{
					url: "https://deepseek1024.com/api/v2/plugins",
					label: {
						zh: "1024Store V2 插件目录源",
						en: "1024Store V2 catalog endpoint"
					},
					tags: [{
						zh: "默认源",
						en: "Default"
					}, {
						zh: "社区市场 V2",
						en: "Community V2"
					}]
				}, {
					url: "https://deepseek1024.com/api/v1/registry",
					label: {
						zh: "1024Store V1 注册表源",
						en: "1024Store V1 registry endpoint"
					},
					tags: [{
						zh: "备用源",
						en: "Mirror"
					}, {
						zh: "Registry V1",
						en: "Registry V1"
					}]
				}]
			},
			{
				key: "dshfind",
				bundle: COMMUNITY_MARKET,
				providerId: "com.dshfind.catalog",
				title: {
					zh: "dshfind（社区插件市场）",
					en: "dshfind (Community Market)"
				},
				description: {
					zh: `社区插件市场内置源，提供已适配“${OFFICIAL_PLUGIN_INDEX.title.zh}”格式（format 1）的插件目录索引源。`,
					en: `Built-in Community Market provider with a plugin directory index source adapted for the "${OFFICIAL_PLUGIN_INDEX.title.en}" format (format 1).`
				},
				homepage: "https://dshfind.com",
				defaultSyncUrl: "https://api.dshfind.com/market/dsh-index.json",
				sources: [
					{
						url: "https://api.dshfind.com/market/v1/plugins",
						label: {
							zh: "dshfind 市场目录源",
							en: "dshfind market catalog endpoint"
						},
						tags: [{
							zh: "默认源",
							en: "Default"
						}, {
							zh: "Market V1",
							en: "Market V1"
						}]
					},
					{
						url: "https://api.dshfind.com/market/manifest.json",
						label: {
							zh: "dshfind 市场 Manifest 源",
							en: "dshfind market manifest endpoint"
						},
						tags: [{
							zh: "Manifest 源",
							en: "Manifest"
						}]
					},
					{
						url: "https://api.dshfind.com/v1/catalog",
						label: {
							zh: "dshfind 全量快照目录源",
							en: "dshfind full catalog snapshot"
						},
						tags: [{
							zh: "快照源",
							en: "Snapshot"
						}, {
							zh: "Catalog V1",
							en: "Catalog V1"
						}]
					},
					{
						url: "https://api.dshfind.com/market/dsh-index.json",
						label: {
							zh: "dshfind 索引源（DSH 插件目录）",
							en: "dshfind index source (DSH Plugin Directory)"
						},
						tags: [{
							zh: "全量索引",
							en: "Full index"
						}, {
							zh: "format 1",
							en: "format 1"
						}],
						format1: true
					}
				]
			},
			{
				key: "dshmarket",
				bundle: DSH_MARKET,
				title: {
					zh: "dsh-market（Awesome DSH Plugin）",
					en: "dsh-market (Awesome DSH Plugin)"
				},
				description: {
					zh: `第三方插件市场，提供已适配“${OFFICIAL_PLUGIN_INDEX.title.zh}”格式（format 1）的国内 CDN 与 GitHub Pages 索引源。`,
					en: `Third-party plugin market with China CDN and GitHub Pages index sources adapted for the "${OFFICIAL_PLUGIN_INDEX.title.en}" format (format 1).`
				},
				homepage: "https://awesome-dsh-plugin.com",
				defaultSyncUrl: "https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json",
				sources: [{
					url: "https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json",
					label: {
						zh: "dsh-market 索引源（jsDelivr CDN 国内加速）",
						en: "dsh-market index source (jsDelivr CDN China mirror)"
					},
					tags: [{
						zh: "国内推荐",
						en: "China CDN"
					}, {
						zh: "format 1",
						en: "format 1"
					}],
					format1: true,
					region: "china"
				}, {
					url: "https://realguan.github.io/dsh-plugin-market/dsh-index.json",
					label: {
						zh: "dsh-market 索引源（GitHub Pages 国际源）",
						en: "dsh-market index source (GitHub Pages Global)"
					},
					tags: [{
						zh: "国际源 Global",
						en: "Global"
					}, {
						zh: "format 1",
						en: "format 1"
					}],
					format1: true,
					region: "global"
				}]
			}
		];
		/**
		* Built-in markets currently displayed and configurable for the official plugin index bundle
		* (`@deepseek-ai/dsh-experimental-plugin-market-bundle`), narrowed to the `format: 1` `dsh-index.json` endpoints they publish.
		* Quick configuration adds the default source of each; `dshmarket` stays first because it is the fallback selection.
		*/
		var OFFICIAL_CONFIGURABLE_MARKET_SOURCES = ["dshmarket", "dshfind"].flatMap((key) => BUILT_IN_MARKET_SOURCES.filter((item) => item.key === key)).map((item) => ({
			...item,
			sources: item.sources.filter((source) => source.format1 === true)
		}));
		function editable(row) {
			return row.readOnlyReason === void 0 && row.error === void 0;
		}
		/** Disabling both handles older Profiles with two selected markets; enabling prefers the last choice. */
		function marketToggleTargets(rows, preferred, enable) {
			const markets = rows.filter((row) => row.name === "dsh-community-market" || row.name === "dshmarket");
			if (!enable) {
				const active = markets.filter((row) => row.enabled);
				return active.every(editable) ? active.map((row) => row.name) : [];
			}
			const preferredRow = markets.find((row) => row.name === preferred && editable(row));
			const fallback = markets.find((row) => editable(row));
			return preferredRow ? [preferredRow.name] : fallback ? [fallback.name] : [];
		}
		/** Resolve which of the 3 built-in markets and source endpoints is currently active on Desktop. */
		function resolveActiveMarketSource(rows, preferred = COMMUNITY_MARKET, runtime = {}) {
			const community = rows.find((row) => row.name === COMMUNITY_MARKET);
			const dshMarket = rows.find((row) => row.name === DSH_MARKET);
			const enabledBundle = dshMarket?.enabled && !community?.enabled ? DSH_MARKET : community?.enabled ? COMMUNITY_MARKET : dshMarket?.enabled ? DSH_MARKET : null;
			if ((enabledBundle ?? preferred) === "dshmarket") {
				const region = runtime.dshMarketRegion ?? "china";
				return {
					enabled: enabledBundle !== null,
					bundle: enabledBundle,
					marketKey: "dshmarket",
					desktopActiveUrl: enabledBundle ? region === "global" ? "https://awesome-dsh-plugin.com/plugins.json" : "https://mirrors.cloud.tencent.com/npm/dsh-plugin-catalog/latest" : null,
					syncUrl: region === "global" ? "https://realguan.github.io/dsh-plugin-market/dsh-index.json" : "https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json",
					region
				};
			}
			const enabledCommunity = runtime.communitySources?.find((source) => source.enabled);
			const isDshfind = enabledCommunity?.builtInProviderKey === "dshfind" || enabledCommunity?.providerId === "com.dshfind.catalog";
			const marketKey = isDshfind ? "dshfind" : "dsh-1024store";
			const defaultUrl = isDshfind ? "https://api.dshfind.com/market/v1/plugins" : "https://deepseek1024.com/api/v2/plugins";
			const endpoint = enabledCommunity?.endpoint?.trim();
			const activeUrl = endpoint && URL.canParse(endpoint) ? endpoint : defaultUrl;
			return {
				enabled: enabledBundle !== null,
				bundle: enabledBundle,
				marketKey,
				desktopActiveUrl: enabledBundle ? activeUrl : null,
				syncUrl: isDshfind ? "https://api.dshfind.com/market/dsh-index.json" : activeUrl
			};
		}
		/** Resolve the primary sync URL and endpoints for a specific built-in market key. */
		function resolveMarketSourceByKey(marketKey, runtime = {}) {
			if (marketKey === "dshmarket") {
				const region = runtime.dshMarketRegion ?? "china";
				return {
					marketKey: "dshmarket",
					desktopActiveUrl: region === "global" ? "https://awesome-dsh-plugin.com/plugins.json" : "https://mirrors.cloud.tencent.com/npm/dsh-plugin-catalog/latest",
					syncUrl: region === "global" ? "https://realguan.github.io/dsh-plugin-market/dsh-index.json" : "https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json",
					region
				};
			}
			const providerId = marketKey === "dshfind" ? "com.dshfind.catalog" : "com.deepseek1024.catalog";
			const matched = runtime.communitySources?.find((source) => source.builtInProviderKey === marketKey || source.providerId === providerId);
			const defaultUrl = marketKey === "dshfind" ? "https://api.dshfind.com/market/v1/plugins" : "https://deepseek1024.com/api/v2/plugins";
			const endpoint = matched?.endpoint?.trim();
			const url = endpoint && URL.canParse(endpoint) ? endpoint : defaultUrl;
			return {
				marketKey,
				desktopActiveUrl: url,
				syncUrl: marketKey === "dshfind" ? "https://api.dshfind.com/market/dsh-index.json" : url
			};
		}
		function deduplicateUrls(candidates) {
			const seen = /* @__PURE__ */ new Set();
			const result = [];
			for (const raw of candidates) {
				const trimmed = raw.trim();
				if (!trimmed || !URL.canParse(trimmed)) continue;
				const key = new URL(trimmed).href;
				if (seen.has(key)) continue;
				seen.add(key);
				result.push(trimmed);
			}
			return result;
		}
		/**
		* Quick configuration selects the index of the market in use when that market publishes one, and otherwise
		* (no market enabled, or 1024Store) the `dshmarket` index for the current region.
		*/
		function quickConfigurationUrl(resolution, runtime) {
			return resolution.enabled && OFFICIAL_CONFIGURABLE_MARKET_SOURCES.some((item) => item.key === resolution.marketKey) ? resolution.syncUrl : resolveMarketSourceByKey("dshmarket", runtime).syncUrl;
		}
		/**
		* Build the deduplicated list of index URLs for "Quick configuration" (`pluginMarket.setIndexes`): the selected source
		* first, then the default source of every official-configurable market, followed by any existing user URLs.
		*/
		function orderedMarketSourceUrls(resolution, existingUrls = [], runtime = {}) {
			const defaultUrls = OFFICIAL_CONFIGURABLE_MARKET_SOURCES.map((item) => item.key === resolution.marketKey ? resolution.syncUrl : resolveMarketSourceByKey(item.key, runtime).syncUrl);
			return deduplicateUrls([
				quickConfigurationUrl(resolution, runtime),
				...defaultUrls,
				...existingUrls
			]);
		}
		var PREFETCH_WAIT_TIMEOUT_MS = 2500;
		/**
		* Preload configured market index URLs into the Host `PluginMarket` cache so their titles
		* are immediately available in the Discover source dropdown without selecting each source first.
		*/
		async function prefetchMarketIndexes(pluginMarket, urls, timeoutMs = PREFETCH_WAIT_TIMEOUT_MS) {
			if (typeof pluginMarket.search !== "function" || urls.length === 0) return;
			const preloadAll = Promise.allSettled(urls.map((url) => pluginMarket.search(url, {
				sort: { kind: "index" },
				offset: 0,
				limit: 1
			})));
			if (timeoutMs <= 0) {
				await preloadAll;
				return;
			}
			let timer;
			try {
				await Promise.race([preloadAll, new Promise((resolve) => {
					timer = setTimeout(resolve, timeoutMs);
				})]);
			} finally {
				if (timer !== void 0) clearTimeout(timer);
			}
		}
		async function applyOfficialIndexes(remote, syncedUrl, configuredUrls, existingUrls, officialBundleEnabled) {
			let application = "applied";
			if (!officialBundleEnabled) {
				const enableResult = await remote.pluginManager.setBundleEnabled(OFFICIAL_MARKET, true);
				if (!enableResult.ok) throw new Error(enableResult.error.message);
				application = enableResult.value.application;
				if (application === "failed" || application === "cancelled") throw new Error(enableResult.value.error?.diagnostic ?? `Could not enable the official "${OFFICIAL_PLUGIN_INDEX.title.en}".`);
			}
			if (existingUrls.length > 0 && existingUrls[0] !== syncedUrl) {
				const primeResult = await remote.pluginMarket.setIndexes([syncedUrl]);
				if (!primeResult.ok) throw new Error(primeResult.error.message);
			}
			const saveResult = await remote.pluginMarket.setIndexes(configuredUrls);
			if (!saveResult.ok) throw new Error(saveResult.error.message);
			await prefetchMarketIndexes(remote.pluginMarket, configuredUrls);
			return {
				application,
				syncedUrl,
				configuredUrls
			};
		}
		/**
		* Quick-configure the default source of every official-configurable built-in market into the official plugin index
		* bundle (`@deepseek-ai/dsh-experimental-plugin-market-bundle`), selecting the source of the market in use as the active index.
		*/
		async function importMarketSourcesToOfficial(remote, resolution, officialBundleEnabled, runtime = {}) {
			const existingResult = await remote.pluginMarket.listIndexes();
			const existingUrls = existingResult.ok ? existingResult.value.map((item) => item.url) : [];
			const configuredUrls = orderedMarketSourceUrls(resolution, existingUrls, runtime);
			return await applyOfficialIndexes(remote, quickConfigurationUrl(resolution, runtime), configuredUrls, existingUrls, officialBundleEnabled);
		}
		/**
		* Enable the official plugin index bundle (`@deepseek-ai/dsh-experimental-plugin-market-bundle`),
		* configure the `format: 1` sources of a single built-in market, and select its default source as the active index.
		*/
		async function configureSingleMarketToOfficial(remote, marketKey, runtime, officialBundleEnabled) {
			const target = resolveMarketSourceByKey(marketKey, runtime);
			const marketDef = OFFICIAL_CONFIGURABLE_MARKET_SOURCES.find((item) => item.key === marketKey);
			const marketUrls = marketDef ? marketDef.sources.map((source) => source.url) : [];
			const existingResult = await remote.pluginMarket.listIndexes();
			const existingUrls = existingResult.ok ? existingResult.value.map((item) => item.url) : [];
			const configuredUrls = deduplicateUrls([
				target.syncUrl,
				...marketUrls,
				...existingUrls
			]);
			return await applyOfficialIndexes(remote, target.syncUrl, configuredUrls, existingUrls, officialBundleEnabled);
		}
		/**
		* Remove all configured sources belonging to a single built-in market from the official plugin index bundle.
		*/
		async function removeMarketSourcesFromOfficial(remote, marketKey) {
			const marketDef = BUILT_IN_MARKET_SOURCES.find((item) => item.key === marketKey);
			const urlsToRemove = new Set(marketDef ? marketDef.sources.map((source) => source.url) : []);
			const existingResult = await remote.pluginMarket.listIndexes();
			const remainingUrls = (existingResult.ok ? existingResult.value.map((item) => item.url) : []).filter((url) => !urlsToRemove.has(url));
			const saveResult = await remote.pluginMarket.setIndexes(remainingUrls);
			if (!saveResult.ok) throw new Error(saveResult.error.message);
			return remainingUrls;
		}
		/**
		* Configure or unconfigure a specific sub-source endpoint URL in the official plugin index bundle.
		*/
		async function toggleMarketEndpointInOfficial(remote, endpointUrl, enable, officialBundleEnabled) {
			const existingResult = await remote.pluginMarket.listIndexes();
			const existingUrls = existingResult.ok ? existingResult.value.map((item) => item.url) : [];
			if (!enable) {
				const remainingUrls = existingUrls.filter((url) => url !== endpointUrl);
				const saveResult = await remote.pluginMarket.setIndexes(remainingUrls);
				if (!saveResult.ok) throw new Error(saveResult.error.message);
				return {
					application: "applied",
					syncedUrl: remainingUrls[0] ?? "",
					configuredUrls: remainingUrls
				};
			}
			return await applyOfficialIndexes(remote, endpointUrl, deduplicateUrls([endpointUrl, ...existingUrls]), existingUrls, officialBundleEnabled);
		}
		//#endregion
		//#region src/launch-presets.ts
		/** Host route reading (GET) and applying (POST `{ row, preset }`) the launch choices. */
		var LAUNCH_PRESETS_ROUTE = "/api/desktop-next/launch-presets";
		//#endregion
		//#region src/client/launch-presets.tsx
		/** Launch choices on the official Plugins page: one configuration page per bundle row, applied by the Host. */
		/** How soon after a row's page closes its bundle's page must open again to count as returning from it. */
		var RETURN_WINDOW_MS = 1e3;
		/**
		* Per client: where each bundle page was last scrolled, and which bundle's row page closed last. The official page
		* keeps one scroll container for every view, so the short row page clamps it; returning restores the position.
		*/
		var scrollPositions = /* @__PURE__ */ new WeakMap();
		var closedRowPages = /* @__PURE__ */ new WeakMap();
		/**
		* Give each row a configure control on its bundle's page, opening the row's launch choices, and tag the row in the
		* page's component list and on its own page with what it runs. Returning from a row's page restores where its
		* bundle's page was scrolled.
		* @param ctx - client context with the Plugins page slots and the Remote.
		* @param bundle - the rows and their choices.
		*/
		function registerLaunchPresets(ctx, bundle) {
			ctx.slots.inject("plugins.row.config", () => {
				const disposers = bundle.rows.map((row) => ctx.slots.register({
					name: "plugins.row.config",
					key: `${bundle.bundle}#${row.id}`,
					locale: "desktop-next",
					inject: () => ({
						context: ctx,
						bundle: bundle.bundle,
						row
					})
				}, LaunchPresetPage));
				return () => {
					for (const dispose of disposers) dispose();
				};
			});
			ctx.slots.inject("plugins.detail.badge", () => ctx.slots.register({
				name: "plugins.detail.badge",
				id: "desktop-next-launch-presets",
				inject: () => ({ bundle })
			}, LaunchPresetRowTag));
			ctx.slots.inject("plugins.detail.section", () => ctx.slots.register({
				name: "plugins.detail.section",
				id: "desktop-next-launch-presets",
				inject: () => ({
					context: ctx,
					bundle
				})
			}, BundlePageAdditions));
		}
		/** The row page's tag naming what the row runs. */
		function LaunchPresetRowTag({ subject, bundle }) {
			if (subject.kind !== "row" || subject.pkg.name !== bundle.bundle) return null;
			const row = bundle.rows.find((item) => item.id === subject.row.rowId);
			return row === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				className: "dshNextPluginStatusTag",
				tone: "info",
				children: row.tag
			});
		}
		/** A value as a quoted CSS string. */
		function cssString(value) {
			return `"${value.replace(/[\\"]/gu, "\\$&").replace(/\n/gu, "\\A ")}"`;
		}
		/**
		* Style sheet tagging each row in the bundle page's component list, beside the row's title control, as the official
		* info tags look. The official list draws its rows itself and has no slot there; its rows carry `data-plugin-row`.
		* @param bundle - the rows and their tags.
		* @returns rules scoped to the bundle's page.
		*/
		function rowTagStyles(bundle) {
			const selector = (row) => `[data-plugin-detail=${cssString(bundle.bundle)}] [data-plugin-row$=${cssString(row.id)}] button:first-child:not([role="switch"])::after`;
			return [`${bundle.rows.map(selector).join(", ")} { display: inline-flex; align-items: center; height: 18px; margin-left: 6px; padding: 0 7px; border-radius: 999px; font-size: 10px; line-height: 1; font-weight: 500; white-space: nowrap; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }`, ...bundle.rows.map((row) => `${selector(row)} { content: ${cssString(row.tag)}; }`)].join("\n");
		}
		/**
		* On the bundle's page: the rows' list tags, and its scroll position, recorded while it shows and restored when it
		* opens again from one of its rows' pages.
		*/
		function BundlePageAdditions({ subject, context, bundle }) {
			const anchor = (0, react.useRef)(null);
			const name = bundle.bundle;
			const ours = subject.kind === "bundle" && subject.pkg.name === name;
			(0, react.useEffect)(() => {
				const body = ours ? anchor.current?.closest("[data-plugin-body]") : null;
				if (body === null || body === void 0) return void 0;
				let positions = scrollPositions.get(context);
				if (positions === void 0) scrollPositions.set(context, positions = /* @__PURE__ */ new Map());
				const closed = closedRowPages.get(context);
				closedRowPages.delete(context);
				const top = positions.get(name);
				const returning = closed?.bundle === name && Date.now() - closed.at < RETURN_WINDOW_MS && top !== void 0;
				positions.set(name, returning ? top : body.scrollTop);
				const frame = returning ? requestAnimationFrame(() => {
					body.scrollTop = top;
				}) : void 0;
				const record = () => {
					positions.set(name, body.scrollTop);
				};
				body.addEventListener("scroll", record, { passive: true });
				return () => {
					if (frame !== void 0) cancelAnimationFrame(frame);
					body.removeEventListener("scroll", record);
				};
			}, [
				context,
				name,
				ours
			]);
			return ours ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: anchor,
				hidden: true
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: rowTagStyles(bundle) })] }) : null;
		}
		function LaunchPresetPage({ context, bundle, row, t, view }) {
			const zh = t("language") === "zh";
			if (view === "summary") return zh ? row.title.zh : row.title.en;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LaunchPresetForm, {
				context,
				bundle,
				row,
				zh
			});
		}
		/** The row's choices, staged until saved; the Host reports which one the row runs with. */
		function LaunchPresetForm({ context, bundle, row, zh }) {
			const t = (cn, en) => zh ? cn : en;
			const text = (value) => zh ? value.zh : value.en;
			(0, react.useEffect)(() => () => {
				closedRowPages.set(context, {
					bundle,
					at: Date.now()
				});
			}, [bundle, context]);
			const [state, setState] = (0, react.useState)(void 0);
			const [selected, setSelected] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [revision, refresh] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const reload = () => {
					refresh((value) => value + 1);
				};
				const off = context.remote.$on("plugin-manager/changed", reload);
				const reset = context.on("connection/reset", reload);
				return () => {
					off();
					reset();
				};
			}, [context]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				fetch(LAUNCH_PRESETS_ROUTE, {
					cache: "no-store",
					signal: controller.signal
				}).then(async (response) => {
					if (!response.ok) throw new Error(t("无法读取当前设置。", "Could not read the current setting."));
					const current = (await response.json()).rows?.find((item) => item.row === row.id);
					setState(current);
					setSelected((staged) => staged ?? current?.preset ?? null);
				}).catch((failure) => {
					if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
				}).finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
				return () => {
					controller.abort();
				};
			}, [
				context,
				row.id,
				revision
			]);
			const save = async () => {
				if (selected === null || saving) return;
				setSaving(true);
				setError("");
				setNotice("");
				try {
					const response = await fetch(LAUNCH_PRESETS_ROUTE, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							row: row.id,
							preset: selected
						})
					});
					const payload = await response.json();
					const current = payload.rows?.find((item) => item.row === row.id);
					if (current !== void 0) setState(current);
					if (!response.ok) throw new Error(payload.error === "inactive" ? t("这一行没有运行，开启插件和这一行后才能修改。", "This row is not running. Turn on the plugin and this row to change it.") : payload.error ?? t("无法保存设置。", "Could not save the setting."));
					setNotice(t("已保存，之后委派的任务按新设置启动。", "Saved. Tasks delegated from now on start with this setting."));
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setSaving(false);
				}
			};
			const active = state?.active === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextLaunchPresets",
				"data-next-launch-presets": row.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: "dshNextLaunchPresetsTitle",
						children: text(row.title)
					}),
					!loading && !active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshDesktopSettingsHint",
						children: t("这一行没有运行，开启插件和这一行后才能修改。", "This row is not running. Turn on the plugin and this row to change it.")
					}),
					active && state.preset === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshDesktopSettingsHint",
						children: t("这一行正在使用自定义启动参数，选择下面任一项会替换它们。", "This row runs with custom launch arguments; choosing an option below replaces them.")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshNextLaunchPresetChoices",
						role: "radiogroup",
						"aria-label": text(row.title),
						children: row.presets.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
							title: text(preset.title),
							body: text(preset.description),
							badge: preset.shipped === true ? t("默认", "Default") : preset.unrestricted === true ? t("不受限制", "Unrestricted") : void 0,
							selected: selected === preset.id,
							disabled: !active || saving,
							action: () => {
								setSelected(preset.id);
								setNotice("");
							}
						}, preset.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshNextPluginActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							size: "sm",
							disabled: !active || saving || selected === null || selected === state.preset,
							onClick: () => {
								save();
							},
							children: saving ? t("正在保存…", "Saving…") : t("保存", "Save")
						})
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "dshDesktopSettingsHint",
						children: notice
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "dshDesktopSettingsError",
						children: error
					})
				]
			});
		}
		//#endregion
		//#region src/client/plugin-controls.tsx
		/** Desktop choices on the official Plugins overview, using its manager and existing controls. */
		var REMOTE = "@agents-anywhere/dsh-bridge-next";
		var COMPUTER_ITEM = "desktop-next-computer-use";
		/** OAR subagents, when the followed release ships the provider. */
		var OAR_SUBAGENTS = void 0;
		/** Launch choices of the OAR provider rows, on their configuration pages. */
		var OAR_LAUNCH_PRESETS = void 0;
		var bundlesCache = /* @__PURE__ */ new WeakMap();
		function getBundlesCache(context) {
			let entry = bundlesCache.get(context);
			if (!entry) {
				const official = readOfficialBundles(context);
				const community = official?.find((row) => row.name === COMMUNITY_MARKET);
				const preferredMarket = (official?.find((row) => row.name === "dshmarket"))?.enabled && !community?.enabled ? DSH_MARKET : COMMUNITY_MARKET;
				entry = {
					loaded: official !== void 0,
					bundles: official ?? [],
					preferredMarket
				};
				bundlesCache.set(context, entry);
			} else if (!entry.loaded) {
				const official = readOfficialBundles(context);
				if (official !== void 0) {
					entry.loaded = true;
					entry.bundles = official;
					const community = official.find((row) => row.name === COMMUNITY_MARKET);
					const market = official.find((row) => row.name === DSH_MARKET);
					if (market?.enabled && !community?.enabled) entry.preferredMarket = DSH_MARKET;
					else if (community?.enabled && !market?.enabled) entry.preferredMarket = COMMUNITY_MARKET;
				}
			}
			return entry;
		}
		function registerPluginControls(ctx) {
			ctx.inject([
				"remote",
				"remote.pluginManager",
				"remote.pluginMarket"
			], (inner) => {
				inner.slots.inject("plugins.overview", () => {
					const dispose = inner.slots.register({
						name: "plugins.overview",
						id: "desktop-next",
						order: 0,
						locale: "desktop-next",
						inject: () => ({ context: inner })
					}, PluginControls);
					const hidden = [
						COMMUNITY_MARKET,
						DSH_MARKET,
						REMOTE,
						...OAR_SUBAGENTS === void 0 ? [] : [OAR_SUBAGENTS.bundle]
					].map((key) => inner.slots.register({
						name: "plugins.bundle.hidden",
						key
					}, () => null));
					const item = inner.slots.register({
						name: "plugins.item",
						id: COMPUTER_ITEM,
						label: () => inner.locale.bind("desktop-next")("language") === "zh" ? "Computer Use（Next）" : "Computer Use (Next)",
						locale: "desktop-next",
						inject: () => ({ context: inner })
					}, ComputerUseItem);
					const hiddenItem = inner.slots.register({
						name: "plugins.item.hidden",
						key: COMPUTER_ITEM
					}, () => null);
					const actions = inner.slots.register({
						name: "plugins.detail.actions",
						id: COMPUTER_ITEM,
						locale: "desktop-next",
						inject: () => ({ context: inner })
					}, ComputerUseActions);
					return () => {
						actions();
						hiddenItem();
						item();
						for (const off of hidden) off();
						dispose();
					};
				});
				if (OAR_LAUNCH_PRESETS !== void 0) registerLaunchPresets(inner, OAR_LAUNCH_PRESETS);
			});
		}
		function PluginControls({ context, t: translate, onOpenBundle, onOpenItem }) {
			const zh$1 = translate("language") === "zh";
			const t = (cn, en) => zh$1 ? cn : en;
			const desktopCopy = zh$1 ? zh : en;
			const desktopText = (key) => Object.hasOwn(desktopCopy, key) ? desktopCopy[key] : key;
			const cache = getBundlesCache(context);
			const [bundles, setBundles] = (0, react.useState)(() => cache.bundles);
			const [revision, refresh] = (0, react.useState)(0);
			const [loading, setLoading] = (0, react.useState)(() => !cache.loaded);
			const [busy, setBusy] = (0, react.useState)(false);
			const [preferredMarket, setPreferredMarket] = (0, react.useState)(() => cache.preferredMarket);
			const pending = (0, react.useRef)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				const reload = () => {
					refresh((value) => value + 1);
				};
				const off = context.remote.$on("plugin-manager/changed", reload);
				const reset = context.on("connection/reset", reload);
				window.addEventListener("focus", reload);
				return () => {
					off();
					reset();
					window.removeEventListener("focus", reload);
				};
			}, [context]);
			(0, react.useEffect)(() => {
				let disposed = false;
				if (!cache.loaded) setLoading(true);
				context.remote.pluginManager.listBundles().then((result) => {
					if (disposed) return;
					if (!result.ok) throw new Error(result.error.message);
					cache.bundles = result.value;
					cache.loaded = true;
					setBundles(result.value);
				}).catch((failure) => {
					if (!disposed) {
						if (!cache.loaded) setBundles([]);
						setError(String(failure));
					}
				}).finally(() => {
					if (!disposed) setLoading(false);
				});
				return () => {
					disposed = true;
				};
			}, [
				cache,
				context,
				revision
			]);
			const community = bundles.find((row) => row.name === COMMUNITY_MARKET);
			const market = bundles.find((row) => row.name === DSH_MARKET);
			const remoteRow = bundles.find((row) => row.name === REMOTE);
			(0, react.useEffect)(() => {
				if (community?.enabled && !market?.enabled) {
					cache.preferredMarket = COMMUNITY_MARKET;
					setPreferredMarket(COMMUNITY_MARKET);
				}
				if (market?.enabled && !community?.enabled) {
					cache.preferredMarket = DSH_MARKET;
					setPreferredMarket(DSH_MARKET);
				}
			}, [
				cache,
				community?.enabled,
				market?.enabled
			]);
			const change = async (names, enabled) => {
				if (pending.current || loading) return;
				pending.current = true;
				setBusy(true);
				setError("");
				setNotice("");
				try {
					for (const name of names) {
						const result = await context.remote.pluginManager.setBundleEnabled(name, enabled);
						if (!result.ok) throw new Error(result.error.message);
						const change = result.value;
						if (change.application === "failed" || change.application === "cancelled") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
						if (change.application === "restart-required") setNotice(t("已保存，请重启后台服务以应用。", "Saved. Restart the background service to apply."));
						if (change.application === "overridden") setNotice(t("已保存，但当前配置覆盖了此选择。", "Saved, but another configuration overrides this choice."));
						if (enabled && (name === "dsh-community-market" || name === "dshmarket")) {
							cache.preferredMarket = name;
							setPreferredMarket(name);
						}
					}
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					pending.current = false;
					setBusy(false);
					refresh((value) => value + 1);
				}
			};
			const bothMarkets = community?.enabled === true && market?.enabled === true;
			const locked = (row) => loading || busy || !row || row.readOnlyReason !== void 0 || row.error !== void 0;
			const activeMarkets = [community, market].flatMap((row) => row?.enabled === true ? [row] : []);
			const marketToggleLocked = loading || busy || marketToggleTargets(bundles, preferredMarket, activeMarkets.length === 0).length === 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextPluginControls",
				"data-next-plugin-controls": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dshDesktopSettingsGroup",
						"data-next-markets": true,
						"aria-labelledby": "next-market-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshNextMarketHeader",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: "next-market-title",
									children: desktopText("marketTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshDesktopSettingsGroupIntro",
									children: desktopText("marketIntro")
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshNextPluginActions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketSourcesButton, {
										context,
										bundles,
										preferredMarket,
										zh: zh$1,
										disabled: loading || busy,
										onChanged: () => {
											refresh((value) => value + 1);
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
										label: t("启用插件市场", "Enable plugin market"),
										checked: activeMarkets.length > 0,
										disabled: marketToggleLocked,
										onChange: (enabled) => {
											change(marketToggleTargets(bundles, preferredMarket, enabled), enabled);
										}
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshNextMarketChoices",
								role: "radiogroup",
								"aria-labelledby": "next-market-title",
								children: MARKET_OPTIONS.filter((option) => option.id !== "disabled").map((option) => {
									const isCommunity = option.id === "community-market";
									const row = isCommunity ? community : market;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
										title: marketTitle(option, desktopText),
										body: marketBody(option, desktopText),
										badge: isCommunity ? desktopText("beta") : void 0,
										selected: row?.enabled === true && !bothMarkets,
										disabled: locked(row),
										action: () => {
											change([isCommunity ? COMMUNITY_MARKET : DSH_MARKET], true);
										}
									}, option.id);
								})
							}),
							bothMarkets && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								className: "dshDesktopSettingsHint",
								children: t("当前两个市场均已开启，请选择保留其中一个。", "Both markets are currently enabled. Choose which one to keep.")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshNextPluginSections",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCard, {
								title: t("远程控制", "Remote Control"),
								description: remoteDescription(t),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.PluginArtworkDefault, { size: 36 }),
								onOpen: () => {
									onOpenBundle(REMOTE);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RemoteControlSettings, {
									context,
									t,
									row: remoteRow,
									loading,
									onChanged: () => {
										refresh((value) => value + 1);
									}
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCard, {
								title: t("Computer Use（Next）", "Computer Use (Next)"),
								description: computerDescription(t),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUsePluginArtwork, { size: 36 }),
								onOpen: () => {
									onOpenItem(COMPUTER_ITEM);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUseSettings, {
									context,
									zh: zh$1
								})
							}),
							OAR_SUBAGENTS !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCard, {
								title: t(OAR_SUBAGENTS.title.zh, OAR_SUBAGENTS.title.en),
								description: t(OAR_SUBAGENTS.description.zh, OAR_SUBAGENTS.description.en),
								tags: OAR_SUBAGENTS.experimental === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
									className: "dshNextPluginStatusTag",
									tone: "info",
									children: t("实验性", "Experimental")
								}) : void 0,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.PluginArtworkSubagent, { size: 36 }),
								onOpen: () => {
									onOpenBundle(OAR_SUBAGENTS.bundle);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BundleSwitch, {
									context,
									t,
									name: OAR_SUBAGENTS.bundle,
									label: t(`启用 ${OAR_SUBAGENTS.title.zh}`, `Enable ${OAR_SUBAGENTS.title.en}`),
									row: bundles.find((row) => row.name === OAR_SUBAGENTS.bundle),
									loading,
									onChanged: () => {
										refresh((value) => value + 1);
									}
								})
							})
						]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						className: "dshDesktopSettingsHint",
						children: notice
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "alert",
						className: "dshDesktopSettingsError",
						children: [
							error,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: loading || busy,
								onClick: () => {
									setError("");
									refresh((value) => value + 1);
								},
								children: t("重试", "Retry")
							})
						]
					})
				]
			});
		}
		function MarketSourcesButton({ context, bundles, preferredMarket, zh, disabled, onChanged }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled,
				onClick: () => {
					setOpen(true);
				},
				children: zh ? "来源配置" : "Source configuration"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketSourcesDialog, {
				open,
				onClose: () => {
					setOpen(false);
				},
				context,
				bundles,
				preferredMarket,
				zh,
				onChanged
			})] });
		}
		function MarketSourcesDialog({ open, onClose, context, bundles, preferredMarket, zh, onChanged }) {
			const t = (cn, en) => zh ? cn : en;
			const [runtime, setRuntime] = (0, react.useState)({});
			const [configuredUrls, setConfiguredUrls] = (0, react.useState)([]);
			const [busyKeys, setBusyKeys] = (0, react.useState)([]);
			const pendingKeys = (0, react.useRef)(/* @__PURE__ */ new Set());
			const operations = (0, react.useRef)(Promise.resolve());
			const [error, setError] = (0, react.useState)("");
			const [revision, refresh] = (0, react.useState)(0);
			const busy = (key) => busyKeys.includes(key);
			const communityEnabled = bundles.find((row) => row.name === COMMUNITY_MARKET)?.enabled === true;
			const dshMarketEnabled = bundles.find((row) => row.name === DSH_MARKET)?.enabled === true;
			const officialRow = bundles.find((row) => row.name === OFFICIAL_MARKET);
			const officialEnabled = officialRow?.enabled === true;
			const officialLocked = officialRow !== void 0 && (officialRow.readOnlyReason !== void 0 || officialRow.error !== void 0);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const reload = () => {
					refresh((value) => value + 1);
				};
				const offMarket = context.remote.$on("plugin-market/changed", reload);
				const offManager = context.remote.$on("plugin-manager/changed", reload);
				return () => {
					offMarket();
					offManager();
				};
			}, [context, open]);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				let disposed = false;
				const controller = new AbortController();
				const loadRuntime = async () => {
					const nextRuntime = {};
					if (communityEnabled) try {
						nextRuntime.communitySources = (await readMarketState(controller.signal)).sources;
					} catch {}
					if (dshMarketEnabled) try {
						const response = await fetch("/dshmarket/settings", {
							cache: "no-store",
							signal: controller.signal
						});
						if (response.ok) {
							const payload = await response.json();
							if (payload.region === "global" || payload.region === "china") nextRuntime.dshMarketRegion = payload.region;
						}
					} catch {}
					if (!disposed) setRuntime(nextRuntime);
					if (officialEnabled) {
						const indexes = await context.remote.pluginMarket.listIndexes();
						if (!disposed) setConfiguredUrls(indexes.ok ? indexes.value.map((item) => item.url) : []);
					} else if (!disposed) setConfiguredUrls([]);
				};
				loadRuntime();
				return () => {
					disposed = true;
					controller.abort();
				};
			}, [
				open,
				communityEnabled,
				dshMarketEnabled,
				officialEnabled,
				context,
				revision
			]);
			const resolution = resolveActiveMarketSource(bundles, preferredMarket, runtime);
			const activeMarketDef = BUILT_IN_MARKET_SOURCES.find((item) => item.key === resolution.marketKey) ?? BUILT_IN_MARKET_SOURCES[0];
			const configuredSet = new Set(configuredUrls);
			/**
			* Mark only the clicked control busy. Operations still run one at a time: each reads the configured index list and
			* writes it back whole, so two running together would drop one of the changes.
			*/
			const run = (key, operation) => {
				if (pendingKeys.current.has(key)) return;
				pendingKeys.current.add(key);
				setBusyKeys([...pendingKeys.current]);
				setError("");
				operations.current = operations.current.then(operation).catch((failure) => {
					setError(failure instanceof Error ? failure.message : String(failure));
				}).finally(() => {
					pendingKeys.current.delete(key);
					setBusyKeys([...pendingKeys.current]);
					refresh((value) => value + 1);
				});
			};
			const handleToggleOfficialMarket = (enabled) => {
				run("official-toggle", async () => {
					const result = await context.remote.pluginManager.setBundleEnabled(OFFICIAL_MARKET, enabled);
					if (!result.ok) throw new Error(result.error.message);
					const change = result.value;
					if (change.application === "failed" || change.application === "cancelled") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
					if (!enabled) setConfiguredUrls([]);
					onChanged();
				});
			};
			const handleImport = () => {
				run("all", async () => {
					const result = await importMarketSourcesToOfficial(context.remote, resolution, officialEnabled, runtime);
					setConfiguredUrls([...result.configuredUrls]);
					reloadDiscoverIndexesIfMounted(context);
					onChanged();
				});
			};
			const handleConfigureSingle = (marketKey, currentlyConfigured) => {
				run(marketKey, async () => {
					if (currentlyConfigured) {
						const nextUrls = await removeMarketSourcesFromOfficial(context.remote, marketKey);
						setConfiguredUrls([...nextUrls]);
						onChanged();
					} else {
						const result = await configureSingleMarketToOfficial(context.remote, marketKey, runtime, officialEnabled);
						setConfiguredUrls([...result.configuredUrls]);
						reloadDiscoverIndexesIfMounted(context);
						onChanged();
					}
				});
			};
			const handleToggleEndpoint = (endpointUrl, enable) => {
				run(endpointUrl, async () => {
					const result = await toggleMarketEndpointInOfficial(context.remote, endpointUrl, enable, officialEnabled);
					setConfiguredUrls([...result.configuredUrls]);
					if (enable) reloadDiscoverIndexesIfMounted(context);
					onChanged();
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title: t("来源配置", "Source configuration"),
				closeLabel: t("关闭", "Close"),
				className: "dshNextPermissionsDialog",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshNextPermissionList",
					"data-next-market-sources-dialog": true,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextMarketSourceNotice",
							role: "note",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshNextMarketSourceNoticeCopy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
									size: 14,
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`“快速配置”会自动开启官方的“${OFFICIAL_PLUGIN_INDEX.title.zh}”插件，配置下方各插件市场的默认源，并选中当前所用插件市场对应的源；未开启插件市场或其没有对应源时，选中 dsh-market 默认源。`, `"Quick configuration" automatically enables the official "${OFFICIAL_PLUGIN_INDEX.title.en}" plugin, configures the default source of each plugin market below, and selects the source of the plugin market you use; when no plugin market is enabled or it has no adapted source, the dsh-market default source is selected.`) })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: busy("all"),
								onClick: () => {
									handleImport();
								},
								children: busy("all") ? t("正在配置…", "Configuring…") : t("快速配置", "Quick configuration")
							})]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							className: "dshDesktopSettingsError",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshNextPermissionRow",
							role: "group",
							"aria-label": t("当前插件市场状态", "Current plugin market status"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshNextPermissionCopy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshNextMarketSourceTitle",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("当前使用的插件市场", "Currently active plugin market") }),
										resolution.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, { children: zh ? activeMarketDef.title.zh : activeMarketDef.title.en }),
										resolution.enabled && activeMarketDef.bundle === "dsh-community-market" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, { children: "Beta" }),
										officialEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
											tone: "info",
											children: t(`官方${OFFICIAL_PLUGIN_INDEX.title.zh}`, `${OFFICIAL_PLUGIN_INDEX.title.en} (official)`)
										})
									]
								}), officialEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dshNextPermissionStatus",
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "done" }), t(`已开启官方“${OFFICIAL_PLUGIN_INDEX.title.zh}”插件（已配置 ${String(configuredUrls.length)} 个索引源）`, `Official "${OFFICIAL_PLUGIN_INDEX.title.en}" plugin enabled (${String(configuredUrls.length)} index sources configured)`)]
								}) : !resolution.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dshDesktopSettingsHint",
									children: t("当前没有配置插件市场", "No plugin market is currently configured")
								}) : null]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextPermissionRow",
							role: "group",
							"aria-label": t(`官方${OFFICIAL_PLUGIN_INDEX.title.zh}配置`, `Official "${OFFICIAL_PLUGIN_INDEX.title.en}" configuration`),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshNextPermissionCopy",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshNextMarketSourceHeaderMain",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dshNextMarketSourceTitle",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(OFFICIAL_PLUGIN_INDEX.title.zh, OFFICIAL_PLUGIN_INDEX.title.en) }),
												officialRow?.version && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, { children: `v${officialRow.version}` }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
													tone: "info",
													children: t("实验性", "Experimental")
												})
											]
										}),
										officialEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: "dshNextMarketSourceUrl",
											children: "@deepseek-ai/dsh-experimental-plugin-market-bundle"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "dshDesktopSettingsHint",
											children: officialEnabled ? t(OFFICIAL_PLUGIN_INDEX.description.zh, OFFICIAL_PLUGIN_INDEX.description.en) : t(`开启右侧开关或点击上方“快速配置”以启用官方“${OFFICIAL_PLUGIN_INDEX.title.zh}”，启用后可在下方配置与管理内置插件源。`, `Turn on the switch on the right or click "Quick configuration" above to enable the official "${OFFICIAL_PLUGIN_INDEX.title.en}" and manage built-in sources below.`)
										})
									]
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshNextPluginActions",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
									label: t(`启用官方${OFFICIAL_PLUGIN_INDEX.title.zh}`, `Enable the official "${OFFICIAL_PLUGIN_INDEX.title.en}"`),
									checked: officialEnabled,
									disabled: busy("official-toggle") || officialLocked,
									onChange: (enabled) => {
										handleToggleOfficialMarket(enabled);
									}
								})
							})]
						}),
						officialEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshNextMarketSourceSectionHeader",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshNextMarketSourceHeaderMain",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(`可供官方“${OFFICIAL_PLUGIN_INDEX.title.zh}”配置的插件源`, `Plugin sources available for the official "${OFFICIAL_PLUGIN_INDEX.title.en}"`) })
							})
						}),
						officialEnabled && OFFICIAL_CONFIGURABLE_MARKET_SOURCES.map((marketDef) => {
							const isCurrentMarket = resolution.enabled && resolution.marketKey === marketDef.key;
							const isMarketConfigured = marketDef.sources.some((source) => configuredSet.has(source.url));
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshNextPermissionRow",
								role: "group",
								"aria-label": zh ? marketDef.title.zh : marketDef.title.en,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshNextPermissionCopy",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dshNextMarketSourceHeader",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dshNextMarketSourceHeaderMain",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dshNextMarketSourceTitle",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: zh ? marketDef.title.zh : marketDef.title.en }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, { children: marketDef.bundle === "dsh-community-market" ? t("社区插件市场", "Community Market") : t("dsh-market", "dsh-market") }),
													marketDef.bundle === "dsh-community-market" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, { children: "Beta" }),
													isCurrentMarket && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
														tone: "info",
														children: t("当前使用", "In use")
													}),
													isMarketConfigured && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
														tone: "success",
														children: t("已配置", "Configured")
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dshDesktopSettingsHint",
												children: zh ? marketDef.description.zh : marketDef.description.en
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dshNextPluginActions",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "outline",
												size: "sm",
												disabled: busy(marketDef.key),
												className: isMarketConfigured ? "dshNextMarketRemoveBtn" : void 0,
												onClick: () => {
													handleConfigureSingle(marketDef.key, isMarketConfigured);
												},
												children: busy(marketDef.key) ? t("正在处理…", "Processing…") : isMarketConfigured ? t("重置", "Reset") : t("添加", "Add")
											})
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshNextMarketSourceEndpoints",
										children: marketDef.sources.map((source) => {
											const isConfigured = configuredSet.has(source.url);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dshNextMarketSourceItem",
												"data-market-source-url": source.url,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dshNextMarketSourceItemMain",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dshNextMarketSourceTitle",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: zh ? source.label.zh : source.label.en }), isConfigured && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
															tone: "success",
															children: t("已配置", "Configured")
														})]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
														className: "dshNextMarketSourceUrl",
														children: source.url
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													disabled: busy(source.url),
													className: isConfigured ? "dshNextMarketRemoveBtn" : void 0,
													onClick: () => {
														handleToggleEndpoint(source.url, !isConfigured);
													},
													children: busy(source.url) ? t("正在处理…", "Processing…") : isConfigured ? t("删除配置", "Remove configuration") : t("配置此源", "Configure source")
												})]
											}, source.url);
										})
									})]
								})
							}, marketDef.key);
						})
					]
				})
			});
		}
		var remoteDescription = (t) => t("通过 Agents Anywhere 从手机或其他设备连接。启用后，在侧边栏的“远程控制”中完成配对。", "Connect from your phone or another device with Agents Anywhere. After enabling, pair it from Remote Control in the sidebar.");
		var computerDescription = (t) => t("让 AI 查看屏幕、操作鼠标和键盘。截图理解需要支持图片输入的模型。", "Let AI view the screen and control the mouse and keyboard. Understanding screenshots requires a model with image input.");
		function ComputerUseItem({ context, t, view }) {
			const zh = t("language") === "zh";
			if (view === "summary") return computerDescription((cn, en) => zh ? cn : en);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUseSettings, {
				context,
				zh,
				mode: "page"
			});
		}
		function ComputerUseActions({ context, t, subject }) {
			if (subject.kind !== "item" || subject.id !== COMPUTER_ITEM) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComputerUseSettings, {
				context,
				zh: t("language") === "zh",
				mode: "actions"
			});
		}
		function PluginCard({ title, description, icon, tags, onOpen, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextPluginCard",
				"data-next-plugin-card": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshNextPluginIcon",
						"aria-hidden": "true",
						children: icon
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshNextPluginCardMain",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshNextPluginCardTitle",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshNextPluginCardOpen",
								"aria-label": `${title} — ${description}`,
								onClick: onOpen,
								children: title
							}), tags]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshNextPluginCardDescription",
							children: description
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshNextPluginCardActions",
						children
					})
				]
			});
		}
		function RemoteControlSettings({ context, t, row, loading, onChanged }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const change = async (enabled) => {
				if (busy || loading || !row) return;
				setBusy(true);
				setError("");
				setNotice("");
				try {
					const result = await context.remote.pluginManager.setBundleEnabled(REMOTE, enabled);
					if (!result.ok) throw new Error(result.error.message);
					const change = result.value;
					if (change.application === "failed" || change.application === "cancelled") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
					if (change.application === "restart-required") setNotice(t("已保存，请重启后台服务以应用。", "Saved. Restart the background service to apply."));
					if (change.application === "overridden") setNotice(t("已保存，但当前配置覆盖了此选择。", "Saved, but another configuration overrides this choice."));
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
					onChanged();
				}
			};
			const openPanel = () => {
				const trigger = document.querySelector("[data-slot=\"sidebar.footer.action\"] button[aria-haspopup=\"dialog\"][aria-label=\"远程控制\"], [data-slot=\"sidebar.footer.action\"] button[aria-haspopup=\"dialog\"][aria-label=\"Remote Control\"], [data-slot=\"sidebar.footer.action\"] button[aria-haspopup=\"dialog\"][aria-label=\"Mobile connection\"], [data-slot=\"sidebar.footer.action\"] button[aria-haspopup=\"dialog\"][aria-label=\"手机连接\"], [data-slot=\"sidebar.footer.action\"] button[aria-haspopup=\"dialog\"][aria-label=\"Agents Anywhere\"]");
				if (trigger) {
					setError("");
					trigger.click();
				} else setError(t("远程控制界面尚未就绪，请稍后重试。", "Remote control is not ready yet. Try again shortly."));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextPluginDetail",
				"data-next-remote-control": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshNextPluginActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							disabled: !row?.enabled || loading || busy,
							onClick: openPanel,
							children: t("打开面板", "Open panel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							label: t("启用远程控制", "Enable remote control"),
							checked: row?.enabled ?? false,
							disabled: loading || busy || !row || row.readOnlyReason !== void 0 || row.error !== void 0,
							onChange: (enabled) => {
								change(enabled);
							}
						})]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "status",
						className: "dshDesktopSettingsHint",
						children: notice
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "alert",
						className: "dshDesktopSettingsError",
						children: error
					})
				]
			});
		}
		/** A card's switch: selects the installation-shipped bundle in the Profile through the official manager. */
		function BundleSwitch({ context, t, name, label, row, loading, onChanged }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const change = async (enabled) => {
				if (busy || loading || !row) return;
				setBusy(true);
				setError("");
				setNotice("");
				try {
					const result = await context.remote.pluginManager.setBundleEnabled(name, enabled);
					if (!result.ok) throw new Error(result.error.message);
					const change = result.value;
					if (change.application === "failed" || change.application === "cancelled") throw new Error(change.error?.diagnostic ?? t("无法更改插件状态。", "Could not change the plugin state."));
					if (change.application === "restart-required") setNotice(t("已保存，请重启后台服务以应用。", "Saved. Restart the background service to apply."));
					if (change.application === "overridden") setNotice(t("已保存，但当前配置覆盖了此选择。", "Saved, but another configuration overrides this choice."));
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
					onChanged();
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshNextPluginDetail",
				"data-next-bundle-switch": name,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshNextPluginActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							label,
							checked: row?.enabled ?? false,
							disabled: loading || busy || !row || row.readOnlyReason !== void 0 || row.error !== void 0,
							onChange: (enabled) => {
								change(enabled);
							}
						})
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "status",
						className: "dshDesktopSettingsHint",
						children: notice
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "alert",
						className: "dshDesktopSettingsError",
						children: error
					})
				]
			});
		}
		function readOfficialBundles(context) {
			try {
				const get = context.get;
				if (typeof get !== "function") return void 0;
				const slots = get.call(context, "slots");
				const mainEntries = slots?._core?.entries?.("main");
				const overlayEntries = slots?._core?.entries?.("shell.overlay");
				const snapshot = (mainEntries?.find((item) => item.options?.key === "plugins") ?? overlayEntries?.find((item) => item.options?.id === "plugin-manager.refresh-toast"))?.inject?.()?.hooks?.pluginManager?.getSnapshot?.();
				if ((snapshot?.status === "ready" || snapshot?.status === "error") && Array.isArray(snapshot.packages)) return [...snapshot.packages];
			} catch {}
		}
		function reloadDiscoverIndexesIfMounted(context) {
			try {
				const face = ((context.get("slots")?._core?.entries?.("plugins.tab"))?.find((item) => item.options?.id === "discover"))?.inject?.();
				if (face?.hooks?.discover?.getSnapshot?.().status !== "idle") face?.reload?.();
			} catch {}
		}
		//#endregion
		//#region src/client/plugin-controls-styles.ts
		/** Shared by the official Plugins page and the in-app permission dialog. */
		var STYLES = `
/* The slot anchor uses display:contents, so the page's direct-child width does not reach this flex item. */
.dshNextPluginControls { box-sizing: border-box; width: 100%; max-width: 960px; min-width: 0; display: grid; gap: 32px; color: var(--dsw-alias-label-primary); }
.dshNextPluginControls .dshDesktopSettingsGroup { padding-top: 0; border-top: 0; gap: 12px; }
.dshNextPluginControls h3 { font-size: 14px; line-height: 22px; font-weight: 500; }
.dshNextPluginControls .dshDesktopSettingsHint,
.dshNextPluginControls .dshDesktopSettingsGroupIntro { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshNextPluginControls .dshDesktopSettingsGroupIntro { margin-top: 4px; }
.dshNextMarketHeader { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.dshNextMarketHeader > div { min-width: 0; }
.dshNextMarketHeader > [role="switch"], .dshNextMarketHeader > .dshNextPluginActions { flex: none; flex-wrap: nowrap; }
.dshNextMarketChoices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dshNextPluginSections { display: grid; gap: 2px; }
.dshNextPluginCard { position: relative; display: flex; align-items: center; min-width: 0; gap: 14px; margin: 0 -8px; padding: 8px; border-radius: 12px; }
.dshNextPluginCard:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshNextPluginIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 48px; height: 48px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 10px; color: var(--dsw-alias-label-secondary); }
.dshNextPluginCardMain { display: grid; flex: 1; min-width: 0; gap: 4px; }
/* Title row and status tag as the official Plugins cards draw them. */
.dshNextPluginCardTitle { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.dshNextPluginStatusTag { height: 18px; padding: 0 7px; font-size: 10px; line-height: 1; }
.dshNextPluginCardOpen { width: max-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; cursor: pointer; }
.dshNextPluginCardOpen::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
.dshNextPluginCardOpen:focus-visible { outline: none; }
.dshNextPluginCardOpen:focus-visible::after { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshNextPluginCardDescription { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px; }
.dshNextPluginCardActions { position: relative; z-index: 1; flex: none; }
.dshNextPluginCardActions .dshNextPluginDetail, .dshNextPluginCardActions .dshNextComputerUse { display: block; }
.dshNextPluginCardActions .dshNextPluginActions { flex-wrap: nowrap; }
.dshNextPluginDetail, .dshNextComputerUse { display: grid; gap: 12px; }
.dshNextLaunchPresets { display: grid; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); }
.dshNextLaunchPresets p { margin: 0; }
.dshNextLaunchPresetsTitle { margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.dshNextLaunchPresetChoices { display: grid; gap: 8px; }
.dshNextPluginActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshNextPluginCardActions [role="status"], .dshNextPluginCardActions [role="alert"] { display: block; max-width: 220px; white-space: normal; }
button.dshNextSettingsGear { width: 28px; padding: 0; }
.dshNextPluginSettingsNotice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; border: 1px solid var(--dsw-alias-border-l1); }
.dshNextPluginSettingsNotice > span { flex: 1 1 220px; }
.dshNextPluginSettingsNotice > button { flex-shrink: 0; }
.dshNextPluginControls p { margin: 0; }
.dshNextPermissionsDialog[role="dialog"] { width: min(620px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); overflow: hidden; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.dshNextPermissionsDialog[role="dialog"] > div:first-child { min-height: 0; flex: 1; overflow: hidden; }
.dshNextPermissionsDialog[role="dialog"] > div:first-child > div:last-child { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.dshNextPermissionList { display: grid; gap: 0; }
.dshNextPermissionRow { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 18px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshNextPermissionRow:last-child { border-bottom: 0; }
.dshNextPermissionCopy { flex: 1; min-width: 0; font-size: 14px; }
.dshNextPermissionRow .dshNextPluginActions { flex-shrink: 0; justify-content: flex-end; max-width: 210px; }
.dshNextPermissionStatus { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshNextComponentSection { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.dshNextComponentSectionHead { display: flex; align-items: baseline; gap: 10px; }
.dshNextComponentSectionTitle { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshNextComponentSectionCount { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshNextComponentRows { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dshNextComponentRow { padding: 12px 2px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dshNextComponentRow:last-child { border-bottom: 0; }
.dshNextComponentRowLine { display: flex; align-items: center; gap: 16px; min-width: 0; }
.dshNextComponentRowIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 40px; height: 40px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px); color: var(--dsw-alias-label-secondary); }
.dshNextComponentRowMain { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.dshNextComponentRowId { font-size: 13.5px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dshNextComponentRow[data-state="off"] .dshNextComponentRowId { color: var(--dsw-alias-label-secondary); }
.dshNextComponentRowModule { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dshNextComponentRowState { display: inline-flex; flex: none; align-items: center; gap: 6px; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshNextComponentRow[data-opens] .dshNextComponentRowLine { position: relative; margin: -6px -8px; padding: 6px 8px; border-radius: 10px; }
.dshNextComponentRow[data-opens] .dshNextComponentRowLine:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshNextComponentRowOpen { display: inline-flex; align-items: center; gap: 2px; width: max-content; max-width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.dshNextComponentRowOpen::after { content: ''; position: absolute; inset: 0; border-radius: 10px; }
.dshNextComponentRowOpen:focus-visible { outline: none; }
.dshNextComponentRowOpen:focus-visible::after { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshNextComponentRowOpenIcon { flex: none; color: var(--dsw-alias-label-tertiary); }
.dshNextComponentRowLine:hover .dshNextComponentRowOpenIcon { color: var(--dsw-alias-label-primary); }
.dshNextComponentRowSwitch { position: relative; z-index: 1; display: inline-flex; flex: none; }
[data-plugin-item-detail="desktop-next-computer-use"] > [data-window-drag] > div > span:first-child > svg { display: none; }
[data-plugin-item-detail="desktop-next-computer-use"] > [data-window-drag] > div > span:first-child::before { content: ''; width: 36px; height: 36px; background: no-repeat center / 36px 36px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36' fill='none'%3E%3Cg stroke='url(%23g)' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.9 7.93L15.73 11.01'/%3E%3Cpath d='M24.29 10.4L22.02 12.66'/%3E%3Cpath d='M8.03 14.77L11.14 15.6'/%3E%3Cpath d='M10.53 24.15L12.79 21.89'/%3E%3Cpath d='M17.38 17.23L28.01 20.53L22.74 22.7L20.61 27.86Z' fill='url(%23g)' fill-opacity='0.2'/%3E%3C/g%3E%3Cdefs%3E%3ClinearGradient id='g' x1='8' y1='8' x2='28' y2='28' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%2354ECE7'/%3E%3Cstop offset='1' stop-color='%23658EFF'/%3E%3C/linearGradient%3E%3C/defs%3E%3C/svg%3E"); }
.dshNextMarketSourceSectionHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0 6px; font-size: 14px; }
.dshNextMarketSourceSectionHeader + .dshNextPermissionRow { padding-top: 12px; }
.dshNextMarketSourceHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dshNextMarketSourceHeaderMain { display: grid; gap: 4px; flex: 1; min-width: 0; }
.dshNextMarketSourceTitle { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.dshNextMarketSourceEndpoints { display: grid; gap: 8px; margin-top: 10px; }
.dshNextMarketSourceItem { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); }
.dshNextMarketSourceItemMain { display: grid; gap: 4px; flex: 1; min-width: 0; }
.dshNextMarketSourceUrl { font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
button.dshNextMarketRemoveBtn { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
button.dshNextMarketRemoveBtn:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); }
.dshNextMarketSourceNotice { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; padding: 10px 12px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-state-warn-tertiary); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshNextMarketSourceNoticeCopy { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; }
.dshNextMarketSourceNoticeCopy > svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-warn-primary); }
.dshNextMarketSourceNotice > button { flex: none; }
@media(max-width: 560px) { .dshNextMarketChoices { grid-template-columns: 1fr; } .dshNextPluginCard { align-items: flex-start; flex-wrap: wrap; } .dshNextPluginCardMain { flex-basis: calc(100% - 68px); } .dshNextPluginCardActions { margin-left: 62px; } .dshNextPermissionRow, .dshNextMarketSourceSectionHeader, .dshNextMarketSourceHeader, .dshNextMarketSourceItem, .dshNextMarketSourceNotice { align-items: flex-start; flex-direction: column; gap: 12px; } .dshNextPermissionRow .dshNextPluginActions { max-width: none; } }
`;
		function installPluginControlsStyles() {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-desktop-next/plugin-controls";
			style.textContent = STYLES;
			document.head.append(style);
			return () => style.remove();
		}
		//#endregion
		//#region src/client/directory-picker.ts
		/**
		* Workspace directory selection in the Desktop window, aligned with upstream Desktop.
		*
		* Next hands every sampled LAN address to the Host as a trusted authority so LAN access
		* can be switched on later without a Host restart. Upstream's adaptive `directory-picker`
		* row reads that trust as "remote browsers may be present" and mounts the in-app browsing
		* panel for every browser it serves. Upstream Desktop declares no trusted hosts, so its
		* window always receives the native chooser. This occupant restores that behaviour for the
		* Desktop window alone: it shadows whichever flow the Host mounted (registered at the
		* default priority 0; the lowest live entry of a single hole renders) with a renderless
		* driver over the preload bridge, so the system folder dialog opens immediately. Ordinary
		* browsers reached through local or LAN access have no bridge and keep the Host's panel.
		*
		* The driver mirrors upstream `@deepseek-ai/dsh-client-ui-directory-picker-native` (MIT),
		* whose published Loader entry registers only at the default priority.
		*/
		/** Preload bridge of the Desktop document; the official native flow consumes the same name. */
		var DESKTOP_DIRECTORY_PICKER_GLOBAL = "__DSH_DIRECTORY_PICKER__";
		/** The ui-workspace directory-flow holes: the conversation empty-state picker and the sidebar browser. */
		var DIRECTORY_FLOW_HOLES = ["conversation.hero.workspace.directoryFlow", "sidebar.workspaces.directoryFlow"];
		/**
		* Read the Desktop preload bridge; absent in ordinary browsers and in the shell window.
		* @param target - Global object to read (the window in production).
		* @returns The bridge when it exposes `pick`, otherwise undefined.
		*/
		function desktopDirectoryPicker(target = globalThis) {
			const bridge = target[DESKTOP_DIRECTORY_PICKER_GLOBAL];
			if (typeof bridge !== "object" || bridge === null) return void 0;
			const pick = bridge.pick;
			if (typeof pick !== "function") return void 0;
			return { pick: () => pick.call(bridge) };
		}
		/**
		* Renderless flow occupant: each rising `open` edge runs exactly one pick and reports
		* exactly one outcome. The armed ref guards re-renders (busy flips, handler identity
		* changes, a re-created injected face) from launching a second dialog; the owner
		* withdrawing `open` re-arms the next request. Outcomes report through the owner's latest
		* handlers, and an unmounted instance discards its settlement wholesale: the dialog has no
		* abort, so its late answer lands nowhere instead of adopting a path for a dead occupant.
		* @param props - Owner conversation plus the injected pick call.
		* @returns Nothing; the system dialog renders on the host display.
		*/
		function NativeDirectoryFlow(props) {
			const { open, pick } = props;
			const armed = (0, react.useRef)(false);
			const outcome = (0, react.useRef)(props);
			outcome.current = props;
			const alive = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!open) {
					armed.current = false;
					return;
				}
				if (armed.current) return;
				armed.current = true;
				pick().then((path) => {
					if (!alive.current) return;
					if (path === null) outcome.current.onCancel();
					else outcome.current.onPicked(path);
				}, (reason) => {
					if (!alive.current) return;
					outcome.current.onError(reason instanceof Error ? reason.message : String(reason));
				});
			}, [open, pick]);
			return null;
		}
		/**
		* Shadow both directory-flow holes with the Desktop occupant. Both declarations must be
		* live before the pair installs; the generator makes the two registrations one effect, so
		* a conflict in the second hole rolls the first back instead of leaving a partial mix.
		* @param ctx - Client root context carrying the slot registry.
		* @param picker - The Desktop preload bridge.
		*/
		function registerDesktopDirectoryPicker(ctx, picker) {
			const injected = () => ({ pick: () => picker.pick() });
			const [hero, sidebar] = DIRECTORY_FLOW_HOLES;
			ctx.slots.inject(hero, () => ctx.slots.inject(sidebar, function* () {
				yield ctx.slots.register({
					name: hero,
					inject: injected,
					priority: -1
				}, NativeDirectoryFlow);
				yield ctx.slots.register({
					name: sidebar,
					inject: injected,
					priority: -1
				}, NativeDirectoryFlow);
			}));
		}
		//#endregion
		//#region src/client/settings-requests.tsx
		/** Native settings actions reuse the official sidebar trigger and permission dialog. */
		function SettingsRequests({ t }) {
			const [permissionsOpen, setPermissionsOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let observer;
				const dispose = window.desktopNext?.onOpenSettings?.((page) => {
					observer?.disconnect();
					if (page === "permissions") {
						if (!document.querySelector(".dshNextPermissionsDialog")) setPermissionsOpen(true);
						return;
					}
					setPermissionsOpen(false);
					let menuOpened = false;
					const open = () => {
						if (menuOpened) {
							const entry = document.querySelector("[role=\"menu\"] button[role=\"menuitem\"]");
							if (!entry) return;
							observer?.disconnect();
							entry.click();
							return;
						}
						const trigger = document.querySelector("[data-slot=\"settings.trigger\"]")?.closest("button");
						if (trigger) {
							observer?.disconnect();
							trigger.click();
							return;
						}
						const launcher = document.querySelector("[data-slot=\"settings.launcher\"] button");
						if (!launcher) return;
						menuOpened = true;
						launcher.click();
					};
					observer = new MutationObserver(open);
					observer.observe(document.body, {
						childList: true,
						subtree: true
					});
					open();
				});
				return () => {
					observer?.disconnect();
					dispose?.();
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DesktopPermissionsDialog, {
				open: permissionsOpen,
				onClose: () => {
					setPermissionsOpen(false);
				},
				service: window.desktopNext?.permissions,
				language: t("language")
			});
		}
		//#endregion
		//#region src/client/renderer-recovery.ts
		function installRendererRecovery(ctx, bridge) {
			const panelKey = `dsh-next.panel.${bridge.profile()}`;
			try {
				const panel = sessionStorage.getItem(panelKey);
				if (panel) ctx.layout.selectPanel(panel);
			} catch {}
			const releasePanel = ctx.layout.panelInfo.subscribe(() => {
				try {
					const panel = ctx.layout.panelInfo.getSnapshot().activePanelId;
					if (panel === null) sessionStorage.removeItem(panelKey);
					else sessionStorage.setItem(panelKey, panel);
				} catch {}
			});
			bridge.report("healthy").catch((error) => console.error("[next-recovery] readiness report failed", error));
			return releasePanel;
		}
		//#endregion
		//#region src/client/index.ts
		/** Compose Next capabilities into the official frontend. */
		var inject = [
			"slots",
			"layout",
			"locale"
		];
		function apply(ctx) {
			ctx.effect(installUiDiagnostics, "AA and Plugins client lifecycle diagnostics");
			ctx.effect(() => ctx.locale.register("desktop-next", {
				zh: {
					settings: "桌面设置",
					language: "zh",
					safeMode: "安全模式",
					safeModeDetail: "当前使用临时环境。退出安全模式并重启后返回原 Profile，临时数据不会保留。",
					dismiss: "关闭提示",
					recovery: "打开恢复助手"
				},
				en: {
					settings: "Desktop settings",
					language: "en",
					safeMode: "Safe mode",
					safeModeDetail: "You are using a temporary environment. Exiting Safe Mode and restarting returns to the original Profile and removes the temporary data.",
					dismiss: "Dismiss notice",
					recovery: "Open recovery assistant"
				}
			}), "Next settings and recovery labels");
			ctx.effect(() => installDesktopSettingsStyles("dsh-desktop-next"), "Shared Desktop settings styles");
			ctx.effect(installPluginControlsStyles, "Plugin controls and permission dialog styles");
			registerPluginControls(ctx);
			registerComputerUseCommandUi(ctx);
			const directoryPicker = desktopDirectoryPicker();
			if (directoryPicker) registerDesktopDirectoryPicker(ctx, directoryPicker);
			registerDesktopOnboarding(ctx, () => null);
			if (window.desktopNext?.state) {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "desktop-next-renderer-health",
					order: 0,
					inject: () => ({ ctx })
				}, RendererHealth));
				const permissions = window.desktopNext.permissions;
				if (permissions) ctx.effect(() => {
					const dispose = ctx.reflect.provide("desktopPermissions", permissions);
					return () => {
						dispose();
					};
				}, "Native Desktop permissions");
				ctx.effect(installSidebarFooterStyles, "Shared Desktop sidebar footer layout");
				const adapter = new NextSettingsAdapter(window.desktopNext);
				ctx.effect(() => {
					const syncSidebarFooterCompat = () => {
						const value = adapter.desktopSettings.getSnapshot().value;
						setSidebarFooterCompat(value?.sidebarFooterCompat !== false);
						setSidebarFooterBalanced(value?.sidebarFooterBalanced !== false);
					};
					syncSidebarFooterCompat();
					return adapter.desktopSettings.subscribe(syncSidebarFooterCompat);
				}, "Sync Desktop sidebar footer compatibility setting");
				const t = ctx.locale.bind("desktop-next");
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "desktop",
					order: 100,
					locale: "desktop-next",
					label: () => t("settings"),
					inject: () => ({
						adapter,
						openPlugins: () => ctx.layout.selectPanel("plugins")
					})
				}, DesktopSettings));
				ctx.slots.inject("settings.action", () => ctx.slots.register({
					name: "settings.action",
					id: "desktop-native-actions",
					order: 1,
					locale: "desktop-next",
					inject: () => ({ adapter })
				}, SettingsActions));
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "desktop-next-settings-requests",
					order: 90,
					locale: "desktop-next"
				}, SettingsRequests));
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "desktop-next-safe-mode",
					order: 100,
					locale: "desktop-next"
				}, SafeModeNotice));
			}
			ctx.effect(installWindowStyles, "Next native materials and recovery notice");
		}
		/** The effect runs only after React mounts the assembled shell. */
		function RendererHealth({ ctx }) {
			(0, react.useEffect)(() => {
				const bridge = window.desktopNext?.renderer;
				if (bridge) return installRendererRecovery(ctx, bridge);
			}, [ctx]);
			return null;
		}
		/** Temporary, metadata-only trace for the AA dialog and its sibling Plugins UI. */
		function installUiDiagnostics() {
			const aaButton = "[data-slot=\"sidebar.footer.action\"] button[aria-label=\"远程控制\"], [data-slot=\"sidebar.footer.action\"] button[aria-label=\"Remote Control\"], [data-slot=\"sidebar.footer.action\"] button[aria-label=\"Mobile connection\"], [data-slot=\"sidebar.footer.action\"] button[aria-label=\"手机连接\"]";
			const read = () => {
				const button = document.querySelector(aaButton);
				return {
					button: button !== null,
					expanded: button?.getAttribute("aria-expanded") === "true",
					dialog: [...document.querySelectorAll("[role=\"dialog\"]")].some((element) => [
						"远程控制",
						"Remote Control",
						"手机连接",
						"Mobile connection",
						"Agents Anywhere"
					].includes(element.getAttribute("aria-label") ?? "")),
					plugins: document.querySelector("[data-next-plugin-controls]") !== null
				};
			};
			const onError = (event) => {
				console.error(`[next-ui-error] ${String(event.error?.stack ?? event.message).slice(0, 8192)}`);
			};
			const onRejection = (event) => {
				console.error(`[next-ui-error] ${String(event.reason?.stack ?? event.reason).slice(0, 8192)}`);
			};
			window.addEventListener("error", onError);
			window.addEventListener("unhandledrejection", onRejection);
			let previous = read();
			let lastInput = "none";
			const trace = (message) => {
				console.warn(`[next-ui-diagnostic] ${message}`);
			};
			trace(`ready aa=${previous.button} dialog=${previous.dialog} plugins=${previous.plugins}`);
			const onPointerDown = (event) => {
				const target = event.target;
				if (target instanceof Element && (target.closest(aaButton) || previous.dialog)) lastInput = target.closest(aaButton) ? "aa-button" : target.closest("[role=\"dialog\"]") ? "dialog" : "outside-dialog";
			};
			const onKeyDown = (event) => {
				if (previous.dialog && event.key === "Escape") lastInput = "Escape";
			};
			let queued = false;
			const observer = new MutationObserver(() => {
				if (queued) return;
				queued = true;
				queueMicrotask(() => {
					queued = false;
					const next = read();
					if (Object.keys(next).some((key) => next[key] !== previous[key])) {
						trace(`state aa=${next.button} expanded=${next.expanded} dialog=${next.dialog} plugins=${next.plugins} lastInput=${lastInput}`);
						previous = next;
						lastInput = "none";
					}
				});
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["aria-expanded"]
			});
			document.addEventListener("pointerdown", onPointerDown, true);
			document.addEventListener("keydown", onKeyDown, true);
			return () => {
				window.removeEventListener("error", onError);
				window.removeEventListener("unhandledrejection", onRejection);
				observer.disconnect();
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
				trace("client plugin disposed");
			};
		}
		function SafeModeNotice({ t }) {
			const [safe, setSafe] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let disposed = false;
				window.desktopNext?.state().then((state) => {
					if (!disposed) setSafe(state.safeMode);
				}).catch(() => {});
				return () => {
					disposed = true;
				};
			}, []);
			return safe ? (0, react.createElement)("aside", {
				className: "dshNextSafeModeNotice",
				"aria-label": t("safeMode")
			}, (0, react.createElement)("button", {
				type: "button",
				className: "dshNextSafeModeDismiss",
				"aria-label": t("dismiss"),
				onClick: () => setSafe(false)
			}, "×"), (0, react.createElement)("strong", null, t("safeMode")), (0, react.createElement)("p", null, t("safeModeDetail")), (0, react.createElement)("button", {
				type: "button",
				onClick: () => {
					window.desktopNext?.command({
						type: "controls",
						page: "recovery"
					}).catch(() => {});
				}
			}, t("recovery"))) : null;
		}
		function DesktopSettings({ t, adapter, close, openPlugins }) {
			return (0, react.createElement)(NextDesktopSettings, {
				adapter,
				language: t("language"),
				onOpenPlugins: () => {
					openPlugins();
					close();
				}
			});
		}
		function SettingsActions({ t, adapter }) {
			return (0, react.createElement)(NextDesktopActions, {
				adapter,
				language: t("language")
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
