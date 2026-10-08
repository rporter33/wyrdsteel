import { api } from '../api';
import { panel, version } from '../store';

export function Pause() {
  void version.value;
  const st = api().saveStatus();
  const ago = st.lastSavedAgo < 0 ? 'not yet saved this session' : st.lastSavedAgo < 60 ? 'saved moments ago' : `saved ${Math.round(st.lastSavedAgo / 60)} min ago`;
  return (
    <div class="screen dim">
      <div class="panel">
        <h2>Paused</h2>
        <p class="muted">
          The game saves at waystones and in the citadel ({ago}; stored in {st.storage}).
        </p>
        <div class="stack">
          <button class="primary" autofocus onClick={() => api().closePanel()}>
            Resume
          </button>
          <button onClick={() => (panel.value = 'skills')}>Character</button>
          <button onClick={() => (panel.value = 'settings')}>Settings</button>
          <button onClick={() => (panel.value = 'controls')}>Controls</button>
          <button onClick={() => api().exportSave()}>Export save file</button>
          <button
            onClick={() => {
              if (st.lastSavedAgo < 0 || st.lastSavedAgo > 5) {
                if (!confirm('Progress since your last waystone will be lost. Quit to title?')) return;
              }
              api().quitToTitle();
            }}
          >
            Quit to title
          </button>
        </div>
      </div>
    </div>
  );
}
