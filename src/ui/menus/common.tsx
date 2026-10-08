import type { ComponentChildren } from 'preact';
import { api } from '../api';
import { toast, version } from '../store';
import type { Command } from '../../core/sim/commands';

/** Send a command; surface a refusal as a toast. Returns true if it went through. */
export function run(cmd: Command): boolean {
  const errs = api().command([cmd]);
  version.value++;
  if (errs.length) {
    toast(errs[0]!, 'error');
    return false;
  }
  return true;
}

export function Panel(props: { title: string; wide?: boolean; children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class="screen dim" onClick={(e) => e.target === e.currentTarget && api().closePanel()}>
      <div class={'panel' + (props.wide ? ' wide' : '')} role="dialog" aria-label={props.title}>
        <div class="panel-head">
          <h2>{props.title}</h2>
          <button class="close" aria-label="Close" onClick={() => (props.onClose ?? api().closePanel)()}>
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  const i = props.tabs.findIndex((t) => t.id === props.value);
  return (
    <div class="tabs" role="tablist">
      <button class="tab-nav" data-tab-prev aria-label="Previous tab" onClick={() => props.onChange(props.tabs[(i + props.tabs.length - 1) % props.tabs.length]!.id)}>
        ‹
      </button>
      {props.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === props.value} class={'tab' + (t.id === props.value ? ' on' : '')} onClick={() => props.onChange(t.id)}>
          {t.label}
        </button>
      ))}
      <button class="tab-nav" data-tab-next aria-label="Next tab" onClick={() => props.onChange(props.tabs[(i + 1) % props.tabs.length]!.id)}>
        ›
      </button>
    </div>
  );
}
