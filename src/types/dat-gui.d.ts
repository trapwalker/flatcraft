// Minimal ambient typing for the vendored docs/js/dat.gui.min.js, covering
// only the surface this project actually uses.
declare namespace dat {
  interface GUIController {
    name(name: string): GUIController;
    step(step: number): GUIController;
    listen(): GUIController;
    onChange(fn: (value: unknown) => void): GUIController;
    // DEMO-7: removes this controller from whichever GUI/folder it belongs to (delegates to
    // GUI.remove() internally — see docs/js/dat.gui.min.js's `k.extend(h, {..., remove: ...})`).
    // Used to rebuild the Bookmarks folder's list of "go" buttons on every add/remove.
    remove(): GUIController;
  }

  class GUI {
    closed: boolean;
    add(target: object, property: string, min?: number | unknown[], max?: number): GUIController;
    addColor(target: object, property: string): GUIController;
    addFolder(name: string): GUI;
    close(): void;
    open(): void;
  }
}
