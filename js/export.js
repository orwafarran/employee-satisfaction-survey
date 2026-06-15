/**
 * Export — one-click .xlsx and .pdf of everything on the dashboard.
 * Runs entirely client-side (SheetJS + jsPDF), so it works identically in the
 * full app and the static demo.
 */
(function () {
  'use strict';

  const SHORT = ['Strongly Disagree', 'Disagree', 'Agree', 'Strongly Agree'];

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function pct(n, digits = 1) {
    return (n == null || isNaN(n)) ? '' : Number(n.toFixed(digits));
  }

  // Render a distribution donut to a PNG data URL, offscreen, synchronously.
  function donutPng(counts, sizePx) {
    const holder = document.createElement('div');
    holder.style.cssText =
      `position:fixed;left:-9999px;top:-9999px;width:${sizePx}px;height:${sizePx}px;`;
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    holder.appendChild(canvas);
    document.body.appendChild(holder);
    let url = null;
    try {
      const chart = window.Charts.distributionDonut(canvas, counts, { animate: false });
      url = chart.toBase64Image('image/png', 1);
      chart.destroy();
    } catch (_) {
      url = null;
    }
    document.body.removeChild(holder);
    return url;
  }

  // -------------------------------------------------------------------------
  //  XLSX
  // -------------------------------------------------------------------------
  function toXlsx(content, payload, scores) {
    if (typeof XLSX === 'undefined') return alert('Excel library failed to load.');
    const wb = XLSX.utils.book_new();
    const o = scores.overall;

    // Summary sheet
    const summary = [
      ['Employee Satisfaction Survey — Summary'],
      ['Generated', new Date().toLocaleString()],
      ['Survey status', payload.status],
      ['Respondents', o.respondents],
      payload.headcount ? ['Headcount (N)', payload.headcount] : null,
      [],
      ['Overall satisfaction (Agree + Strongly Agree)', pct(o.headline) + '%'],
      ['Average rating (out of 4)', Number(o.avgRating.toFixed(2))],
      ['Satisfaction index ((mean−1)/3)', pct(o.satisfactionIndex) + '%'],
      ['Positive rate of answered', pct(o.positiveRateOfAnswered) + '%'],
      [],
      ['Answer totals'],
      ['Strongly Disagree', o.counts[0]],
      ['Disagree', o.counts[1]],
      ['Agree', o.counts[2]],
      ['Strongly Agree', o.counts[3]],
      ['Total answers', o.totalAnswers],
    ].filter(Boolean);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

    // Theme scores
    const themeRows = [
      ['#', 'Theme', 'Questions', 'SD', 'D', 'A', 'SA', 'Positive %', 'Avg / 4'],
    ];
    scores.perTheme.forEach((t) => {
      themeRows.push([
        t.id, t.title, `Q${t.range[0]}–${t.range[1]}`,
        t.counts[0], t.counts[1], t.counts[2], t.counts[3],
        pct(t.positiveRate), Number(t.avgRating.toFixed(2)),
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(themeRows), 'Theme Scores');

    // Questions
    const qRows = [['Q#', 'Theme', 'Question', 'SD', 'D', 'A', 'SA', 'Total', 'Positive %', 'Avg / 4']];
    scores.perQuestion.forEach((q) => {
      qRows.push([
        q.id, q.themeId, q.text,
        q.counts[0], q.counts[1], q.counts[2], q.counts[3],
        q.total, pct(q.positiveRate), Number(q.avgRating.toFixed(2)),
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qRows), 'Questions');

    // Demographics
    const demoRows = [['Field', 'Group', 'Count', 'Share %']];
    Object.values(scores.demographics).forEach((d) => {
      d.options.forEach((opt) => {
        const c = d.counts[opt] || 0;
        demoRows.push([d.label, opt, c, d.total ? pct((c / d.total) * 100) : 0]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(demoRows), 'Demographics');

    // Raw responses (anonymous)
    const header = ['ID', 'Submitted'];
    const flatQ = Scoring.flatQuestions(content);
    flatQ.forEach((q) => header.push('Q' + q.id));
    header.push('Department', 'Length of Service', 'Age', 'Gender', 'Comment');
    const respRows = [header];
    payload.responses.forEach((r) => {
      const row = [r.id, new Date(r.submitted_at).toLocaleString()];
      flatQ.forEach((q) => row.push(Number(r.answers[q.id] ?? r.answers[String(q.id)]) || ''));
      row.push(r.department, r.length_of_service, r.age_band, r.gender, r.comment || '');
      respRows.push(row);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(respRows), 'Responses');

    XLSX.writeFile(wb, `employee-survey-${stamp()}.xlsx`);
  }

  // -------------------------------------------------------------------------
  //  PDF
  // -------------------------------------------------------------------------
  function toPdf(content, payload, scores) {
    if (!window.jspdf || !window.jspdf.jsPDF) return alert('PDF library failed to load.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const o = scores.overall;
    const W = doc.internal.pageSize.getWidth();
    const brand = [13, 125, 114];

    // Header band
    doc.setFillColor(...brand);
    doc.rect(0, 0, W, 70, 'F');
    doc.setTextColor(255);
    doc.setFontSize(18).setFont(undefined, 'bold');
    doc.text('Employee Satisfaction Survey', 40, 34);
    doc.setFontSize(10).setFont(undefined, 'normal');
    doc.text(`Summary report · ${new Date().toLocaleString()}`, 40, 52);

    // KPI line
    doc.setTextColor(20);
    doc.setFontSize(11);
    let y = 100;
    doc.setFont(undefined, 'bold').setFontSize(26).setTextColor(...brand);
    doc.text(`${pct(o.headline)}%`, 40, y);
    doc.setFontSize(10).setTextColor(90).setFont(undefined, 'normal');
    doc.text('Overall satisfaction (Agree + Strongly Agree)', 40, y + 16);
    doc.setFontSize(11).setTextColor(20);
    doc.text(
      `Respondents: ${o.respondents}${payload.headcount ? ' of ' + payload.headcount : ''}     ` +
      `Average rating: ${o.avgRating.toFixed(2)} / 4     ` +
      `Status: ${payload.status}`,
      230, y - 6
    );
    doc.text(`Satisfaction index: ${pct(o.satisfactionIndex)}%`, 230, y + 12);

    // Theme donut "circles" — the client's headline visual.
    let afterDonutsY = y + 36;
    const donutY = y + 44;
    doc.setFontSize(11).setFont(undefined, 'bold').setTextColor(20);
    doc.text('Theme distribution (circles)', 40, donutY - 8);
    doc.setFont(undefined, 'normal');
    const cols = 4;
    const colW = (W - 80) / cols;
    const img = 78;
    scores.perTheme.forEach((t, i) => {
      const png = donutPng(t.counts, 150);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = 40 + col * colW + (colW - img) / 2;
      const cy = donutY + row * (img + 30);
      if (png) doc.addImage(png, 'PNG', cx, cy, img, img);
      doc.setFontSize(8).setTextColor(60);
      const labelX = 40 + col * colW + colW / 2;
      doc.text(`${t.id} · ${pct(t.positiveRate, 0)}%`, labelX, cy + img + 11, { align: 'center' });
      afterDonutsY = cy + img + 24;
    });

    // Theme table
    doc.autoTable({
      startY: afterDonutsY,
      head: [['#', 'Theme', 'Q', 'SD', 'D', 'A', 'SA', 'Positive', 'Avg/4']],
      body: scores.perTheme.map((t) => [
        t.id, t.title, `${t.range[0]}–${t.range[1]}`,
        t.counts[0], t.counts[1], t.counts[2], t.counts[3],
        pct(t.positiveRate) + '%', t.avgRating.toFixed(2),
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: brand },
      columnStyles: { 1: { cellWidth: 200 } },
      margin: { left: 40, right: 40 },
    });

    // Question table
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Q#', 'Question', 'SD', 'D', 'A', 'SA', 'Positive', 'Avg/4']],
      body: scores.perQuestion.map((q) => [
        q.id, q.text, q.counts[0], q.counts[1], q.counts[2], q.counts[3],
        pct(q.positiveRate) + '%', q.avgRating.toFixed(2),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: brand },
      columnStyles: { 1: { cellWidth: 250 } },
      margin: { left: 40, right: 40 },
    });

    // Demographics table
    const demoBody = [];
    Object.values(scores.demographics).forEach((d) => {
      d.options.forEach((opt) => {
        const c = d.counts[opt] || 0;
        if (c > 0) demoBody.push([d.label, opt, c, (d.total ? pct((c / d.total) * 100) : 0) + '%']);
      });
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Field', 'Group', 'Count', 'Share']],
      body: demoBody,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: brand },
      margin: { left: 40, right: 40 },
    });

    // Footer with anonymity note + page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8).setTextColor(140);
      doc.text(
        'Anonymous results — no names, emails or IPs are collected.',
        40, doc.internal.pageSize.getHeight() - 20
      );
      doc.text(`Page ${i} / ${pageCount}`, W - 80, doc.internal.pageSize.getHeight() - 20);
    }

    doc.save(`employee-survey-${stamp()}.pdf`);
  }

  window.Exporter = { toXlsx, toPdf };
})();
