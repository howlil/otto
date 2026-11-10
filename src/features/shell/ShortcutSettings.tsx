import { Button, TextField } from "../../shared/ui";
import { useShortcutControls } from "./useShortcutControls";

export function ShortcutSettings() {
  const { shortcut, setShortcut, message, busy, save, available } = useShortcutControls();
  return (
    <form
      className="mt-3 border-t border-otto-line-soft pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor="otto-shell-shortcut" className="mb-2 block text-otto-sm">
        Expand / compact shortcut
      </label>
      <div className="flex min-w-0 gap-2">
        <TextField
          id="otto-shell-shortcut"
          value={shortcut}
          placeholder="Ctrl+Alt+O"
          disabled={!available || busy}
          onChange={(event) => setShortcut(event.target.value)}
        />
        <Button type="submit" disabled={!available || busy || !shortcut.trim()}>
          Save
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-otto-sm">
          {message}
        </p>
      )}
    </form>
  );
}
