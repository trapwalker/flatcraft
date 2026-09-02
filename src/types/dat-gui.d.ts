// Minimal ambient typing for the vendored docs/js/dat.gui.min.js, covering
// only the surface this project actually uses.
declare namespace dat {
  interface GUIController {
    name(name: string): GUIController;
    step(step: number): GUIController;
    listen(): GUIController;
    onChange(fn: (value: unknown) => void): GUIController;
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
