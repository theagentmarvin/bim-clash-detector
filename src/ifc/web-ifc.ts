/**
 * web-ifc singleton — single IfcAPI instance shared across all IFC modules.
 *
 * Both loader.ts and properties.ts import from this module.
 * The API is initialized once (WASM loaded) and reused.
 */

const WASM_PATH = 'https://unpkg.com/web-ifc@0.0.74/';

/** Dynamic import ensures web-ifc is fully loaded before use */
type WebIfcModule = typeof import('web-ifc');
let _webIfc: WebIfcModule | null = null;

async function getWebIfc(): Promise<WebIfcModule> {
  if (_webIfc) return _webIfc;
  _webIfc = await import('web-ifc');
  return _webIfc;
}

/** Singleton IfcAPI — initialized once, reused for all model loads */
let _api: import('web-ifc').IfcAPI | null = null;
let _wasmReady = false;
let _wasmPromise: Promise<void> | null = null;

/** Initialize the IfcAPI. Safe to call multiple times — returns cached instance. */
export async function getIfcApi(): Promise<import('web-ifc').IfcAPI> {
  if (_api && _wasmReady) return _api;
  if (_wasmPromise) {
    await _wasmPromise;
    return _api!;
  }

  _wasmPromise = (async () => {
    const WEBIFC = await getWebIfc();
    _api = new WEBIFC.IfcAPI();
    _api.SetWasmPath(WASM_PATH, true);
    await _api.Init();
    _wasmReady = true;
    console.log('[web-ifc] WASM initialized');
  })();

  await _wasmPromise;
  return _api!;
}

/** Get the web-ifc module directly (for type constants like IFCRELDEFINESBYPROPERTIES) */
export async function getWebIfcModule(): Promise<WebIfcModule> {
  return getWebIfc();
}
