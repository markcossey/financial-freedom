(() => {
  'use strict';

  const MIN_AGE = 55;
  const MAX_AGE = 67;

  const el = (id) => document.getElementById(id);

  const inputs = {
    currentAge: el('currentAge'),
    pensionValue: el('pensionValue'),
    pensionContribution: el('pensionContribution'),
    growthRate: el('growthRate'),
    withdrawalRate: el('withdrawalRate'),
    mortgageBalance: el('mortgageBalance'),
    mortgagePayment: el('mortgagePayment'),
    mortgageRate: el('mortgageRate'),
  };

  const targetAgeSelect = el('targetAge');
  const kpiRow = el('kpiRow');
  const warningsCard = el('warningsCard');
  const warningsText = el('warningsText');
  const pensionChartWrap = el('pensionChartWrap');
  const mortgageChartWrap = el('mortgageChartWrap');
  const pensionTableWrap = el('pensionTable');
  const mortgageTableWrap = el('mortgageTable');
  const breakdownBody = el('breakdownTableBody');

  // ---------- formatting ----------

  const compactCurrency = new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 1,
  });
  const fullCurrency = new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  });
  const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

  function fmtCompact(n) { return compactCurrency.format(Math.max(0, n)); }
  function fmtFull(n) { return fullCurrency.format(Math.max(0, n)); }

  // ---------- finance math ----------

  function monthlyRateFromAnnual(annualPct) {
    return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  }

  // Future value of a pot with regular monthly contributions.
  function projectPension(pv, monthlyContribution, annualGrowthPct, years) {
    const n = Math.max(0, years) * 12;
    const r = monthlyRateFromAnnual(annualGrowthPct);
    if (n === 0) return pv;
    if (Math.abs(r) < 1e-9) return pv + monthlyContribution * n;
    return pv * Math.pow(1 + r, n) + monthlyContribution * ((Math.pow(1 + r, n) - 1) / r);
  }

  // Remaining mortgage balance after t months.
  function mortgageBalanceAt(balance, monthlyPayment, annualRatePct, t) {
    const i = annualRatePct / 100 / 12;
    if (t <= 0) return balance;
    if (Math.abs(i) < 1e-9) return Math.max(0, balance - monthlyPayment * t);
    const grown = balance * Math.pow(1 + i, t) - monthlyPayment * ((Math.pow(1 + i, t) - 1) / i);
    return Math.max(0, grown);
  }

  function mortgagePayoffMonths(balance, monthlyPayment, annualRatePct) {
    if (balance <= 0) return { months: 0, paidOff: true };
    const i = annualRatePct / 100 / 12;
    if (Math.abs(i) < 1e-9) {
      if (monthlyPayment <= 0) return { months: Infinity, neverPaysOff: true };
      return { months: Math.ceil(balance / monthlyPayment) };
    }
    if (monthlyPayment <= balance * i) return { months: Infinity, neverPaysOff: true };
    const months = -Math.log(1 - (balance * i) / monthlyPayment) / Math.log(1 + i);
    return { months: Math.ceil(months) };
  }

  function addMonths(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
    return d;
  }

  // ---------- read inputs ----------

  function readInputs() {
    const num = (elInput, fallback = 0) => {
      const v = parseFloat(elInput.value);
      return Number.isFinite(v) ? v : fallback;
    };
    return {
      currentAge: num(inputs.currentAge, 45),
      pensionValue: Math.max(0, num(inputs.pensionValue, 0)),
      pensionContribution: Math.max(0, num(inputs.pensionContribution, 0)),
      growthRate: num(inputs.growthRate, 0),
      withdrawalRate: Math.max(0, num(inputs.withdrawalRate, 4)),
      mortgageBalance: Math.max(0, num(inputs.mortgageBalance, 0)),
      mortgagePayment: Math.max(0, num(inputs.mortgagePayment, 0)),
      mortgageRate: Math.max(0, num(inputs.mortgageRate, 0)),
    };
  }

  // ---------- age dropdown ----------

  function rebuildAgeOptions(state) {
    const validAges = [];
    for (let age = MIN_AGE; age <= MAX_AGE; age++) {
      if (age > state.currentAge) validAges.push(age);
    }
    const prevValue = parseInt(targetAgeSelect.value, 10);
    targetAgeSelect.innerHTML = '';
    if (validAges.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No valid ages';
      opt.disabled = true;
      targetAgeSelect.appendChild(opt);
      targetAgeSelect.disabled = true;
      return null;
    }
    targetAgeSelect.disabled = false;
    validAges.forEach((age) => {
      const opt = document.createElement('option');
      opt.value = String(age);
      opt.textContent = `Age ${age}`;
      targetAgeSelect.appendChild(opt);
    });
    const keep = validAges.includes(prevValue) ? prevValue : validAges[0];
    targetAgeSelect.value = String(keep);
    return validAges;
  }

  // ---------- stat tiles ----------

  function statTile(label, value, sub) {
    const div = document.createElement('div');
    div.className = 'stat-tile';
    div.innerHTML = `
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    `;
    return div;
  }

  // ---------- SVG line chart ----------

  function renderLineChart(container, opts) {
    const {
      data, xLabel, yLabel, seriesColor, markerIndex, markerColor,
      xTickFormat, yTickFormat, valueTooltipFormat, ariaLabel,
    } = opts;

    container.innerHTML = '';
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No data to show.</p>';
      return;
    }

    const width = 640, height = 320;
    const padL = 56, padR = 24, padT = 20, padB = 36;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMaxRaw = Math.max(...ys, 0);
    const yMax = yMaxRaw === 0 ? 1 : yMaxRaw * 1.15;

    const xScale = (x) => (xMax === xMin ? padL : padL + ((x - xMin) / (xMax - xMin)) * plotW);
    const yScale = (y) => padT + plotH - (y / yMax) * plotH;

    const svgns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', ariaLabel || '');

    // gridlines + y ticks
    const gridSteps = 4;
    for (let s = 0; s <= gridSteps; s++) {
      const yVal = (yMax / gridSteps) * s;
      const y = yScale(yVal);
      const line = document.createElementNS(svgns, 'line');
      line.setAttribute('class', 'gridline');
      line.setAttribute('x1', padL); line.setAttribute('x2', width - padR);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      svg.appendChild(line);

      const text = document.createElementNS(svgns, 'text');
      text.setAttribute('class', 'tick-label');
      text.setAttribute('x', padL - 8);
      text.setAttribute('y', y + 4);
      text.setAttribute('text-anchor', 'end');
      text.textContent = yTickFormat(yVal);
      svg.appendChild(text);
    }

    // baseline
    const baseline = document.createElementNS(svgns, 'line');
    baseline.setAttribute('class', 'baseline');
    baseline.setAttribute('x1', padL); baseline.setAttribute('x2', width - padR);
    baseline.setAttribute('y1', yScale(0)); baseline.setAttribute('y2', yScale(0));
    svg.appendChild(baseline);

    // x ticks: first, last, and marker if present
    const xTickIdxs = new Set([0, data.length - 1]);
    if (markerIndex != null) xTickIdxs.add(markerIndex);
    xTickIdxs.forEach((idx) => {
      const d = data[idx];
      const text = document.createElementNS(svgns, 'text');
      text.setAttribute('class', 'tick-label');
      text.setAttribute('x', xScale(d.x));
      text.setAttribute('y', height - padB + 18);
      text.setAttribute('text-anchor', idx === 0 ? 'start' : idx === data.length - 1 ? 'end' : 'middle');
      text.textContent = xTickFormat(d.x);
      svg.appendChild(text);
    });

    // marker vertical line (selected age, etc.)
    if (markerIndex != null && data[markerIndex]) {
      const mx = xScale(data[markerIndex].x);
      const mline = document.createElementNS(svgns, 'line');
      mline.setAttribute('class', 'marker-line');
      mline.setAttribute('x1', mx); mline.setAttribute('x2', mx);
      mline.setAttribute('y1', padT); mline.setAttribute('y2', yScale(0));
      svg.appendChild(mline);
    }

    // line path
    const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.x)} ${yScale(d.y)}`).join(' ');
    const path = document.createElementNS(svgns, 'path');
    path.setAttribute('class', 'line-path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke', seriesColor);
    svg.appendChild(path);

    // end dot + direct label
    const last = data[data.length - 1];
    const endDot = document.createElementNS(svgns, 'circle');
    endDot.setAttribute('class', 'end-dot');
    endDot.setAttribute('cx', xScale(last.x));
    endDot.setAttribute('cy', yScale(last.y));
    endDot.setAttribute('r', 5);
    endDot.setAttribute('fill', seriesColor);
    svg.appendChild(endDot);

    const endLabel = document.createElementNS(svgns, 'text');
    endLabel.setAttribute('class', 'direct-label');
    endLabel.setAttribute('x', xScale(last.x) - 6);
    endLabel.setAttribute('y', yScale(last.y) - 10);
    endLabel.setAttribute('text-anchor', 'end');
    endLabel.textContent = valueTooltipFormat(last.y);
    svg.appendChild(endLabel);

    // marker dot + label
    if (markerIndex != null && data[markerIndex]) {
      const md = data[markerIndex];
      const mDot = document.createElementNS(svgns, 'circle');
      mDot.setAttribute('class', 'marker-dot');
      mDot.setAttribute('cx', xScale(md.x));
      mDot.setAttribute('cy', yScale(md.y));
      mDot.setAttribute('r', 5.5);
      mDot.setAttribute('fill', markerColor);
      svg.appendChild(mDot);

      if (markerIndex !== data.length - 1) {
        const mLabel = document.createElementNS(svgns, 'text');
        mLabel.setAttribute('class', 'direct-label');
        mLabel.setAttribute('x', xScale(md.x) + 8);
        mLabel.setAttribute('y', yScale(md.y) - 10);
        mLabel.setAttribute('text-anchor', 'start');
        mLabel.textContent = valueTooltipFormat(md.y);
        svg.appendChild(mLabel);
      }
    }

    // hover layer
    const hoverRect = document.createElementNS(svgns, 'rect');
    hoverRect.setAttribute('class', 'chart-hover-target');
    hoverRect.setAttribute('x', padL); hoverRect.setAttribute('y', padT);
    hoverRect.setAttribute('width', plotW); hoverRect.setAttribute('height', plotH);
    hoverRect.setAttribute('fill', 'transparent');
    svg.appendChild(hoverRect);

    const crosshair = document.createElementNS(svgns, 'line');
    crosshair.setAttribute('class', 'marker-line');
    crosshair.setAttribute('y1', padT); crosshair.setAttribute('y2', yScale(0));
    crosshair.style.opacity = '0';
    svg.appendChild(crosshair);

    const hoverDot = document.createElementNS(svgns, 'circle');
    hoverDot.setAttribute('r', 5);
    hoverDot.setAttribute('fill', seriesColor);
    hoverDot.setAttribute('class', 'marker-dot');
    hoverDot.style.opacity = '0';
    svg.appendChild(hoverDot);

    container.style.position = 'relative';
    container.appendChild(svg);

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.appendChild(tooltip);

    hoverRect.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      let closest = 0, closestDist = Infinity;
      data.forEach((d, i) => {
        const dist = Math.abs(xScale(d.x) - mouseX);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      });
      const d = data[closest];
      const cx = xScale(d.x), cy = yScale(d.y);
      crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx);
      crosshair.style.opacity = '1';
      hoverDot.setAttribute('cx', cx); hoverDot.setAttribute('cy', cy);
      hoverDot.style.opacity = '1';

      const scaleRatio = rect.width / width;
      tooltip.style.left = `${cx * scaleRatio}px`;
      tooltip.style.top = `${cy * scaleRatio - 36}px`;
      tooltip.textContent = `${xTickFormat(d.x)}: ${valueTooltipFormat(d.y)}`;
      tooltip.style.opacity = '1';
    });
    hoverRect.addEventListener('mouseleave', () => {
      crosshair.style.opacity = '0';
      hoverDot.style.opacity = '0';
      tooltip.style.opacity = '0';
    });
  }

  function renderTableView(container, columns, rows) {
    container.innerHTML = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach((c) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      columns.forEach((c) => {
        const td = document.createElement('td');
        td.textContent = row[c.key];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ---------- wire up table toggles ----------

  document.querySelectorAll('.table-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const target = el(targetId);
      const chartWrap = target.previousElementSibling;
      const showingTable = !target.hidden;
      target.hidden = showingTable;
      chartWrap.hidden = !showingTable;
      btn.textContent = showingTable ? 'Table view' : 'Chart view';
    });
  });

  // ---------- main compute + render ----------

  function render() {
    const state = readInputs();
    const validAges = rebuildAgeOptions(state);

    const warnings = [];

    // ---- pension series across 55-67 ----
    const pensionSeries = [];
    for (let age = MIN_AGE; age <= MAX_AGE; age++) {
      const years = age - state.currentAge;
      if (years < 0) continue;
      const pot = projectPension(state.pensionValue, state.pensionContribution, state.growthRate, years);
      const annualIncome = pot * (state.withdrawalRate / 100);
      pensionSeries.push({
        age, years, pot,
        annualIncome, monthlyIncome: annualIncome / 12,
      });
    }

    const selectedAge = validAges ? parseInt(targetAgeSelect.value, 10) : null;
    const selectedEntry = pensionSeries.find((d) => d.age === selectedAge);
    const markerIndex = selectedEntry ? pensionSeries.indexOf(selectedEntry) : null;

    // ---- mortgage ----
    const payoff = mortgagePayoffMonths(state.mortgageBalance, state.mortgagePayment, state.mortgageRate);
    let mortgageSeries = [];
    if (state.mortgageBalance <= 0) {
      mortgageSeries = [{ x: 0, y: 0 }];
    } else if (payoff.neverPaysOff) {
      warnings.push('Your monthly mortgage repayment does not cover the interest charged, so at this rate the balance will never clear. Increase the repayment or check the interest rate.');
      // show 10 years of a flat/rising balance as context
      for (let y = 0; y <= 10; y++) {
        mortgageSeries.push({ x: y, y: mortgageBalanceGrowingForever(state, y) });
      }
    } else {
      const totalMonths = payoff.months;
      const totalYears = Math.ceil(totalMonths / 12);
      for (let y = 0; y <= totalYears; y++) {
        const t = Math.min(y * 12, totalMonths);
        const bal = t >= totalMonths ? 0 : mortgageBalanceAt(state.mortgageBalance, state.mortgagePayment, state.mortgageRate, t);
        mortgageSeries.push({ x: y, y: bal });
        if (t >= totalMonths) break;
      }
    }

    // ---- KPI tiles ----
    kpiRow.innerHTML = '';
    if (selectedEntry) {
      kpiRow.appendChild(statTile(
        `Projected pot at age ${selectedAge}`,
        fmtCompact(selectedEntry.pot),
        `in ${selectedEntry.years} year${selectedEntry.years === 1 ? '' : 's'}, at ${state.growthRate}% growth`
      ));
      kpiRow.appendChild(statTile(
        'Sustainable annual income',
        fmtCompact(selectedEntry.annualIncome),
        `${state.withdrawalRate}% of the pot`
      ));
      kpiRow.appendChild(statTile(
        'Sustainable monthly income',
        fmtCompact(selectedEntry.monthlyIncome)
      ));
    } else {
      kpiRow.appendChild(statTile('Projected pot', '—', 'Set a current age below 67 to see a projection'));
    }

    if (state.mortgageBalance <= 0) {
      kpiRow.appendChild(statTile('Mortgage', 'Paid off', 'No balance remaining'));
    } else if (payoff.neverPaysOff) {
      kpiRow.appendChild(statTile('Mortgage payoff', 'Never', 'Repayment does not cover interest'));
    } else {
      const payoffDate = addMonths(new Date(), payoff.months);
      const years = Math.floor(payoff.months / 12);
      const months = payoff.months % 12;
      kpiRow.appendChild(statTile(
        'Mortgage paid off',
        monthYear.format(payoffDate),
        `${years}y ${months}m from now`
      ));
    }

    // ---- warnings ----
    if (warnings.length) {
      warningsText.textContent = warnings.join(' ');
      warningsCard.hidden = false;
    } else {
      warningsCard.hidden = true;
    }

    // ---- pension chart ----
    renderLineChart(pensionChartWrap, {
      data: pensionSeries.map((d) => ({ x: d.age, y: d.pot })),
      seriesColor: 'var(--series-pension)',
      markerIndex,
      markerColor: 'var(--series-accent)',
      xTickFormat: (x) => `Age ${x}`,
      yTickFormat: (y) => fmtCompact(y),
      valueTooltipFormat: (y) => fmtCompact(y),
      ariaLabel: 'Projected pension pot value by access age',
    });
    renderTableView(pensionTableWrap,
      [{ key: 'age', label: 'Age' }, { key: 'pot', label: 'Projected pot' }],
      pensionSeries.map((d) => ({ age: `Age ${d.age}`, pot: fmtFull(d.pot) }))
    );

    // ---- mortgage chart ----
    if (state.mortgageBalance <= 0) {
      mortgageChartWrap.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">Your mortgage is already paid off.</p>';
    } else {
      renderLineChart(mortgageChartWrap, {
        data: mortgageSeries,
        seriesColor: 'var(--series-mortgage)',
        markerIndex: null,
        xTickFormat: (x) => `Yr ${x}`,
        yTickFormat: (y) => fmtCompact(y),
        valueTooltipFormat: (y) => fmtCompact(y),
        ariaLabel: 'Mortgage balance over time',
      });
    }
    renderTableView(mortgageTableWrap,
      [{ key: 'year', label: 'Years from now' }, { key: 'balance', label: 'Balance' }],
      mortgageSeries.map((d) => ({ year: `Yr ${d.x}`, balance: fmtFull(d.y) }))
    );

    // ---- breakdown table ----
    breakdownBody.innerHTML = '';
    pensionSeries.forEach((d) => {
      const tr = document.createElement('tr');
      if (d.age === selectedAge) tr.className = 'selected-row';
      tr.innerHTML = `
        <td>Age ${d.age}</td>
        <td>${d.years}</td>
        <td>${fmtFull(d.pot)}</td>
        <td>${fmtFull(d.annualIncome)}</td>
        <td>${fmtFull(d.monthlyIncome)}</td>
      `;
      breakdownBody.appendChild(tr);
    });
  }

  function mortgageBalanceGrowingForever(state, years) {
    const i = state.mortgageRate / 100 / 12;
    const t = years * 12;
    return state.mortgageBalance * Math.pow(1 + i, t) - state.mortgagePayment * ((Math.pow(1 + i, t) - 1) / i);
  }

  Object.values(inputs).forEach((input) => input.addEventListener('input', render));
  targetAgeSelect.addEventListener('change', render);
  inputs.currentAge.addEventListener('input', () => { rebuildAgeOptions(readInputs()); render(); });

  render();
})();
