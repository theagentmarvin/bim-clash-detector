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
    console.log('modelId:', model.modelId);
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

    console.log('\n=== Mesh Map ===');
    console.log('meshMap size:', model.meshMap.size);

    console.log('\n=== Property Catalog (first 10 props) ===');
    const propKeys = Object.keys(model.propertyCatalog).slice(0, 10);
    for (const key of propKeys) {
      const vals = model.propertyCatalog[key];
      console.log(`  ${key}: ${vals.length} unique values → ${JSON.stringify(vals.slice(0, 3))}`);
    }

    console.log('\n✅ IFC loader test passed');
  } catch (err) {
    console.error('[test] Error:', err);
    throw err;
  }
}

main();