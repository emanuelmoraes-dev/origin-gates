import type { AuditCategory, AuditRecord, AuditValue, InstanceSnapshot, NarrativeWorld, InstanceHandle } from '@origin-gates/narrative-engine';
import { buildCausalTree, filterAuditRecords, type AuditFilter, type CausalIssue, type CausalNode, type CausalTree } from './audit-view';
import { diagnosticFilename } from './diagnostics';
import './audit-panel.css';

const categories: readonly AuditCategory[] = ['world', 'definition', 'composition', 'reference', 'role', 'instance', 'interaction', 'command', 'selection', 'condition', 'outcome', 'operation', 'mutation', 'fact', 'dispatch', 'reaction', 'legacy', 'movement', 'failure'];
const kinds: readonly InstanceHandle['kind'][] = ['character', 'faction', 'mission', 'relation', 'composition'];

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
export function mountAuditPanel(world: NarrativeWorld, container: HTMLElement = document.body): () => void {
  const audit = world.audit;
  const inspector = world.inspect;
  const root = element('aside', undefined, 'og-audit-root');
  root.setAttribute('aria-label', 'Diagnóstico da engine');
  const toggle = button('Abrir inspetor');
  toggle.className = 'og-audit-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = element('section', undefined, 'og-audit-panel');
  panel.hidden = true;
  const title = element('h2', 'Auditoria narrativa');
  const toolbar = element('div', undefined, 'og-audit-toolbar');
  const view = selector('Visualização', []);
  view.add(new Option('Cronológico', 'chronological'));
  view.add(new Option('Árvore causal', 'causal'));
  view.remove(0);
  const category = selector('Todas as categorias', categories);
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'ID de instância';
  search.setAttribute('aria-label', 'Filtrar por ID de instância');
  const instanceMode = selector('Modo de busca', []);
  instanceMode.add(new Option('Instância: cadeia relacionada', 'trace'));
  instanceMode.add(new Option('Instância: participação direta', 'direct'));
  instanceMode.remove(0);
  const traceSearch = element('input');
  traceSearch.type = 'search';
  traceSearch.placeholder = 'traceId exato';
  traceSearch.setAttribute('aria-label', 'Filtrar por cadeia causal');
  const selectedTrace = button('Ver cadeia selecionada');
  const resetFilters = button('Limpar filtros');
  const expandAll = button('Expandir tudo');
  const collapseAll = button('Recolher tudo');
  const refresh = button('Atualizar estado');
  const clear = button('Limpar histórico');
  const exportJSON = button('Exportar diagnóstico JSON');
  clear.disabled = !audit;
  toolbar.append(view, category, search, instanceMode, traceSearch, selectedTrace, resetFilters, expandAll, collapseAll, refresh, clear, exportJSON);
  const filterHelp = element('p', undefined, 'og-audit-note');
  const retention = element('p', undefined, 'og-audit-warning');
  const exportMessage = element('p', undefined, 'og-audit-note');
  exportMessage.setAttribute('role', 'status');

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
  panel.append(title, toolbar, filterHelp, retention, exportMessage, columns, stats, note);
  root.append(toggle, panel);
  container.append(root);

  let disposed = false;
  let queued = false;
  let selectedRecordId: string | undefined;
  let selectedInstanceId: string | undefined;
  const openTraces = new Map<string, boolean>();
  const openNodes = new Map<string, boolean>();
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();

  const issueLabels: Record<CausalIssue, string> = {
    missingParent: 'pai não retido: raiz parcial',
    crossTraceParent: 'pai em outra cadeia/mundo: vínculo não seguido',
    cycle: 'ciclo detectado: vínculo interrompido apenas na visualização',
    duplicateId: 'ID duplicado nos dados',
  };
  function appearance(record: AuditRecord): string {
    return record.category === 'failure' || record.status === 'failed' ? 'og-audit-failed'
      : ['rejected', 'unavailable'].includes(record.status) ? 'og-audit-rejected' : '';
  }
  function description(record: AuditRecord) {
    return `#${record.sequence} · ${record.category}/${record.phase} · ${record.status}\n${record.instanceIds.join(', ') || 'sem participante direto'}`;
  }
  function recordButton(record: AuditRecord): HTMLButtonElement {
    const row = button(description(record));
    row.className = `og-audit-row ${appearance(record)}`;
    row.title = `Ocorrência: ${record.id}\nCadeia: ${record.traceId}\nPai: ${record.parentId ?? 'raiz'}`;
    row.setAttribute('aria-pressed', String(record.id === selectedRecordId));
    row.addEventListener('click', () => { selectedRecordId = record.id; schedule(); });
    return row;
  }
  function treeNodes(tree: CausalTree, filtered: boolean): HTMLElement[] {
    return tree.traces.map(trace => {
      const group = element('details', undefined, 'og-audit-trace');
      group.open = openTraces.get(trace.traceId) ?? true;
      const summary = element('summary', trace.traceId);
      group.append(summary);
      group.addEventListener('toggle', () => { if (!disposed && root.contains(group)) openTraces.set(trace.traceId, group.open); });
      const stack: { node: CausalNode; parent: HTMLElement }[] = trace.roots.slice().reverse().map(node => ({ node, parent: group }));
      while (stack.length) {
        const { node, parent } = stack.pop()!;
        const wrapper = element('div', undefined, `og-audit-tree-node${node.context ? ' og-audit-context' : ''}`);
        parent.append(wrapper);
        if (node.children.length) {
          const details = element('details');
          details.open = openNodes.get(node.record.id) ?? filtered;
          const heading = element('summary');
          heading.className = appearance(node.record);
          heading.title = `Ocorrência: ${node.record.id}\nPai: ${node.record.parentId ?? 'raiz'}`;
          heading.append(element('span', description(node.record)));
          const select = button(`Detalhes #${node.record.sequence}`);
          select.setAttribute('aria-pressed', String(node.record.id === selectedRecordId));
          select.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            selectedRecordId = node.record.id;
            schedule();
          });
          heading.append(select);
          details.append(heading);
          wrapper.append(details);
          details.addEventListener('toggle', () => { if (!disposed && root.contains(details)) openNodes.set(node.record.id, details.open); });
          for (const child of node.children.slice().reverse()) stack.push({ node: child, parent: details });
        } else wrapper.append(recordButton(node.record));
        if (node.context) wrapper.prepend(element('small', 'Ancestral de contexto — não corresponde diretamente ao filtro.'));
        if (node.issue) wrapper.prepend(element('p', `${issueLabels[node.issue]} (${node.record.parentId ?? node.record.id})`, 'og-audit-warning'));
      }
      return group;
    });
  }

  function render() {
    if (disposed || panel.hidden) return;
    try {
      const records = audit?.records() ?? [];
      const snapshots = inspector.list();
      const query = search.value.trim();
      const filter: AuditFilter = { category: category.value as AuditFilter['category'], instanceQuery: query, traceQuery: traceSearch.value, instanceMode: instanceMode.value as AuditFilter['instanceMode'] };
      const filtered = filterAuditRecords(records, filter);
      const activeFilter = Boolean(category.value || query || traceSearch.value.trim());
      const ids = new Set(records.map(record => record.id));
      const traceIds = new Set(records.map(record => record.traceId));
      for (const id of openNodes.keys()) if (!ids.has(id)) openNodes.delete(id);
      for (const id of openTraces.keys()) if (!traceIds.has(id)) openTraces.delete(id);
      const tree = buildCausalTree(records, new Set(filtered.map(record => record.id)));
      const recordNodes = view.value === 'causal' ? treeNodes(tree, activeFilter) : filtered.map(recordButton);
      historyTitle.textContent = `${view.value === 'causal' ? 'Árvore causal' : 'Histórico cronológico'} (${filtered.length}/${records.length} correspondências${view.value === 'causal' ? ' + ancestrais' : ''})`;
      const scrollTop = historyList.scrollTop;
      historyList.replaceChildren(...(recordNodes.length ? recordNodes : [element('p', 'Nenhum registro para este filtro.')]));
      historyList.scrollTop = scrollTop;
      expandAll.hidden = collapseAll.hidden = view.value !== 'causal';
      filterHelp.textContent = `${instanceMode.value === 'trace' ? 'Busca de instância inclui registros da mesma cadeia, mesmo sem o ID repetido.' : 'Busca de instância exige participação direta no registro.'} Categoria e traceId restringem as correspondências. Na árvore, ancestrais são preservados como contexto. As fases start/point/end continuam sendo registros distintos da execução.`;
      const issues = tree.issues;
      const values = audit?.stats();
      retention.textContent = `${values?.discarded ? `Histórico incompleto: ${values.discarded} registros descartados por capacidade. ` : ''}${issues.length ? `${issues.length} referência(s) causal(is) ausente(s) ou inconsistente(s) no histórico retido; explore as raízes parciais sem filtros para localizá-las.` : ''}`;
      const selected: AuditRecord | undefined = records.find(record => record.id === selectedRecordId);
      selectedTrace.disabled = !selected;
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
  view.addEventListener('change', schedule);
  instanceMode.addEventListener('change', schedule);
  traceSearch.addEventListener('input', schedule);
  kind.addEventListener('change', schedule);
  search.addEventListener('input', schedule);
  refresh.addEventListener('click', schedule);
  clear.addEventListener('click', () => { audit?.clear(); schedule(); });
  resetFilters.addEventListener('click', () => { category.value = ''; search.value = ''; traceSearch.value = ''; schedule(); });
  selectedTrace.addEventListener('click', () => {
    const selected = audit?.records().find(record => record.id === selectedRecordId);
    if (!selected) return;
    category.value = ''; search.value = ''; traceSearch.value = selected.traceId; schedule();
  });
  function setExpanded(open: boolean) {
    for (const record of audit?.records() ?? []) { openNodes.set(record.id, open); openTraces.set(record.traceId, open); }
    schedule();
  }
  expandAll.addEventListener('click', () => setExpanded(true));
  collapseAll.addEventListener('click', () => setExpanded(false));
  exportJSON.addEventListener('click', () => {
    let url: string | undefined;
    const link = element('a');
    try {
      const diagnostic = world.diagnostics();
      const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(blob);
      link.href = url;
      link.download = diagnosticFilename(diagnostic);
      link.hidden = true;
      root.append(link);
      link.click();
      const objectUrl = url;
      downloads.set(objectUrl, setTimeout(() => { URL.revokeObjectURL(objectUrl); downloads.delete(objectUrl); }, 1000));
      exportMessage.textContent = `Download solicitado: ${link.download} (${diagnostic.audit.records.length} registros retidos, sem filtros).`;
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      exportMessage.textContent = `Falha ao exportar diagnóstico: ${error instanceof Error ? error.message : String(error)}`;
    } finally { link.remove(); }
  });
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
    for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
    downloads.clear();
    root.removeEventListener('keydown', stopKeyboard);
    root.removeEventListener('keyup', stopKeyboard);
    root.remove();
  };
}
