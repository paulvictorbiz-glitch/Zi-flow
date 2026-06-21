/* =========================================================
   PreferencesModal — owner-only "Display & accessibility"
   panel. Reuses the shared Modal shell + Field/SegRow form
   primitives. All changes apply LIVE (the ThemeProvider writes
   data-* attributes immediately), so the app behind the modal
   is the preview. Fully reversible via "Reset to default".
   ========================================================= */

import React from "react";
import { Modal, Field, SegRow } from "./modals/Modal.jsx";
import { DPill } from "./components.jsx";
import { useTheme } from "../lib/theme.jsx";
import { useWorkflow } from "../store/store.jsx";
import { useIsOwner } from "../lib/permissions.jsx";

export function PreferencesModal({ onClose }) {
  const { theme, fontScale, font, setTheme, setFontScale, setFont, reset } = useTheme();
  // Owner-only performance pref. `prefetchHeavyTabs` / `setPrefetchHeavyTabs`
  // are the frozen TEAM_C store contract (user_preferences-backed); we only
  // consume them here — editors never see this row.
  const isOwner = useIsOwner();
  const { prefetchHeavyTabs, setPrefetchHeavyTabs } = useWorkflow();

  return (
    <Modal
      title="Display & accessibility"
      subtitle="A test display mode for easier reading — applies only to this browser, off by default for everyone else."
      onClose={onClose}
      onSubmit={onClose}
      submitLabel="Done"
    >
      <Field label="Display mode" hint="larger, higher-contrast, roomier cards">
        <SegRow
          value={theme}
          onChange={setTheme}
          options={[
            { k: "default",    l: "Default" },
            { k: "accessible", l: "Comfortable" },
          ]}
        />
      </Field>

      <Field label="Text size" hint="display zoom — works in any mode">
        <SegRow
          value={fontScale}
          onChange={setFontScale}
          options={[
            { k: "80",  l: "80%" },
            { k: "90",  l: "90%" },
            { k: "100", l: "100%" },
            { k: "110", l: "110%" },
            { k: "125", l: "125%" },
            { k: "150", l: "150%" },
            { k: "175", l: "175%" },
            { k: "200", l: "200%" },
          ]}
        />
      </Field>

      <Field label="Font" hint="body typeface">
        <SegRow
          value={font}
          onChange={setFont}
          options={[
            { k: "inter",    l: "Inter" },
            { k: "system",   l: "System" },
            { k: "serif",    l: "Serif" },
            { k: "rounded",  l: "Rounded" },
            { k: "mono",     l: "Mono" },
            { k: "dyslexic", l: "Readable" },
          ]}
        />
      </Field>

      {isOwner && (
        <Field
          label="Prefetch heavy tabs"
          hint="warm the heavier tabs (Monitor, Analytics, Editor, …) on idle so they open instantly — costs a little extra background download"
        >
          <SegRow
            value={prefetchHeavyTabs ? "on" : "off"}
            onChange={(v) => setPrefetchHeavyTabs(v === "on")}
            options={[
              { k: "off", l: "Off" },
              { k: "on",  l: "On" },
            ]}
          />
        </Field>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <DPill onClick={reset}>Reset to default</DPill>
      </div>
    </Modal>
  );
}
