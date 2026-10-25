/* Bounded, accessible live terminal cards; all command/output text is inert. */
(function (root) {
  'use strict';
  function create(container) {
    let sequence = 0;
    return {
      begin(command) {
        const card = document.createElement('details'); card.className = 'agent-terminal'; card.open = true;
        const summary = document.createElement('summary');
        const label = document.createElement('strong'); label.textContent = `⚙ Run ${++sequence}`;
        const title = document.createElement('span'); title.textContent = String(command).slice(0, 4000);
        const state = document.createElement('span'); state.className = 'agent-terminal-state'; state.textContent = 'Awaiting approval'; state.setAttribute('role', 'status');
        const output = document.createElement('pre'); output.tabIndex = 0; output.setAttribute('aria-label', 'Command output');
        summary.append(label, title, state); card.append(summary, output); container.append(card);
        while (container.children.length > 12) container.firstElementChild.remove();
        const write = text => { const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40; output.textContent = (output.textContent + text).slice(-48 * 1024); if (follow) output.scrollTop = output.scrollHeight; };
        return {
          event(event) {
            if (event.type === 'start') { state.textContent = 'Running'; write(`Working directory: ${event.workspace}\n`); }
            if (event.type === 'stdout' || event.type === 'stderr') write((event.type === 'stderr' ? '[stderr] ' : '') + event.text);
          },
          finish(message, failed = false) { state.textContent = (failed ? 'Failed / stopped · ' : 'Complete · ') + message; card.dataset.failed = String(failed); },
          write
        };
      }
    };
  }
  const api = { create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EltesAgentUI = api;
})(typeof window === 'object' ? window : globalThis);
