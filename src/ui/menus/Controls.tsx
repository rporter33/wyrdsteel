import { Panel } from './common';
import { api } from '../api';
import { panel } from '../store';

const ROWS: [string, string, string][] = [
  ['Move', 'WASD', 'Left stick'],
  ['Aim', 'Mouse', 'Right stick'],
  ['Light / heavy / launcher', 'Left mouse / E / Q', 'X / Y / B'],
  ['Hold launcher to follow up into the air', 'Hold Q', 'Hold B'],
  ['Dodge', 'Space', 'A'],
  ['Fire', 'Right mouse', 'RT'],
  ['Precise aim (no assist)', 'Shift', 'LT'],
  ['Abilities', '1 2 3 4', 'LB + X / Y / B / A'],
  ['Ruiner (full meter)', 'R', 'LB + RB'],
  ['Interact / finisher', 'F', 'RB'],
  ['Lock on / cycle', 'Tab / mouse wheel', 'R3'],
  ['Flask', 'C', 'D-pad up'],
  ['Character / skills', 'I / K', 'View'],
  ['Pause', 'Esc', 'Menu'],
];

export function Controls() {
  return (
    <Panel title="Controls" onClose={() => (panel.value = 'pause')}>
      <table class="controls">
        <thead>
          <tr>
            <th />
            <th>Keyboard and mouse</th>
            <th>Gamepad</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r[0]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="row end">
        <button onClick={() => api().closePanel()}>Resume</button>
      </div>
    </Panel>
  );
}
