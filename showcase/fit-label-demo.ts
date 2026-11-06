/** Gallery section: fitLabel and fitLabelsIn. */
import { fitLabelsIn } from '../src/ui/fit-label.ts';

// Titles in the shapes a task list holds: owner/repo, a " - " suffix, and one
// with neither.
const TITLES = [
  'wow-look-at-my/webhooks · wow-dind runner · job 117925653277',
  'wow-look-at-my/gosmopolitan - workflow_job',
  'release build',
];
const WIDTHS = [520, 300, 200, 120, 60];

export function mountFitLabelDemo(): void {
  const root = document.getElementById('demo-fit-label');
  if (!root) return;
  for (const title of TITLES) {
    for (const w of WIDTHS) {
      const row = document.createElement('div');
      row.className = 'fit-row';
      const width = document.createElement('code');
      width.textContent = `${w}px`;
      const box = document.createElement('div');
      box.className = 'fit-box';
      box.style.width = `${w}px`;
      box.dataset.fitLabel = title;
      row.append(width, box);
      root.append(row);
    }
  }
  fitLabelsIn(root);
}
