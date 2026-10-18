// Text anchoring: converts a DOM Range inside the problem statement to character offsets
// (plus the quoted text) and back, so highlights survive page reloads and MathJax re-renders.
(() => {
  const SKIP = 'script, style, noscript, textarea, .MathJax_Preview, cfn-notes-root';

  function textNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return n.data.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  const joinText = nodes => nodes.map(n => n.data).join('');

  function pointToOffset(nodes, container, offset) {
    const boundary = document.createRange();
    boundary.setStart(container, offset);
    let acc = 0;
    for (const n of nodes) {
      if (n === container) return acc + offset;
      // Node ends at or before the boundary -> it is entirely before it.
      if (boundary.comparePoint(n, n.length) <= 0) acc += n.length;
      else return acc;
    }
    return acc;
  }

  function offsetToPoint(nodes, offset, isEnd) {
    let acc = 0;
    for (const n of nodes) {
      const len = n.length;
      if (isEnd ? offset <= acc + len : offset < acc + len) return [n, offset - acc];
      acc += len;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.length] : null;
  }

  function rangeToAnchor(root, range) {
    if (!range.intersectsNode(root)) return null;
    const r = range.cloneRange();
    const all = document.createRange();
    all.selectNodeContents(root);
    if (r.compareBoundaryPoints(Range.START_TO_START, all) < 0) r.setStart(all.startContainer, all.startOffset);
    if (r.compareBoundaryPoints(Range.END_TO_END, all) > 0) r.setEnd(all.endContainer, all.endOffset);

    const nodes = textNodes(root);
    const text = joinText(nodes);
    let start = pointToOffset(nodes, r.startContainer, r.startOffset);
    let end = pointToOffset(nodes, r.endContainer, r.endOffset);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return null;
    return {
      start,
      end,
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 24), start),
      suffix: text.slice(end, end + 24),
    };
  }

  // If the statement text shifted, find the stored quote again, preferring matching context.
  function relocate(text, a) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = text.indexOf(a.quote); i !== -1; i = text.indexOf(a.quote, i + 1)) {
      let score = -Math.abs(i - a.start) / 1000;
      if (a.prefix && text.slice(Math.max(0, i - a.prefix.length), i) === a.prefix) score += 10;
      if (a.suffix && text.slice(i + a.quote.length, i + a.quote.length + a.suffix.length) === a.suffix) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  function anchorToRange(root, a, nodes = textNodes(root), text = joinText(nodes)) {
    let { start, end } = a;
    if (text.slice(start, end) !== a.quote) {
      const found = relocate(text, a);
      if (found < 0) return null;
      start = found;
      end = found + a.quote.length;
    }
    const s = offsetToPoint(nodes, start, false);
    const e = offsetToPoint(nodes, end, true);
    if (!s || !e) return null;
    const r = document.createRange();
    r.setStart(s[0], s[1]);
    r.setEnd(e[0], e[1]);
    return r;
  }

  globalThis.CFNAnchor = { textNodes, joinText, rangeToAnchor, anchorToRange };
})();
