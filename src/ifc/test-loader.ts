/**
 * Test script for the IFC geometry layer.
 * Run with: npx tsx src/ifc/test-loader.ts
 */
import { loadIfcFromUrl } from './loader';

const IFC_URL = 'https://raw.githubusercontent.com/IFCjs/hello-world/main/public/example.ifc';

async function main() {
  console.log('[test] Loading IFC from:', IFC_URL);

  try {
    const model = await loadIfcFromUrl(IFC_URL, 0);

    console.log('\n=== Model Stats ===');
    console.log('elements:', model.elements.length);
    console.log('levels:', model.levels);
    console.log('categories:', model.categories);

    // Show AABB for first 5 elements
    console.log('\n=== First 5 Element BBox ===');
    for (let i = 0; i < Math.min(5, model.elements.length); i++) {
      const elem = model.elements[i];
      const bbox = elem.bbox;
      if (!bbox) { console.log(`[${i}] ${elem.type} "${elem.name}" - no bbox`); continue; }
      console.log(
        `[${i}] ${elem.type} "${elem.name}" | expressID=${elem.expressID} | ` +
        `bbox=(${bbox.min[0].toFixed(3)}, ${bbox.min[1].toFixed(3)}, ${bbox.min[2].toFixed(3)}) → ` +
        `(${bbox.max[0].toFixed(3)}, ${bbox.max[1].toFixed(3)}, ${bbox.max[2].toFixed(3)})`,
      );
    }

    console.log('\n=== Element Properties (first 3) ===');
    for (let i = 0; i < Math.min(3, model.elements.length); i++) {
      const el = model.elements[i];
      console.log(`  [${i}] ${el.type} "${el.name}" | expressID=${el.expressID} | guid=${el.guid}`);
    }

    console.log('\n✅ IFC loader test passed');
  } catch (err) {
    console.error('[test] Error:', err);
    throw err;
  }
}

main();