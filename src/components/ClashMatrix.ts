/**
 * ClashMatrix.ts
 * Type-vs-type clash count heatmap grid.
 *
 * Rows = Selection A IFC types (Structure)
 * Columns = Selection B IFC types (MEP)
 * Cell color encodes clash count severity.
 */

import type { Clash } from '../core/types';

// ─── Data Structure ─────────────────────────────────────────────────────

export interface ClashMatrixData {
  rowTypes: string[];   // Selection A types
  colTypes: string[];   // Selection B types
  matrix: number[][];    // count[rowIdx][colIdx]
  maxCount: number;
}

// ─── Computation ────────────────────────────────────────────────────────

/**
 * Compute a type-vs-type clash matrix from a flat clash array.
 * Rows = elementA.type (Selection A), Cols = elementB.type (Selection B)
 */
export function computeClashMatrix(clashes: Clash[]): ClashMatrixData {
  const rowMap = new Map<string, number>(); // type → row index
  const colMap = new Map<string, number>(); // type → col index

  // First pass: collect all unique types
  for (const clash of clashes) {
    const aType = clash.elementA.type;
    const bType = clash.elementB.type;
    if (!rowMap.has(aType)) rowMap.set(aType, rowMap.size);
    if (!colMap.has(bType)) colMap.set(bType, colMap.size);
  }

  const rowTypes = Array.from(rowMap.keys()).sort();
  const colTypes = Array.from(colMap.keys()).sort();

  // Rebuild index maps after sorting
  const newRowMap = new Map<string, number>();
  rowTypes.forEach((t, i) => newRowMap.set(t, i));

  const newColMap = new Map<string, number>();
  colTypes.forEach((t, i) => newColMap.set(t, i));

  const rows = rowTypes.length;
  const cols = colTypes.length;

  // Initialize matrix with zeros
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  // Second pass: count clashes per type pair
  for (const clash of clashes) {
    const r = newRowMap.get(clash.elementA.type);
    const c = newColMap.get(clash.elementB.type);
    if (r !== undefined && c !== undefined) {
      matrix[r][c]++;
    }
  }

  const maxCount = matrix.flat().reduce((max, v) => Math.max(max, v), 0);

  return { rowTypes, colTypes, matrix, maxCount };
}

// ─── Cell Class Helpers ─────────────────────────────────────────────────

function cellClass(count: number): string {
  if (count === 0) return 'matrix-cell count-0';
  if (count <= 10) return 'matrix-cell count-1';
  if (count <= 50) return 'matrix-cell count-2';
  return 'matrix-cell count-3';
}

function cellLabel(count: number): string {
  return count === 0 ? '—' : String(count);
}

// ─── Rendering ──────────────────────────────────────────────────────────

/**
 * Render the clash matrix into `#clashMatrixContainer`.
 * Reads from `state.clashResults` to build counts.
 * Uses the global `window` handlers for cell-click to trigger re-detection.
 */
export function renderClashMatrix(): void {
  const container = document.getElementById('clashMatrixContainer');
  if (!container) return;

  // Get clashes from global state
  const clashes = (window as any).__clashResults as Clash[] | null;
  const structure = (window as any).__structureElements as any[] | null;
  const mep = (window as any).__mepElements as any[] | null;

  if (!clashes || clashes.length === 0) {
    // Show an empty matrix with all loaded types
    const structTypes = (structure ?? []).map((e: any) => e.type);
    const mepTypes = (mep ?? []).map((e: any) => e.type);

    const allRowTypes = [...new Set(structTypes)].sort();
    const allColTypes = [...new Set(mepTypes)].sort();

    if (allRowTypes.length === 0 || allColTypes.length === 0) {
      container.innerHTML = '<div class="matrix-empty">No clashes detected yet. Run detection to populate matrix.</div>';
      return;
    }

    // Render zero-matrix
    container.innerHTML = buildMatrixHTML(allRowTypes, allColTypes, allRowTypes.map(() => allColTypes.map(() => 0)));
    wireMatrixEvents(container);
    return;
  }

  const data = computeClashMatrix(clashes);
  container.innerHTML = buildMatrixHTML(data.rowTypes, data.colTypes, data.matrix);
  wireMatrixEvents(container);
}

function buildMatrixHTML(rowTypes: string[], colTypes: string[], matrix: number[][]): string {
  const cols = colTypes.length;

  // Header row: top-left corner + column headers
  let headerRow = '<div class="matrix-cell header"></div>'; // empty corner
  for (const col of colTypes) {
    headerRow += `<div class="matrix-cell header" title="${col}">${shortenType(col)}</div>`;
  }

  let html = `<div class="matrix-grid" style="grid-template-columns: 80px repeat(${cols}, 48px);">`;
  html += `<div class="matrix-row header-row">${headerRow}</div>`;

  // Data rows
  for (let r = 0; r < rowTypes.length; r++) {
    let rowHtml = `<div class="matrix-cell header" title="${rowTypes[r]}">${shortenType(rowTypes[r])}</div>`;
    for (let c = 0; c < colTypes.length; c++) {
      const count = matrix[r][c];
      const cls = cellClass(count);
      const label = cellLabel(count);
      // data-row/col carry the full type names for click handling
      rowHtml += `<div class="${cls}" data-row="${rowTypes[r]}" data-col="${colTypes[c]}" title="${count} clashes">${label}</div>`;
    }
    html += `<div class="matrix-row">${rowHtml}</div>`;
  }

  html += '</div>';
  return html;
}

/**
 * Strip "Ifc" prefix for compact display.
 */
function shortenType(type: string): string {
  return type.replace(/^Ifc/, '');
}

/**
 * Attach click handlers to matrix cells so they trigger re-detection
 * with the selected row/col as Selection A/B.
 */
function wireMatrixEvents(container: HTMLElement): void {
  const cells = container.querySelectorAll('.matrix-cell[data-row][data-col]');
  cells.forEach(cell => {
    cell.addEventListener('click', () => {
      const rowType = cell.getAttribute('data-row')!;
      const colType = cell.getAttribute('data-col')!;

      // Scroll sidebar to top
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.scrollTop = 0;

      // Set Selection A (row type) and Selection B (col type)
      setSelectValue('selectionASelect', [rowType]);
      setSelectValue('selectionBSelect', [colType]);

      // Trigger change handlers
      const selA = document.getElementById('selectionASelect') as HTMLSelectElement;
      const selB = document.getElementById('selectionBSelect') as HTMLSelectElement;
      if (selA) (window as any).onSelectionAChange?.(selA);
      if (selB) (window as any).onSelectionBChange?.(selB);

      // Run detection
      (window as any).runDetection?.();
    });
  });
}

/**
 * Set a multi-select dropdown to specific values (replacing current selection).
 */
function setSelectValue(selectId: string, values: string[]): void {
  const select = document.getElementById(selectId) as HTMLSelectElement;
  if (!select) return;

  // Deselect all first
  Array.from(select.options).forEach(opt => (opt as HTMLOptionElement).selected = false);

  // Select matching options
  Array.from(select.options).forEach(opt => {
    if (values.includes(opt.value)) {
      (opt as HTMLOptionElement).selected = true;
    }
  });
}