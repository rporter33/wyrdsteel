import { api } from '../api';
import { panel } from '../store';

export function Pause() {
  return (
    <div class="screen dim">
      <div class="panel">
        <h2>Paused</h2>
        <div class="stack">
          <button class="primary" autofocus onClick={() => api().closePanel()}>
            Resume
          </button>
          <button onClick={() => (panel.value = 'controls')}>Controls</button>
          <button onClick={() => api().quitToTitle()}>Quit to title</button>
        </div>
      </div>
    </div>
  );
}
