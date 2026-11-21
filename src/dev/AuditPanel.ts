import type { AuditCategory, AuditLog, AuditRecord, AuditValue } from '../game/audit';
import { createInspector, type InstanceSnapshot } from '../game/inspection';
import type { GameState, WorldInstance } from '../game/state';
import './audit-panel.css';

const categories: readonly AuditCategory[] = ['world', 'instance', 'interaction', 'command', 'selection', 'condition', 'outcome', 'operation', 'mutation', 'fact', 'dispatch', 'reaction', 'legacy', 'movement', 'failure'];
const kinds: readonly WorldInstance['kind'][] = ['character', 'faction', 'mission', 'relation'];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  return node;
}
function selector(label: string, values: readonly string[]): HTMLSelectElement {
  const node = element('select');
  node.setAttribute('aria-label', label);
  node.add(new Option(label, ''));
  for (const value of values) node.add(new Option(value, value));
  return node;
}
function property(instance: InstanceSnapshot, key: string): AuditValue | undefined {
  const value = instance.properties;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as { readonly [key: string]: AuditValue })[key]
    : undefined;
}

/** Development-only consumer. Reads detached snapshots; never writes gameplay state. */
export function mountAuditPanel(world: GameState, container: HTMLElement = document.body): () => void {
  const audit = (world as GameState & { readonly audit?: AuditLog }).audit;
  const inspector = createInspector(world);
  const root = element('aside', undefined, 'og-audit-root');
  root.setAttribute('aria-label', 'Diagnóstico da engine');
  const toggle = button('Abrir inspetor');
  toggle.className = 'og-audit-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = element('section', undefined, 'og-audit-panel');
  panel.hidden = true;
  const title = element('h2', 'Auditoria narrativa');
  const toolbar = element('div', undefined, 'og-audit-toolbar');
  const category = selector('Todas as categorias', categories);
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'ID de instância';
  search.setAttribute('aria-label', 'Filtrar por ID de instância');
  const refresh = button('Atualizar estado');
  const clear = button('Limpar histórico');
  clear.disabled = !audit;
  toolbar.append(category, search, refresh, clear);

  const columns = element('div', undefined, 'og-audit-columns');
  const history = element('section', undefined, 'og-audit-column');
  const historyTitle = element('h3', 'Histórico cronológico');
  const historyList = element('div', undefined, 'og-audit-list');
  historyList.setAttribute('aria-label', 'Registros de auditoria');
  const causal = element('p', undefined, 'og-audit-causal');
  const recordDetails = element('pre', 'Selecione um registro para consultar seus detalhes.', 'og-audit-details');
  history.append(historyTitle, historyList, causal, recordDetails);

  const instances = element('section', undefined, 'og-audit-column');
  const instanceTitle = element('h3', 'Instâncias atuais');
  const kind = selector('Todas as categorias de instância', kinds);
  const instanceList = element('div', undefined, 'og-audit-list');
  instanceList.setAttribute('aria-label', 'Instâncias do mundo');
  const instanceDetails = element('pre', 'Selecione uma instância. As propriedades são fotografias do estado atual.', 'og-audit-details');
  instances.append(instanceTitle, kind, instanceList, instanceDetails);
  columns.append(history, instances);
  const stats = element('p', undefined, 'og-audit-stats');
  const note = element('p', 'Atualização por registros de auditoria. Escritas externas sem registro exigem “Atualizar estado”. Limpar o histórico não altera o mundo.', 'og-audit-note');
  panel.append(title, toolbar, columns, stats, note);
  root.append(toggle, panel);
  container.append(root);

  let disposed = false;
  let queued = false;
  let selectedRecordId: string | undefined;
  let selectedInstanceId: string | undefined;

  function render() {
    if (disposed || panel.hidden) return;
    try {
      const records = audit?.records() ?? [];
      const snapshots = inspector.list();
      const query = search.value.trim();
      const filtered = records.filter(record => (!category.value || record.category === category.value)
        && (!query || record.instanceIds.some(id => id.includes(query))));
      const recordNodes = filtered.map(record => {
        const row = button(`#${record.sequence} · ${record.category}/${record.phase} · ${record.status}\n${record.instanceIds.join(', ') || 'sem instância'}`);
        row.className = 'og-audit-row';
        row.title = `Ocorrência: ${record.id}\nCadeia: ${record.traceId}`;
        row.setAttribute('aria-pressed', String(record.id === selectedRecordId));
        row.addEventListener('click', () => { selectedRecordId = record.id; schedule(); });
        return row;
      });
      historyTitle.textContent = `Histórico cronológico (${filtered.length}/${records.length})`;
      historyList.replaceChildren(...(recordNodes.length ? recordNodes : [element('p', 'Nenhum registro para este filtro.')]));
      const selected: AuditRecord | undefined = records.find(record => record.id === selectedRecordId);
      if (selected) {
        const missingParent = selected.parentId && !records.some(record => record.id === selected.parentId);
        causal.textContent = `Cadeia: ${selected.traceId}\nOcorrência: ${selected.id}\nPai: ${selected.parentId ?? 'raiz'}${missingParent ? '\nO registro pai não está retido: pode ter sido descartado ou limpo.' : ''}`;
        recordDetails.textContent = JSON.stringify(selected, null, 2);
      } else {
        causal.textContent = '';
        recordDetails.textContent = selectedRecordId
          ? 'O registro selecionado não está mais no histórico retido (limpeza ou limite de retenção).'
          : 'Selecione um registro para consultar seus detalhes.';
      }

      const visibleInstances = snapshots.filter(instance => (!kind.value || instance.kind === kind.value)
        && (!query || instance.id.includes(query)));
      instanceTitle.textContent = `Instâncias atuais (${visibleInstances.length}/${snapshots.length})`;
      instanceList.replaceChildren(...(visibleInstances.length ? visibleInstances.map(instance => {
        const row = button(`${instance.kind} · ${instance.id}\nDefinição: ${instance.definitionId}`);
        row.className = 'og-audit-row';
        row.setAttribute('aria-pressed', String(instance.id === selectedInstanceId));
        row.addEventListener('click', () => { selectedInstanceId = instance.id; schedule(); });
        return row;
      }) : [element('p', 'Nenhuma instância para este filtro.')]));
      const selectedInstance = snapshots.find(instance => instance.id === selectedInstanceId);
      instanceDetails.textContent = selectedInstance ? JSON.stringify({
        snapshot: selectedInstance,
        directionalRelations: snapshots.filter(instance => instance.kind === 'relation'
          && (property(instance, 'sourceId') === selectedInstance.id || property(instance, 'targetId') === selectedInstance.id)),
      }, null, 2) : selectedInstanceId ? 'A instância selecionada não está mais no registro.' : 'Selecione uma instância. As propriedades são fotografias do estado atual.';

      const values = audit?.stats();
      stats.textContent = values
        ? `${values.worldId} · ${values.enabled ? 'auditoria ligada' : 'auditoria desligada'} · retidos ${values.retained}/${values.capacity} · descartados ${values.discarded} · sequência ${values.sequence} · erros de consumidores ${values.observerErrors}${values.lastObserverError ? ` (${values.lastObserverError})` : ''}`
        : 'Auditoria indisponível neste mundo. A inspeção de estado continua sendo somente leitura.';
    } catch (error) {
      // Rendering is asynchronous and isolated from the command that notified us.
      stats.textContent = `Falha no painel de diagnóstico: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  function schedule() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.textContent = panel.hidden ? 'Abrir inspetor' : 'Fechar inspetor';
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    schedule();
  });
  category.addEventListener('change', schedule);
  kind.addEventListener('change', schedule);
  search.addEventListener('input', schedule);
  refresh.addEventListener('click', schedule);
  clear.addEventListener('click', () => { audit?.clear(); selectedRecordId = undefined; schedule(); });
  // Phaser listens on window: typing and keyboard navigation inside this consumer
  // must never invoke movement, attacks, or scene restart.
  const stopKeyboard = (event: KeyboardEvent) => { event.stopPropagation(); };
  root.addEventListener('keydown', stopKeyboard);
  root.addEventListener('keyup', stopKeyboard);
  const unsubscribe = audit?.subscribe(schedule);
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    root.removeEventListener('keydown', stopKeyboard);
    root.removeEventListener('keyup', stopKeyboard);
    root.remove();
  };
}
