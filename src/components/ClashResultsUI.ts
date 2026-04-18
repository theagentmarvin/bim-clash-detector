/**
 * ClashResultsUI.ts — Extracted clash results rendering
 *
 * Renders the grouped clash list shown in the results panel.
 * Moved from main.ts to keep the main module focused on state + rendering.
 */

import type { Clash } from '../core/types.js';
import { highlightClashElements } from '../hooks/useClashSelection.js';

const DISPLAY_LIMIT = 50;

/**
 * Renders `clashes` into the #resultsList container.
 * Groups by type (HARD / SOFT / CLEARANCE) and shows max 20 items per group.
 */
export function renderClashResults(clashes: Clash[]): void {
  const resultsList = document.getElementById('resultsList')!;
  resultsList.innerHTML = '';

  const groups: Record<string, Clash[]> = {
    HARD: clashes.filter(c => c.type === 'HARD'),
    SOFT: clashes.filter(c => c.type === 'SOFT'),
    CLEARANCE: clashes.filter(c => c.type === 'CLEARANCE'),
  };

  let shown = 0;

  for (const [type, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'results-group';

    const header = document.createElement('div');
    header.className = `results-group-header ${type.toLowerCase()}`;
    header.textContent = `${type} (${items.length})`;
    groupDiv.appendChild(header);

    for (let i = 0; i < items.length; i++) {
      if (shown >= DISPLAY_LIMIT) break;
      const clash = items[i];

      const item = document.createElement('div');
      item.className = 'clash-item';
      item.innerHTML = `
        <div class="clash-type ${clash.type.toLowerCase()}">${clash.type}</div>
        <div class="clash-info">
          <span class="clash-pair">${clash.elementA.type} ↔ ${clash.elementB.type}</span>
          <span class="clash-level">${clash.elementA.level ?? '—'}</span>
        </div>
        <span class="clash-id">#${clash.id.split('-').pop()}</span>
        <span class="clash-severity">${Math.round(clash.severity)}/100</span>
      `;

      item.addEventListener('click', () => {
        highlightClashElements(clash);
        document.getElementById('sidebar')!.scrollTop = 0;
      });

      groupDiv.appendChild(item);
      shown++;
    }

    resultsList.appendChild(groupDiv);
  }

  const remaining = clashes.length - shown;
  if (remaining > 0) {
    const more = document.createElement('div');
    more.className = 'clash-more';
    more.textContent = `+${remaining} more clashes`;
    resultsList.appendChild(more);
  }

  if (clashes.length === 0) {
    resultsList.innerHTML =
      '<div class="clash-more">No clashes found between the selected types.</div>';
  }
}

// ─── Shared highlight helper ─────────────────────────────────────────────────
// highlightClashElements is defined in useClashSelection.ts and re-exported from there.
