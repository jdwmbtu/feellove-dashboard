const API_KEY = 'AIzaSyAbqqoWEYouY2nlLojZIXR1MFo7C0s-gQY';
const SPREADSHEET_ID = '1whPL4X-I815XVKbeFDxEHbhHbddUtb1XwsSE7MUaWYo';
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const CURRENT_DATE = new Date();
const storeColumns = { CAFE: 3, FEELLOVE: 4, SNOW: 5, ZION: 6 };

let netsalesData = null;
let ordersData = null;
let growthTarget = 20;
let growthType = 'number';
const CURRENT_YEAR = CURRENT_DATE.getFullYear();        // 2026
const LAST_YEAR = CURRENT_YEAR - 1;                      // CURRENT_YEAR
let isAdjusted = true;
let lastModifiedTime = null;
let currentMetricsSubView = 'sales';  // Default sub-view
let totalStaffingHours = 0;   // will be set by loadTodaySchedule
let nextDayPredictedSales = 0;   // will hold the first day sales from 7-day table

// Helper: format date as YYYY-MM-DD in local timezone (avoids UTC shift)
function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/* -------------------------------------------------------------
   INITIAL LOAD
   ------------------------------------------------------------- */
function initClient() {
    gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(() => loadSheetsData())
            .then(refreshed => {
                if (refreshed) populateMonthDropdown();
                updateTables();
            })
            .catch(err => {
                console.error('Init error:', err);
                setStatus('Init error');
            });
    });
}

/* -------------------------------------------------------------
   FETCH DATA + VERSION CHECK
   ------------------------------------------------------------- */
async function loadSheetsData() {
    try {
        const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const modified = meta.result.modifiedTime;

        if (lastModifiedTime && lastModifiedTime === modified) {
            setStatus('Data up-to-date (cached)');
            return false;
        }

        const netResp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Net Sales!A2:G'
        });
        netsalesData = netResp.result.values || [];

        const ordResp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Orders!A2:G'
        });
        ordersData = ordResp.result.values || [];

        lastModifiedTime = modified;

        // Show last non-zero data date
        const lastDate = getLastDataDate(
            document.getElementById('store-filter')?.value || 'CAFE',
            document.getElementById('month-filter')?.value || ''
        );
        const dateStr = lastDate
            ? lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'unknown';
        setStatus(`Updated with fresh data through ${dateStr}`);

        // Update counts
        const countEls = ['netsales-count', 'orders-count', 'aov-count', 'daycount-count', 'forecast-count'];
        countEls.forEach(id => {
            const el = document.getElementById(id);
        });

        return true;
    } catch (e) {
        console.error('loadSheetsData error:', e);
        setStatus('Error loading data');
        return false;
    }
}

/* -------------------------------------------------------------
   Helper – set status in controls table
   ------------------------------------------------------------- */
function setStatus(txt) {
    const cell = document.getElementById('status-cell');
    if (cell) cell.innerText = txt;
}

/* -------------------------------------------------------------
   HELPER – most recent non-zero date
   ------------------------------------------------------------- */
function getLastDataDate(store, month) {
    const idx = storeColumns[store];
    let last = null;

    if (!netsalesData) return null;

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;
        if (month && d.toLocaleString('en-US', { month: 'long' }) !== month) return;

        const v = row[idx];
        if (!v || v.toString().trim() === '') return;
        const num = parseFloat(v.toString().replace(/[^0-9.-]+/g, '')) || 0;
        if (num === 0) return;

        if (!last || d > last) last = d;
    });
    return last;
}

/* -------------------------------------------------------------
   MONTH DROPDOWN – CHRONOLOGICAL ORDER
   ------------------------------------------------------------- */
function populateMonthDropdown() {
    const monthOrder = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const seen = new Set();

    if (!netsalesData) return;

    // Collect unique months from data
    netsalesData.forEach(r => {
        const d = new Date(r[2]);
        if (isNaN(d) || d > CURRENT_DATE) return;
        const m = d.toLocaleString('en-US', { month: 'long' });
        seen.add(m);
    });

    // Sort by monthOrder
    const months = Array.from(seen).sort((a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b));

    const sel = document.getElementById('month-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All Months</option>';
    months.forEach(m => sel.innerHTML += `<option value="${m}">${m}</option>`);
}

/* -------------------------------------------------------------
   GROWTH TARGET
   ------------------------------------------------------------- */
function updateGrowthTarget() {
    const valSel = document.getElementById('growth-target');
    if (!valSel) return;

    const selected = valSel.options[valSel.selectedIndex];
    const value = selected.value;
    const text = selected.textContent.trim();

    if (text.includes('$') || text.includes('K')) {
        growthType = 'dollar';
        growthTarget = parseFloat(value.replace('K', ''));
    } else {
        growthType = 'percent';
        growthTarget = parseFloat(value);
    }

}
/* -------------------------------------------------------------
   UPDATE FORECAST BUTTON
   ------------------------------------------------------------- */
async function refreshAndUpdateForecast() {
    const month = document.getElementById('month-filter')?.value;
    const store = document.getElementById('store-filter')?.value;

    if (!month || !store) {
        alert('Select Month and Store first');
        return;
    }

    setStatus('Checking for updates...');
    const refreshed = await loadSheetsData();

    if (refreshed) {
        populateMonthDropdown();
        document.getElementById('month-filter').value = month;
        document.getElementById('store-filter').value = store;
        updateGrowthTarget();
    }

    updateTables();
    setStatus(refreshed ? 'Updated with fresh data' : 'No changes – used cache');
}

/* -------------------------------------------------------------
   MAIN UPDATE
   ------------------------------------------------------------- */
function updateTables() {
    const month = document.getElementById('month-filter')?.value || '';
    const store = document.getElementById('store-filter')?.value || 'CAFE';
    isAdjusted = document.getElementById('adjusted-toggle')?.checked || false;

    const avgs = calculateAverages(store, month);
    updateCombinedMetricsTable(store, month);
    updateSevenDayPredictionTable(store, month);  // NEW
    updateDayCountTable(store, month);
    updateForecastTable(store, month);
    updateScenariosTable(store, month);
    updateSummaryTable(store, month);
// Refresh current chart if active
if (window.currentChart) {
    const activeSection = window.activeSection || 'metrics-h2';
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSection(activeSection);
}
// Refresh Next Day view if active
if (window.activeView === 'next-day') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('next-day');
}
// Refresh MTD Growth view if active
if (window.activeView === 'mtd-growth') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('mtd-growth');
}
// Refresh Remaining Target view if active
if (window.activeView === 'remaining-target') {
    const container = document.getElementById('chart-container');
    if (container) container.innerHTML = ''; // Clear old content
    updateChartForSummaryRow('remaining-target');
}

}

/* -------------------------------------------------------------
   AVERAGE CALCULATION
   ------------------------------------------------------------- */
function calculateAverages(store, month) {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const s24 = {}, s25 = {}, o24 = {}, o25 = {};
    days.forEach(d => { s24[d]=[]; s25[d]=[]; o24[d]=[]; o25[d]=[]; });

    // Guard against null data (not yet loaded)
    if (!netsalesData || !ordersData) {
        return { s24, s25, o24, o25 };
    }

    for (let i = 0; i < netsalesData.length && i < ordersData.length; i++) {
        const sRow = netsalesData[i];
        const oRow = ordersData[i];
        const dt = new Date(sRow[2]);
        if (isNaN(dt)) continue;

        const m = dt.toLocaleString('en-US', { month: 'long' });
        const y = dt.getFullYear();
        const salesVal = sRow[storeColumns[store]];
        const orderVal = oRow[storeColumns[store]];

        if (!salesVal || !orderVal) continue;
        const sales = typeof salesVal === 'string' ? parseFloat(salesVal.replace(/[^0-9.-]+/g,'')) || 0 : salesVal;
        const orders = parseFloat(orderVal) || 0;
        if (isNaN(sales) || isNaN(orders)) continue;

        if (!month || m === month) {
            const day = sRow[0];
                    const y = dt.getFullYear();
        if (y === LAST_YEAR) { s24[day].push(sales); o24[day].push(orders); }
        else if (y === CURRENT_YEAR) { s25[day].push(sales); o25[day].push(orders); }
        }
    }
    return { 
        salesAveragesLastYear: s24, 
        salesAveragesCurrentYear: s25, 
        ordersAveragesLastYear: o24, 
        ordersAveragesCurrentYear: o25 
    };
}

/* -------------------------------------------------------------
   7-DAY PREDICTION TABLE – VERTICAL (7 ROWS)
   ------------------------------------------------------------- */
function updateSevenDayPredictionTable(store, month) {
    const container = document.getElementById('seven-day-prediction-container');
    if (!container) return;

    const tbody = container.querySelector('tbody');
    tbody.innerHTML = '';

    // Find last non-zero day (sales or orders)
    let lastNonZeroDate = null;
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;

        const sales = parseFloat(row[storeColumns[store]]) || 0;
        const orderRow = ordersData.find(o => new Date(o[2]).getTime() === d.getTime());
        const orders = orderRow ? parseFloat(orderRow[storeColumns[store]]) || 0 : 0;

        if (sales > 0 || orders > 0) {
            if (!lastNonZeroDate || d > lastNonZeroDate) {
                lastNonZeroDate = d;
            }
        }
    });

    // Start from next day after last non-zero
    const startDate = lastNonZeroDate ? new Date(lastNonZeroDate) : new Date();
    startDate.setDate(startDate.getDate() + 1);

    // Build 7 days
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        days.push(d);
    }

    // Header row
    tbody.innerHTML += '<tr><th>Date</th><th style="text-align:right;">Net Sales</th><th style="text-align:right;">Orders</th></tr>';

    // One row per day
    days.forEach((d, i) => {
        const dateStr = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const salesId = `pred-sales-${i}`;
        const ordersId = `pred-orders-${i}`;
        tbody.innerHTML += `<tr>
            <td style="font-weight:bold;">${dateStr}</td>
            <td id="${salesId}" style="text-align:right;">—</td>
            <td id="${ordersId}" style="text-align:right;">—</td>
        </tr>`;
    });

    // Store dates for algo
    window.predictionDates = days;

    // === PREDICT ORDERS ===
    const dayAverages = {};
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    daysOfWeek.forEach(d => dayAverages[d] = { past3: [], lastYear: 0 });

    ordersData.forEach(row => {
        const d = new Date(row[2]);
        if (d >= startDate) return;
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const orders = parseFloat(row[storeColumns[store]]) || 0;
        if (orders > 0) {
            dayAverages[dayName].past3.push(orders);
        }
    });

    const targetWeekStart = new Date(startDate);
    targetWeekStart.setDate(targetWeekStart.getDate() - 7);
    const lastYearWeek = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(targetWeekStart);
        d.setDate(d.getDate() + i);
        const row = ordersData.find(r => {
            const rd = new Date(r[2]);
            return rd.getFullYear() === LAST_YEAR && rd.getTime() === d.getTime();
        });
        lastYearWeek.push(row ? parseFloat(row[storeColumns[store]]) || 0 : 0);
    }
    const lastYearWeekAvg = lastYearWeek.length > 0 ? lastYearWeek.reduce((a, b) => a + b, 0) / lastYearWeek.length : 1;

    days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const past3 = dayAverages[dayName].past3.slice(-3);
        const avgPast3 = past3.length > 0 ? past3.reduce((a, b) => a + b, 0) / past3.length : 0;
        const lastYearDay = lastYearWeek[i] || avgPast3;
        const shape = lastYearWeekAvg > 0 ? lastYearDay / lastYearWeekAvg : 1;
        const predicted = Math.round(avgPast3 * shape);
        document.getElementById(`pred-orders-${i}`).textContent = predicted;
    });

    // === PREDICT NET SALES USING DAILY AOV ===
    const avgs = calculateAverages(store, month);
    const dayAOV = {};
    daysOfWeek.forEach(dayName => {
        const o25 = avgs.ordersAveragesCurrentYear[dayName].length ? Math.round(avgs.ordersAveragesCurrentYear[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAveragesCurrentYear[dayName].length) : 0;
        const s25 = avgs.salesAveragesCurrentYear[dayName].length ? Math.round(avgs.salesAveragesCurrentYear[dayName].reduce((a,b)=>a+b,0)/avgs.salesAveragesCurrentYear[dayName].length) : 0;
        const o24 = avgs.ordersAveragesLastYear[dayName].length ? Math.round(avgs.ordersAveragesLastYear[dayName].reduce((a,b)=>a+b,0)/avgs.ordersAveragesLastYear[dayName].length) : 0;
        const s24 = avgs.salesAveragesLastYear[dayName].length ? Math.round(avgs.salesAveragesLastYear[dayName].reduce((a,b)=>a+b,0)/avgs.salesAveragesLastYear[dayName].length) : 0;
        const aov25 = o25 > 0 ? s25 / o25 : 0;
        const aov24 = o24 > 0 ? s24 / o24 : 0;
        dayAOV[dayName] = o25 > 0 ? aov25 : aov24;
    });

days.forEach((d, i) => {
        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const aov = dayAOV[dayName] || 0;
        const predictedOrders = parseInt(document.getElementById(`pred-orders-${i}`).textContent) || 0;
        const predictedSales = Math.round(predictedOrders * aov);
        document.getElementById(`pred-sales-${i}`).textContent = formatNumber(predictedSales);

        // Save the first day's (i === 0) predicted sales for Summary table
        if (i === 0) {
            nextDayPredictedSales = predictedSales;
        }
    });
}


/* -------------------------------------------------------------
   COMBINED METRICS TABLE
   ------------------------------------------------------------- */
function updateCombinedMetricsTable(store, month) {
    const avgs = calculateAverages(store, month);
    const tbody = document.getElementById('metrics-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    days.forEach(d => {
        const s24 = avgs.salesAveragesLastYear[d].length ? Math.round(avgs.salesAveragesLastYear[d].reduce((a,b)=>a+b,0)/avgs.salesAveragesLastYear[d].length) : 0;
        const s25 = avgs.salesAveragesCurrentYear[d].length ? Math.round(avgs.salesAveragesCurrentYear[d].reduce((a,b)=>a+b,0)/avgs.salesAveragesCurrentYear[d].length) : 0;
        const o24 = avgs.ordersAveragesLastYear[d].length ? Math.round(avgs.ordersAveragesLastYear[d].reduce((a,b)=>a+b,0)/avgs.ordersAveragesLastYear[d].length) : 0;
        const o25 = avgs.ordersAveragesCurrentYear[d].length ? Math.round(avgs.ordersAveragesCurrentYear[d].reduce((a,b)=>a+b,0)/avgs.ordersAveragesCurrentYear[d].length) : 0;
        const aov24 = o24 > 0 ? s24 / o24 : 0;
        const aov25 = o25 > 0 ? s25 / o25 : 0;

        const deltaSales = s25 - s24;
        const pctSales = s24 > 0 ? (deltaSales / s24) * 100 : (s25 > 0 ? '∞' : 0);
        const deltaOrders = o25 - o24;
        const pctOrders = o24 > 0 ? (deltaOrders / o24) * 100 : (o25 > 0 ? '∞' : 0);
        const deltaAOV = aov25 - aov24;
        const pctAOV = aov24 > 0 ? (deltaAOV / aov24) * 100 : (aov25 > 0 ? '∞' : 0);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${d}</td>
            <td>${formatNumber(s24)}</td>
            <td>${formatNumber(s25)}</td>
            <td>${formatNumber(deltaSales)}</td>
            <td>${formatPercent(pctSales)}</td>
            <td>${o24}</td>
            <td>${o25}</td>
            <td>${deltaOrders}</td>
            <td>${formatPercent(pctOrders)}</td>
            <td>${formatNumber(aov24, true)}</td>
            <td>${formatNumber(aov25, true)}</td>
            <td>${formatNumber(deltaAOV, true)}</td>
            <td>${formatPercent(pctAOV)}</td>
        `;
        tbody.appendChild(row);
    });
         // === SUMMARY ROWS ===
    let totalSales24 = 0, totalOrders24 = 0, totalSales25 = 0, totalOrders25 = 0;

    days.forEach(d => {
        const s24 = avgs.salesAveragesLastYear[d].length ? Math.round(avgs.salesAveragesLastYear[d].reduce((a,b)=>a+b,0)/avgs.salesAveragesLastYear[d].length) : 0;
        const o24 = avgs.ordersAveragesLastYear[d].length ? Math.round(avgs.ordersAveragesLastYear[d].reduce((a,b)=>a+b,0)/avgs.ordersAveragesLastYear[d].length) : 0;
        const s25 = avgs.salesAveragesCurrentYear[d].length ? Math.round(avgs.salesAveragesCurrentYear[d].reduce((a,b)=>a+b,0)/avgs.salesAveragesCurrentYear[d].length) : 0;
        const o25 = avgs.ordersAveragesCurrentYear[d].length ? Math.round(avgs.ordersAveragesCurrentYear[d].reduce((a,b)=>a+b,0)/avgs.ordersAveragesCurrentYear[d].length) : 0;

        totalSales24 += s24;
        totalOrders24 += o24;
        totalSales25 += s25;
        totalOrders25 += o25;
    });

    const avgAOV24 = totalOrders24 > 0 ? totalSales24 / totalOrders24 : 0;
    const avgAOV25 = totalOrders25 > 0 ? totalSales25 / totalOrders25 : 0;

    // NEW: Check if all 7 days have data (at least one entry in LAST_YEAR or CURRENT_YEAR averages for this month)
    const hasFullWeekData = days.every(d => 
         avgs.salesAveragesCurrentYear[d].length > 0
    );

    if (hasFullWeekData) {
        const summaryRow = document.createElement('tr');
        summaryRow.style.fontWeight = 'bold';
        summaryRow.style.backgroundColor = '#f0f0f0';
        summaryRow.innerHTML = `
            <td><strong>Weekly</strong></td>
            <td>${formatNumber(totalSales24)}</td>
            <td>${formatNumber(totalSales25)}</td>
            <td>${formatNumber(totalSales25 - totalSales24)}</td>
            <td>${formatPercent(totalSales24 > 0 ? ((totalSales25 - totalSales24) / totalSales24) * 100 : 0)}</td>
            <td>${totalOrders24}</td>
            <td>${totalOrders25}</td>
            <td>${totalOrders25 - totalOrders24}</td>
            <td>${formatPercent(totalOrders24 > 0 ? ((totalOrders25 - totalOrders24) / totalOrders24) * 100 : 0)}</td>
            <td>${formatNumber(avgAOV24, true)}</td>
            <td>${formatNumber(avgAOV25, true)}</td>
            <td>${formatNumber(avgAOV25 - avgAOV24, true)}</td>
            <td>${formatPercent(avgAOV24 > 0 ? ((avgAOV25 - avgAOV24) / avgAOV24) * 100 : 0)}</td>
        `;
        tbody.appendChild(summaryRow);
    }


     // === MONTHLY TOTALS ROW ===
    const data = calculateSalesData(store, month);
    const shift = isAdjusted ? 1 : 0;
    const monthlySales24 = data.mtdLastYear;
    const monthlySales25 = data.mtdCurrentYear;

    // SAME EXACT LOGIC AS NET SALES MTD — BUT FOR ORDERS
    const monthlyOrders24 = ordersData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== LAST_YEAR || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const day = d.getDate();
        if (day < (1 + shift) || day > (data.elapsedDays + shift)) return s;
        const v = r[storeColumns[store]];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const monthlyOrders25 = ordersData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== CURRENT_YEAR || d > data.lastCurrentYear || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const v = r[storeColumns[store]];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const monthlyAOV24 = monthlyOrders24 > 0 ? monthlySales24 / monthlyOrders24 : 0;
    const monthlyAOV25 = monthlyOrders25 > 0 ? monthlySales25 / monthlyOrders25 : 0;

    const monthlyRow = document.createElement('tr');
    monthlyRow.style.fontWeight = 'bold';
    monthlyRow.style.backgroundColor = '#e6e6e6';
    monthlyRow.innerHTML = `
        <td><strong>Month to Date</strong></td>
        <td>${formatNumber(monthlySales24)}</td>
        <td>${formatNumber(monthlySales25)}</td>
        <td>${formatNumber(monthlySales25 - monthlySales24)}</td>
        <td>${formatPercent(monthlySales24 > 0 ? ((monthlySales25 - monthlySales24) / monthlySales24) * 100 : 0)}</td>
        <td>${monthlyOrders24}</td>
        <td>${monthlyOrders25}</td>
        <td>${monthlyOrders25 - monthlyOrders24}</td>
        <td>${formatPercent(monthlyOrders24 > 0 ? ((monthlyOrders25 - monthlyOrders24) / monthlyOrders24) * 100 : 0)}</td>
        <td>${formatNumber(monthlyAOV24, true)}</td>
        <td>${formatNumber(monthlyAOV25, true)}</td>
        <td>${formatNumber(monthlyAOV25 - monthlyAOV24, true)}</td>
        <td>${formatPercent(monthlyAOV24 > 0 ? ((monthlyAOV25 - monthlyAOV24) / monthlyAOV24) * 100 : 0)}</td>
    `;
    tbody.appendChild(monthlyRow);
}


/* -------------------------------------------------------------
   DAY COUNT TABLE
   ------------------------------------------------------------- */
function updateDayCountTable(store, month) {
    const tbody = document.getElementById('daycount-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const categories = ['Weekdays', 'Weekends'];
    const lastYear = { Weekdays: 0, Weekends: 0 };
    const currentElapsed = { Weekdays: 0, Weekends: 0 };
    const currentRemaining = { Weekdays: 0, Weekends: 0 };

    let lastRecordedDate = null;

    // Count LAST_YEAR and CURRENT_YEAR data
    netsalesData.forEach(row => {
        const date = new Date(row[2]);
        if (isNaN(date)) return;

        const rowMonth = date.toLocaleString('en-US', { month: 'long' });
        if (month && rowMonth !== month) return;

        const value = row[storeColumns[store]];
        if (!value || value.toString().trim() === '') return;

        const year = date.getFullYear();
        const dayIndex = date.getDay();

        if (year === LAST_YEAR) {
            if (dayIndex >= 1 && dayIndex <= 5) lastYear.Weekdays++;
            else lastYear.Weekends++;
        } else if (year === CURRENT_YEAR) {
            if (dayIndex >= 1 && dayIndex <= 5) currentElapsed.Weekdays++;
            else currentElapsed.Weekends++;

            if (!lastRecordedDate || date > lastRecordedDate) lastRecordedDate = date;
        }
    });

    // For future months: no CURRENT_YEAR data → elapsed = 0, remaining = full month
    if (month && !lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();

        for (let d = 1; d <= lastDayOfMonth; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) currentRemaining.Weekdays++;
            else currentRemaining.Weekends++;
        }
    } else if (month && lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();

        for (let d = lastRecordedDate.getDate() + 1; d <= lastDayOfMonth; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) currentRemaining.Weekdays++;
            else currentRemaining.Weekends++;
        }
    }

    categories.forEach(cat => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${cat}</td>
            <td>${lastYear[cat] || 0}</td>
            <td>${currentElapsed[cat] || 0}</td>
            <td>${currentRemaining[cat] || 0}</td>
        `;
        tbody.appendChild(row);
    });

    const totalLast = lastYear.Weekdays + lastYear.Weekends;
    const totalElapsed = currentElapsed.Weekdays + currentElapsed.Weekends;
    const totalRemaining = currentRemaining.Weekdays + currentRemaining.Weekends;
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = 'bold';
    totalRow.innerHTML = `
        <td><strong>Total</strong></td>
        <td><strong>${totalLast}</strong></td>
        <td><strong>${totalElapsed}</strong></td>
        <td><strong>${totalRemaining}</strong></td>
    `;
    tbody.appendChild(totalRow);
}

/* -------------------------------------------------------------
   SIMPLE FORECAST
   ------------------------------------------------------------- */
function updateForecastTable(store, month) {
    const tbody = document.getElementById('forecast-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const data = calculateSalesData(store, month);

const rows = [
    { label: `${month} ${LAST_YEAR}`, mtd: data.mtdLastYear, rom: data.romLastYear },
    { label: `Growth Target ${growthTarget}${growthType === 'dollar' ? 'K' : '%'}`, mtd: data.mtdTarget, rom: data.romTarget },
    { label: `${month} ${CURRENT_YEAR}`, mtd: data.mtdCurrentYear, rom: data.romCurrentYear }
];

    rows.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${r.label}</td>
            <td>${formatNumber(r.mtd)}</td>
            <td>${r.rom === 0 ? '—' : formatNumber(r.rom)}</td>
        `;
        tbody.appendChild(row);
    });
}
/* -------------------------------------------------------------
   SCENARIOS TABLE
   ------------------------------------------------------------- */
function updateScenariosTable(store, month) {
    const tbody = document.getElementById('scenarios-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const data = calculateSalesData(store, month);
    const mtdCurrentYear = data.mtdCurrentYear;
    const overallTarget = data.mtdTarget + data.romTarget;

    const mtdGrowthPct = data.mtdLastYear > 0 ? ((data.mtdCurrentYear / data.mtdLastYear) - 1) * 100 : 0;

const scenarios = [
    { label: `${month} ${LAST_YEAR} Repeats`, rom: data.romLastYear },
    { label: `${month} ${CURRENT_YEAR} at ${growthTarget}${growthType === 'dollar' ? 'K' : '%'} Growth Rate`, rom: data.romTarget },
    { label: `${month} ${CURRENT_YEAR} at Current Rate ${formatPercent(mtdGrowthPct)}`, rom: data.romCurrentYear }
];

    // MTD merged row
    const mtdRow = document.createElement('tr');
    mtdRow.innerHTML = `
        <td rowspan="${scenarios.length+1}" style="vertical-align: middle; text-align: center; font-weight: bold;">
            ${formatNumber(mtdCurrentYear)}
        </td>
    `;
    tbody.appendChild(mtdRow);

    // Scenario rows
    scenarios.forEach(scenario => {
        const total = mtdCurrentYear + scenario.rom;
        const diff = total - overallTarget;
        const color = diff >= 0 ? 'green' : 'red';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${scenario.label}</td>
            <td style="text-align:right;">${formatNumber(scenario.rom)}</td>
            <td style="text-align:right; color:${color};">${formatNumber(total)}</td>
            <td style="text-align:right; color:${color};">${diff >= 0 ? '+' : ''}${formatNumber(diff)}</td>
        `;
        tbody.appendChild(row);
    });
}

/* -------------------------------------------------------------
   CALCULATE SALES DATA
   ------------------------------------------------------------- */
function calculateSalesData(store, month) {
    const idx = storeColumns[store];
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
    const shift = isAdjusted ? 1 : 0;

    const now = new Date();
    const lastDayCURRENT_YEAR = new Date(CURRENT_YEAR, monthIndex + 1, 0);
    const monthEnded = now > lastDayCURRENT_YEAR;

    let lastCurrentYear = null;
    let mtdCurrentYear = 0;
    let isMonthStarted = false;

    // Guard against null data
    if (!netsalesData) {
        return {
            mtdCurrentYear: 0, mtdLastYear: 0, mtdTarget: 0,
            romLastYear: 0, romTarget: 0, daysElapsed: 0, daysRemaining: totalDays
        };
    }

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d) || d.getFullYear() !== CURRENT_YEAR || d.toLocaleString('en-US',{month:'long'}) !== month) return;
        const v = row[idx];
        if (!v || v.toString().trim() === '') return;

        isMonthStarted = true;
        mtdCurrentYear += parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0);
        if (!lastCurrentYear || d > lastCurrentYear) lastCurrentYear = d;
    });

    // Allow future months in CURRENT_YEAR to show target
    if (!isMonthStarted && monthIndex >= CURRENT_DATE.getMonth() && CURRENT_DATE.getFullYear() === CURRENT_YEAR) {
        isMonthStarted = true;
        mtdCurrentYear = 0;
        lastCurrentYear = null; // no data → first day of month
    }

    if (!isMonthStarted) {
        const fullLAST_YEAR = netsalesData.reduce((s, r) => {
            const d = new Date(r[2]);
            if (d.getFullYear() !== LAST_YEAR || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
            const day = d.getDate();
            if (day < (1 + shift) || day > (totalDays + shift)) return s;

            const v = r[idx];
            if (!v || v.toString().trim() === '') return s;

            if (shift === 1 && day === 1) {
                const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
                if (d.toLocaleString('en-US', { month: 'long' }) === nextMonthName) {
                    return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
                }
            }
            return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
        }, 0);

        const growthAmount = growthTarget * 1000;
let romTarget = growthType === 'percent' ? romLastYear * (1 + growthTarget / 100) : romLastYear + growthAmount;
        return {
            mtdLastYear: 0, mtdCurrentYear: 0, mtdTarget: 0,
            romLastYear: Math.round(fullLAST_YEAR), romCurrentYear: 0, romTarget: Math.round(romTarget)
        };
    }

    if (monthEnded && lastCurrentYear && lastCurrentYear >= lastDayCURRENT_YEAR) {
        const mtdLastYear = netsalesData.reduce((s, r) => {
            const d = new Date(r[2]);
            if (d.getFullYear() !== LAST_YEAR || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
            const day = d.getDate();
            if (day < (1 + shift) || day > (totalDays + shift)) return s;

            const v = r[idx];
            if (!v || v.toString().trim() === '') return s;

            if (shift === 1 && day === 1) {
                const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
                if (d.toLocaleString('en-US', { month: 'long' }) === nextMonthName) {
                    return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
                }
            }
            return s + (parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0));
        }, 0);

        let mtdTarget;
        if (growthType === 'percent') {
            mtdTarget = mtdLastYear * (1 + growthTarget / 100);
        } else {
            const growthAmount = growthTarget * 1000;
            mtdTarget = mtdLastYear + growthAmount;
        }

        return {
            mtdLastYear: Math.round(mtdLastYear),
            mtdCurrentYear: Math.round(mtdCurrentYear),
            mtdTarget: Math.round(mtdTarget),
            romLastYear: 0, romCurrentYear: 0, romTarget: 0
        };
    }

    const elapsedDays = lastCurrentYear ? lastCurrentYear.getDate() : 0;

    mtdCurrentYear = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== CURRENT_YEAR || d > lastCurrentYear || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const v = r[idx];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const mtdLastYear = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== LAST_YEAR || d.toLocaleString('en-US',{month:'long'}) !== month) return s;
        const day = d.getDate();
        if (day < (1 + shift) || day > (elapsedDays + shift)) return s;
        const v = r[idx];
        return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
    }, 0);

    const romLastYear = netsalesData.reduce((s, r) => {
        const d = new Date(r[2]);
        if (d.getFullYear() !== LAST_YEAR) return s;
        const rowMonth = d.toLocaleString('en-US', { month: 'long' });
        const day = d.getDate();

        if (rowMonth === month && day > (elapsedDays + shift) && day <= (totalDays + shift)) {
            const v = r[idx];
            return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
        }

        if (shift === 1 && day === 1) {
            const nextMonthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][(monthIndex + 1) % 12];
            if (rowMonth === nextMonthName) {
                const v = r[idx];
                return s + (v && v.toString().trim() !== '' ? parseFloat(v.toString().replace(/[^0-9.-]+/g, '') || 0) : 0);
            }
        }
        return s;
    }, 0);

    let mtdTarget, romTarget;
    const totalLAST_YEAR = mtdLastYear + romLastYear;
    const growthAmount = growthTarget * 1000;

    if (growthType === 'percent') {
        const factor = 1 + growthTarget / 100;
        mtdTarget = mtdLastYear * factor;
        romTarget = romLastYear * factor;
        } else {
        const growthAmount = growthTarget * 1000;

        // Calculate average sales per weekday in LAST_YEAR for the month
        const dayAverages = {};
        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        days.forEach(d => dayAverages[d] = 0);

        let count = {};
        days.forEach(d => count[d] = 0);

        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (d.getFullYear() !== LAST_YEAR || 
                d.toLocaleString('en-US', { month: 'long' }) !== month) return;

            const dayName = d.toLocaleString('en-US', { weekday: 'long' });
            const cell = row[storeColumns[store]];
            const sales = (cell != null && cell.toString().trim() !== '') 
                ? parseFloat(cell.toString().replace(/[^0-9.-]+/g, '')) || 0 
                : 0;

            dayAverages[dayName] += sales;
            count[dayName]++;
        });

        days.forEach(d => {
            dayAverages[d] = count[d] > 0 ? dayAverages[d] / count[d] : 0;
        });

        // Count how many of each weekday in the month
        const monthDayCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayName = date.toLocaleString('en-US', { weekday: 'long' });
            monthDayCount[dayName]++;
        }

        // Total expected sales for full month
        let totalExpected = 0;
        days.forEach(d => {
            totalExpected += dayAverages[d] * monthDayCount[d];
        });

        // MTD and ROM expected sales
        let mtdExpected = 0;
        let romExpected = 0;

        for (let d = 1; d <= totalDays; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayName = date.toLocaleString('en-US', { weekday: 'long' });
            const expected = dayAverages[dayName];

            if (d <= elapsedDays) {
                mtdExpected += expected;
            } else {
                romExpected += expected;
            }
        }

        // Prorate growth
        const mtdShare = totalExpected > 0 ? mtdExpected / totalExpected : 0;
        const romShare = totalExpected > 0 ? romExpected / totalExpected : 0;

        mtdTarget = Math.round(mtdLastYear + growthAmount * mtdShare);
        romTarget = Math.round(romLastYear + growthAmount * romShare);
    }

    mtdTarget = Math.round(mtdTarget);
    romTarget = Math.round(romTarget);

    const romCurrentYear = mtdLastYear > 0 ? romLastYear * (mtdCurrentYear / mtdLastYear) : 0;

    return {
        mtdLastYear: Math.round(mtdLastYear),
        mtdCurrentYear: Math.round(mtdCurrentYear),
        mtdTarget: mtdTarget,
        romLastYear: Math.round(romLastYear),
        romCurrentYear: Math.round(romCurrentYear),
        romTarget: romTarget,
        elapsedDays: elapsedDays,
        lastCurrentYear: lastCurrentYear  // ADD THIS
    };
}

/* -------------------------------------------------------------
   FORMATTING
   ------------------------------------------------------------- */
function formatNumber(v, aov = false) {
    if (v === 0) return aov ? '$0.00' : '$0';
    const abs = Math.abs(v);
    let fmt;
    if (aov) {
        fmt = abs.toFixed(2);
    } else {
        fmt = Math.round(abs).toLocaleString('en-US'); // $xx,xxx
    }
    return v < 0 ? `<span class="negative">($${fmt})</span>` : `$${fmt}`;
}

function formatPercent(v) {
    if (v === '∞') return v;
    if (v === 0) return '0.0%';
    const fmt = Math.abs(v).toFixed(1);
    return v < 0 ? `<span class="negative">(${fmt}%)</span>` : `${fmt}%`;
}

function updateChartForSection(sectionId) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
   let canvas;
const container = document.getElementById('chart-container');
if (!container) return;
container.innerHTML = ''; // Always clear first
const newCanvas = document.createElement('canvas');
newCanvas.id = 'dynamic-chart';
newCanvas.width = 400;
newCanvas.height = 300;
container.appendChild(newCanvas);
console.log('Canvas always recreated and appended, now in DOM?', !!document.getElementById('dynamic-chart'));
canvas = document.getElementById('dynamic-chart');
if (!canvas) return; // Safety
container.offsetHeight; // Force reflow
canvas.style.display = 'block';
const ctx = canvas.getContext('2d');
    console.log(`Creating chart for ${sectionId}: canvas exists in DOM?`, !!document.getElementById('dynamic-chart'));
    // Destroy previous chart
    if (window.currentChart) {
        window.currentChart.destroy();
    }
    let chartType = 'bar';
    let labels = [];
    let datasets = [];
    switch (sectionId) {
        case 'metrics-h2':
    // Bar chart: LAST_YEAR vs CURRENT_YEAR by day of week (Sales/Orders/AOV based on sub-view)
    const avgs = calculateAverages(store, month);
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let dataLAST_YEAR = [], dataCURRENT_YEAR = [], subViewTitle = '';
    if (currentMetricsSubView === 'orders') {
        dataLAST_YEAR = days.map(d => avgs.ordersAveragesLastYear[d].length ? Math.round(avgs.ordersAveragesLastYear[d].reduce((a, b) => a + b, 0) / avgs.ordersAveragesLastYear[d].length) : 0);
        dataCURRENT_YEAR = days.map(d => avgs.ordersAveragesCurrentYear[d].length ? Math.round(avgs.ordersAveragesCurrentYear[d].reduce((a, b) => a + b, 0) / avgs.ordersAveragesCurrentYear[d].length) : 0);
        subViewTitle = 'Orders';
    } else if (currentMetricsSubView === 'aov') {
        dataLAST_YEAR = days.map(d => {
            const s24 = avgs.salesAveragesLastYear[d].length ? Math.round(avgs.salesAveragesLastYear[d].reduce((a, b) => a + b, 0) / avgs.salesAveragesLastYear[d].length) : 0;
            const o24 = avgs.ordersAveragesLastYear[d].length ? Math.round(avgs.ordersAveragesLastYear[d].reduce((a, b) => a + b, 0) / avgs.ordersAveragesLastYear[d].length) : 0;
            return o24 > 0 ? (s24 / o24).toFixed(2) : 0;
        });
        dataCURRENT_YEAR = days.map(d => {
            const s25 = avgs.salesAveragesCurrentYear[d].length ? Math.round(avgs.salesAveragesCurrentYear[d].reduce((a, b) => a + b, 0) / avgs.salesAveragesCurrentYear[d].length) : 0;
            const o25 = avgs.ordersAveragesCurrentYear[d].length ? Math.round(avgs.ordersAveragesCurrentYear[d].reduce((a, b) => a + b, 0) / avgs.ordersAveragesCurrentYear[d].length) : 0;
            return o25 > 0 ? (s25 / o25).toFixed(2) : 0;
        });
        subViewTitle = 'AOV';
    } else {  // 'sales' default
        dataLAST_YEAR = days.map(d => avgs.salesAveragesLastYear[d].length ? Math.round(avgs.salesAveragesLastYear[d].reduce((a, b) => a + b, 0) / avgs.salesAveragesLastYear[d].length) : 0);
        dataCURRENT_YEAR = days.map(d => avgs.salesAveragesCurrentYear[d].length ? Math.round(avgs.salesAveragesCurrentYear[d].reduce((a, b) => a + b, 0) / avgs.salesAveragesCurrentYear[d].length) : 0);
        subViewTitle = 'Sales';
    }
    labels = days;
    datasets = [
        {
            label: `${subViewTitle} LAST_YEAR`,
            data: dataLAST_YEAR,
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: `${subViewTitle} CURRENT_YEAR`,
            data: dataCURRENT_YEAR,
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1
        }
    ];
    break;
case 'forecast-h2':
    // Grouped bar chart: MTD and ROM for LAST_YEAR, Target, CURRENT_YEAR
    const forecastData = calculateSalesData(store, month);
    labels = ['LAST_YEAR', 'Target', 'CURRENT_YEAR'];
    datasets = [
        {
            label: 'MTD ($)',
            data: [forecastData.mtdLastYear, forecastData.mtdTarget, forecastData.mtdCurrentYear],
            backgroundColor: 'rgba(54, 162, 235, 0.8)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: 'ROM ($)',
            data: [forecastData.romLastYear, forecastData.romTarget, forecastData.romCurrentYear],
            backgroundColor: 'rgba(255, 159, 64, 0.8)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1
        }
    ];
    chartType = 'bar';
    break;
        case 'scenarios-h2':
            // Bar chart: Scenario ROM values
            const scenarioData = calculateSalesData(store, month);
            
            const mtdGrowthPct = scenarioData.mtdLastYear > 0 ? ((scenarioData.mtdCurrentYear / scenarioData.mtdLastYear) - 1) * 100 : 0;
            labels = [
                `${month} LAST_YEAR Repeats`,
                `${month} at ${growthTarget}${growthType === 'dollar' ? 'K' : '%'} Growth`,
                `${month} at Current Rate ${formatPercent(mtdGrowthPct).replace('%', '')}%`
            ];
            datasets = [{
                label: 'ROM ($)',
                data: [scenarioData.romLastYear, scenarioData.romTarget, scenarioData.romCurrentYear],
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }];
            break;
        case 'seven-day-h2':
            // Line chart: Predicted sales and orders next 7 days
            const days7 = window.predictionDates || [];
            if (days7.length === 0) return;
labels = days7.map(d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
const salesPred = days7.map((_, i) => {
    const el = document.getElementById(`pred-sales-${i}`);
    return el ? parseFloat(el.textContent.replace(/[^0-9.-]+/g, '')) || 0 : 0;
});
const ordersPred = days7.map((_, i) => {
    const el = document.getElementById(`pred-orders-${i}`);
    return parseInt(el ? el.textContent : '0') || 0;
});
datasets = [
    {
        type: 'bar',  // Line for Sales
        label: 'Predicted Sales ($)',
        data: salesPred,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.1,
        fill: false,
        yAxisID: 'y'  // Left axis
    },
    {
        type: 'line',  // Bars for Orders
        label: 'Predicted Orders',
        data: ordersPred,
        backgroundColor: 'rgba(255, 99, 132, 0.6)',  // Solid for bars
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1,
        yAxisID: 'y1'  // Right axis
    }
];
            break;
case 'daycount-h2':
    // Bar chart: LAST_YEAR vs CURRENT_YEAR Day Counts (Weekdays/Weekends)
    const categories = ['Weekdays', 'Weekends'];
    let lastYearWeekdays = 0, lastYearWeekends = 0;
    let elapsedWeekdays = 0, elapsedWeekends = 0;
    let remainingWeekdays = 0, remainingWeekends = 0;
    let lastRecordedDate = null;
    // Extract from table logic
    netsalesData.forEach(row => {
        const date = new Date(row[2]);
        if (isNaN(date)) return;
        const rowMonth = date.toLocaleString('en-US', { month: 'long' });
        if (month && rowMonth !== month) return;
        const value = row[storeColumns[store]];
        if (!value || value.toString().trim() === '') return;
        const year = date.getFullYear();
        const dayIndex = date.getDay();
        if (year === LAST_YEAR) {
            if (dayIndex >= 1 && dayIndex <= 5) lastYearWeekdays++;
            else lastYearWeekends++;
        } else if (year === CURRENT_YEAR) {
            if (dayIndex >= 1 && dayIndex <= 5) elapsedWeekdays++;
            else elapsedWeekends++;
            if (!lastRecordedDate || date > lastRecordedDate) lastRecordedDate = date;
        }
    });
    // Calculate remaining for CURRENT_YEAR
    if (month && !lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
        for (let d = 1; d <= lastDayOfMonth; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) remainingWeekdays++;
            else remainingWeekends++;
        }
    } else if (month && lastRecordedDate) {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        const lastDayOfMonth = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
        for (let d = lastRecordedDate.getDate() + 1; d <= lastDayOfMonth; d++) {
            const date = new Date(CURRENT_YEAR, monthIndex, d);
            const dayIndex = date.getDay();
            if (dayIndex >= 1 && dayIndex <= 5) remainingWeekdays++;
            else remainingWeekends++;
        }
    }
    const totalCURRENT_YEARWeekdays = elapsedWeekdays + remainingWeekdays;
    const totalCURRENT_YEARWeekends = elapsedWeekends + remainingWeekends;
    labels = categories;
    datasets = [
        {
            label: 'LAST_YEAR Counts',
            data: [lastYearWeekdays, lastYearWeekends],
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
        },
        {
            label: 'CURRENT_YEAR Projected Total',
            data: [totalCURRENT_YEARWeekdays, totalCURRENT_YEARWeekends],
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1
        }
    ];
    chartType = 'bar';
    break;
        default:
            document.getElementById('chart-container').style.display = 'none';
            return;
    }
    window.currentChart = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `${sectionId.replace('-h2', ' ').replace(/\b\w/g, l => l.toUpperCase())} - Dynamic Chart`
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
  scales: {
    x: {
        beginAtZero: true
    },
    y: {  // Left axis (always for sales/bars)
        type: 'linear',
        display: true,
        position: 'left',
        beginAtZero: true,
        ...(sectionId === 'seven-day-h2' ? {
            title: {
                display: true,
                text: 'Net Sales ($)'
            }
        } : {})
    },
    ...(sectionId === 'seven-day-h2' ? {
        y1: {  // Right axis (Orders, only for seven-day)
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
                display: true,
                text: 'Orders'
            },
            grid: {
                drawOnChartArea: false  // No overlapping grids
            }
        }
    } : {})
}
        }
    });
    console.log(`Chart created for ${sectionId}:`, window.currentChart);
    window.activeSection = sectionId;
    container.style.display = 'block';
}

/* -------------------------------------------------------------
   START – auto-select current month
   ------------------------------------------------------------- */
window.onload = () => {
    // Add click listeners for sections
    const sections = ['forecast-h2', 'scenarios-h2', 'seven-day-h2', 'metrics-h2', 'daycount-h2'];
sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', () => {
    console.log(`Section clicked: ${id} - About to call updateChartForSection`);
    updateChartForSection(id);
    console.log(`updateChartForSection returned for ${id}`);
});
    }
});
// Add change listeners for filters/toggles
const monthFilter = document.getElementById('month-filter');
if (monthFilter) monthFilter.addEventListener('change', () => {
    updateTables();
});
const storeFilter = document.getElementById('store-filter');
if (storeFilter) storeFilter.addEventListener('change', () => {
    updateTables();
});
const adjustedToggle = document.getElementById('adjusted-toggle');
if (adjustedToggle) adjustedToggle.addEventListener('change', () => {
    updateTables();
});
const growthTargetSel = document.getElementById('growth-target');
if (growthTargetSel) growthTargetSel.addEventListener('change', () => {
    updateGrowthTarget();
    updateTables();
});
// Add click listeners for metrics sub-headers
['sales', 'orders', 'aov'].forEach(view => {
    const header = document.getElementById(`${view}-header`);
    if (header) {
        header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    // Update active class (add underline or style)
    document.querySelectorAll('#metrics-table th[colspan="4"]').forEach(h => {
        h.style.textDecoration = 'none';
        h.style.color = '#333';
    });
    header.style.textDecoration = 'underline';
    header.style.color = '#3498db';
    // Set global and always refresh/show chart
    currentMetricsSubView = view;
    window.activeSection = 'metrics-h2';  // Force section active
    updateChartForSection('metrics-h2');
});
    }
});

    gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(() => loadSheetsData())
            .then(refreshed => {
                if (refreshed) {
                    populateMonthDropdown();

                    // Auto-select current month if it's CURRENT_YEAR
                    const now = new Date();
                    if (now.getFullYear() === CURRENT_YEAR) {
                        const currentMonth = now.toLocaleString('en-US', { month: 'long' });
                        const monthSel = document.getElementById('month-filter');
                        if (monthSel && monthSel.querySelector(`option[value="${currentMonth}"]`)) {
                            monthSel.value = currentMonth;
                        }
                    }
                }
                updateTables();  // This triggers Next Day logic

            })
            .catch(err => {
                console.error('Init error:', err);
                setStatus('Init error');
            });
    });
};

/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – DYNAMIC SHARES
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – DYNAMIC + CUSTOM SOURCE STRING
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – PER STORE & MONTH
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   NEXT DAY TARGETED NET SALES – MAX OF CALC OR AVG
   ------------------------------------------------------------- */
function getNextDayTargetedNetSales(store, month, remaining$, netsalesData, nextDayDate) {
    if (!nextDayDate) return { value: 0, source: 'No next day' };

    const nextWeekday = nextDayDate.toLocaleString('en-US', { weekday: 'long' });
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();

    // Count remaining days of each weekday
    const remainingCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    for (let d = nextDayDate.getDate(); d <= totalDays; d++) {
        const date = new Date(CURRENT_YEAR, monthIndex, d);
        const dayName = date.toLocaleString('en-US', { weekday: 'long' });
        remainingCount[dayName]++;
    }

    const nextDayCount = remainingCount[nextWeekday];

    // Use CURRENT_YEAR if ≥7 days, else LAST_YEAR
    let daysCURRENT_YEAR = 0;
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (d.getFullYear() === CURRENT_YEAR && 
            d.toLocaleString('en-US', { month: 'long' }) === month) {
            const val = row[storeColumns[store]];
            if (val != null && val.toString().trim() !== '') {
                daysCURRENT_YEAR++;
            }
        }
    });

    const useCURRENT_YEAR = daysCURRENT_YEAR >= 7;
    const sourceYear = useCURRENT_YEAR ? 'CURRENT_YEAR' : 'LAST_YEAR';

    // Calculate averages for THIS store and month
    const dayAverages = {};
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    days.forEach(d => dayAverages[d] = 0);

    let count = {};
    days.forEach(d => count[d] = 0);

    const lastDataDate = getLastDataDate(store, month);

    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (d.getFullYear() !== (useCURRENT_YEAR ? CURRENT_YEAR : LAST_YEAR) || 
            d.toLocaleString('en-US', { month: 'long' }) !== month) return;

        // Only include days that have occurred
        if (useCURRENT_YEAR && lastDataDate && d > lastDataDate) return;

        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        const cell = row[storeColumns[store]];
        const sales = (cell != null && cell.toString().trim() !== '') 
            ? parseFloat(cell.toString().replace(/[^0-9.-]+/g, '')) || 0 
            : 0;

        dayAverages[dayName] += sales;
        count[dayName]++;
    });

    let weeklyTotal = 0;
    days.forEach(d => {
        dayAverages[d] = count[d] > 0 ? dayAverages[d] / count[d] : 0;
        weeklyTotal += dayAverages[d];
    });

    const nextDayAvg = dayAverages[nextWeekday] || 0;

    // Total expected sales in remaining period
    let totalRemainingExpected = 0;
    days.forEach(d => {
        totalRemainingExpected += dayAverages[d] * remainingCount[d];
    });

    const nextDayContribution = nextDayAvg * 1;  // only 1 instance of next day
    const share = totalRemainingExpected > 0 ? nextDayContribution / totalRemainingExpected : 0;
    const calculatedTarget = remaining$ * share;

    // Final target = MAX(calculated, nextDayAvg)
    const target = Math.max(calculatedTarget, nextDayAvg);

    // Source string
    const sharePct = (share * 100).toFixed(1);
    const source = `MAX of Target ${formatNumber(remaining$)}<sub>ROM</sub> × ${sharePct}% <sub>Single ${nextWeekday} share</sub>
OR ${formatNumber(nextDayAvg)}<sub>${nextWeekday} avg</sub>`;

        // === Expected Customers – average from most recent 3 same days ===
     // === Expected Customers – average from most recent 3 same days ===
        // === Expected Customers – last 3 same weekdays before Next Day ===
    let recentOrders = [];

    ordersData.forEach(row => {
        const d = new Date(row[2]);
        if (d >= nextDayDate) return; // only before Next Day

        const dayName = d.toLocaleString('en-US', { weekday: 'long' });
        if (dayName !== nextWeekday) return;

        const orders = parseFloat(row[storeColumns[store]]) || 0;
        if (orders > 0) {
            recentOrders.push({ date: d, orders });
        }
    });

    // Sort by date descending, take last 3
    recentOrders.sort((a, b) => b.date - a.date);
    recentOrders = recentOrders.slice(0, 3);

    const expectedCustomers = recentOrders.length > 0 
        ? recentOrders.reduce((a, b) => a + b.orders, 0) / recentOrders.length 
        : 0;

    return {
        value: target,
        source: source,
        customers: expectedCustomers,
        recentCount: recentOrders.length,
        nextWeekday: nextWeekday,
        nextDateStr: nextDayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
}

/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
/* -------------------------------------------------------------
   SUMMARY TABLE
   ------------------------------------------------------------- */
function updateSummaryTable(store, month) {
    const data = calculateSalesData(store, month);
    const tbody = document.getElementById('summary-table')?.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDays = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
    

    // === Skip targets for past months ===
    const now = new Date();
    const monthEnd = new Date(CURRENT_YEAR, monthIndex + 1, 0); // last day of month
    const isPastMonth = now > monthEnd;

    // === Calculate growth values (needed for both paths) ===
    const mtdGrowth$ = data.mtdCurrentYear - data.mtdLastYear;
    const mtdGrowthPct = data.mtdLastYear > 0 ? ((data.mtdCurrentYear / data.mtdLastYear) - 1) * 100 : 0;

    if (isPastMonth) {
        const rows = [
            [
                "Next Day",
                "Complete",
                '--'
            ],
            [
                "MTD Growth",
                `<span style="color: ${mtdGrowth$ >= 0 ? 'green' : 'red'};">
                    ${mtdGrowth$ >= 0 ? '⬆️' : '⬇️'} 
                    ${formatPercent(mtdGrowthPct)}, 
                    ${formatNumber(mtdGrowth$)}
                </span>`,
`$${data.mtdLastYear.toLocaleString()}<sub><small>${LAST_YEAR}</small></sub> → $${data.mtdCurrentYear.toLocaleString()}<sub><small>${CURRENT_YEAR}</small></sub>`            ]
        ];

      rows.forEach(([metric, value, source]) => {
    const tr = document.createElement('tr');
    if (metric === "Next Day") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('next-day')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    } else if (metric === "MTD Growth") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('mtd-growth')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    } else if (metric === "Remaining to Target ($)") {
    tr.innerHTML = `
        <td onclick="updateChartForSummaryRow('remaining-target')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
        <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
    `;
    
    } else {
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
            <td style="padding:3px; color:#666; font-size: small; font-style:italic;">${source}</td>
        `;
    }
    tbody.appendChild(tr);
});
        return;
    }

         // === Next Day – first blank day in CURRENT_YEAR ===
    let nextDayLabel = "Next Day (No data yet)";

    const lastDataDate = getLastDataDate(store, month);
    let firstBlankDay;

    if (lastDataDate === null || lastDataDate < new Date(CURRENT_YEAR, monthIndex, 1)) {
        firstBlankDay = new Date(CURRENT_YEAR, monthIndex, 1); // first day of selected month
    } else {
        firstBlankDay = new Date(lastDataDate);
        firstBlankDay.setDate(firstBlankDay.getDate() + 1);
    }

    if (firstBlankDay.getDate() > totalDays) {
        nextDayLabel = "Next Day: Complete";
    } else {
        const dayName = firstBlankDay.toLocaleString('en-US', { weekday: 'long' });
        const monthName = firstBlankDay.toLocaleString('en-US', { month: 'long' });
        nextDayLabel = `${dayName}, ${monthName} ${firstBlankDay.getDate()}`;
    }

    const overallTarget = data.mtdTarget + data.romTarget;
    const remaining$ = overallTarget - data.mtdCurrentYear;
    const growthNeededPct = data.romLastYear > 0 ? ((remaining$ / data.romLastYear) - 1) * 100 : 0;

    const growthAmount = growthType === 'percent' 
        ? (data.mtdLastYear + data.romLastYear) * (growthTarget / 100) 
        : growthTarget * 1000;

    const nextDayTarget = getNextDayTargetedNetSales(store, month, remaining$, netsalesData, firstBlankDay);

        const rows = [
        [
            "Growth",
            `<span style="color: ${mtdGrowth$ >= 0 ? 'green' : 'red'};">
                ${mtdGrowth$ >= 0 ? '⬆️' : '⬇️'}
                ${formatPercent(mtdGrowthPct)},
                ${formatNumber(mtdGrowth$)}
            </span>`,
        ],
        [
            "Target",
            `${formatNumber(overallTarget)}`,
        ],
        [
            "Remaining",
            remaining$ <= 0
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>`
                : `<span>
                       ${formatNumber(remaining$)}
                   </span>`,
        ],
        [
            "ROM Target",
            remaining$ <= 0
                ? `<span style="color: green; font-weight: bold;">✓ Target Met</span>`
                : `<span style="color: ${growthNeededPct >= 0 ? 'green' : 'red'};">
                       ${formatPercent(growthNeededPct)}
                   </span>`,
        ],
        [
            "Target Sales",
            `<span style="color: ${nextDayTarget.value >= 0 ? 'green' : 'red'};">
                ${formatNumber(nextDayTarget.value)}
            </span>`,
        ],
        [
            "Expected Orders",
            `<span>
                ${Math.round(nextDayTarget.customers)}
            </span>`,
        ],
        [
            "AOV Target",
            `<span>
                $${(nextDayTarget.value / nextDayTarget.customers).toFixed(2)}
            </span>`,
        ],
        // === NEW ROWS ===
        [
            "Staff Hours",
            totalStaffingHours > 0 ? totalStaffingHours.toFixed(1) + "h" : "—"
        ],
               [
            "Forecast Sales",
            formatNumber(nextDayPredictedSales)
        ],
        [
            "Per Staff Hour",
            totalStaffingHours > 0 
                ? "$" + Math.round(nextDayPredictedSales / totalStaffingHours)
                : "—"
        ]
    ];

   rows.forEach(([metric, value, source]) => {
    const tr = document.createElement('tr');
    if (metric === "Next Day") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('next-day')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
    } else if (metric === "MTD Growth") {
        tr.innerHTML = `
            <td onclick="updateChartForSummaryRow('mtd-growth')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
        
    } 
    
    else if (metric === "Remaining to Target ($)") {
    tr.innerHTML = `
        <td onclick="updateChartForSummaryRow('remaining-target')" style="padding:3px; cursor: pointer; font-weight: bold; text-decoration: underline; color: #3498db;" onmouseover="this.style.textDecoration='none'; this.style.color='#2980b9';" onmouseout="this.style.textDecoration='underline'; this.style.color='#3498db';">${metric}</td>
        <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
    `;
    
    }
    
    else {
        tr.innerHTML = `
            <td style="padding:3px;">${metric}</td>
            <td style="text-align:center; padding:6px; font-weight:500;">${value}</td>
        `;
    }
    tbody.appendChild(tr);
});

    


    
}

function updateChartForSummaryRow(rowKey) {
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const container = document.getElementById('chart-container');
    let canvas = document.getElementById('dynamic-chart');
    if (canvas) canvas.style.display = 'none';
if (!container || (rowKey !== 'next-day' && rowKey !== 'mtd-growth' && rowKey !== 'remaining-target')) return;    // Hide canvas, show HTML mode
    if (canvas) canvas.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = ''; // Clear old content when switching views
    if (rowKey === 'next-day') {
        // Get month details
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        if (monthIndex === -1) {
            container.innerHTML = '<p style="text-align:center; color:#666;">Select a month for calendar view.</p>';
            return;
        }
        const totalDays = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
        const isAdjusted = document.getElementById('adjusted-toggle').checked || false;
        const currentDate = CURRENT_DATE; // Fixed for demo
        const isPastMonth = currentDate > new Date(CURRENT_YEAR, monthIndex + 1, 0);
        const lastDataDate = getLastDataDate(store, month);
        const elapsedDayCURRENT_YEAR = lastDataDate ? lastDataDate.getDate() : (monthIndex < currentDate.getMonth() ? totalDays : Math.min(currentDate.getDate(), totalDays));
        const nextDayCURRENT_YEAR = new Date(CURRENT_YEAR, monthIndex, elapsedDayCURRENT_YEAR + 1);
        const isMonthComplete = nextDayCURRENT_YEAR.getDate() > totalDays || isPastMonth; // Add isPastMonth to complete status
        // Elapsed for LAST_YEAR (with shift)
        const shift = isAdjusted ? 1 : 0;
        const elapsedStartLAST_YEAR = 1 + shift;
        const elapsedEndLAST_YEAR = elapsedDayCURRENT_YEAR + shift;
        // Build calendars
        let html = `
            <div style="text-align: center; margin: 10px 0;">
                <h3 style="color: #34495e; margin: 0;">Month Comparison: ${month} LAST_YEAR vs. CURRENT_YEAR (Elapsed Days Highlighted)</h3>
                <p style="color: #666; font-size: 0.9em;">Green: Elapsed | Outlined: Next Day | Bold: Has Data</p>
            </div>
            <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
        `;
        [LAST_YEAR, CURRENT_YEAR].forEach(year => {
            const isCURRENT_YEAR = year === CURRENT_YEAR;
            let totalDaysEffective = totalDays;
            let adjMonthIndex = -1;
            let adjYear = year;
            let adjDate = null;
            if (!isCURRENT_YEAR && isAdjusted) {
                totalDaysEffective = totalDays + 1;
                adjMonthIndex = (monthIndex + 1) % 12;
                adjYear = monthIndex === 11 ? year + 1 : year;
                adjDate = new Date(adjYear, adjMonthIndex, 1);
            }
            // Year-specific weeks calculation
            const firstDay = new Date(year, monthIndex, 1).getDay();
            const weeks = Math.ceil((totalDaysEffective + firstDay) / 7);
            // Precompute data per day (sales $, orders #) - for this year only
            const dayDataCurrent = {};
            const loopDays = isCURRENT_YEAR ? totalDays : totalDaysEffective;
            for (let d = 1; d <= loopDays; d++) {
                dayDataCurrent[d] = { sales: 0, orders: 0 };
                // Fetch sales/orders for this year
                let fetchDate = new Date(year, monthIndex, d);
                if (!isCURRENT_YEAR && isAdjusted && d > totalDays) {
                    fetchDate = adjDate;
                }
                netsalesData.forEach(row => {
                    const rowDate = new Date(row[2]);
                    if (rowDate.getTime() === fetchDate.getTime()) {
                        const salesVal = row[storeColumns[store]];
                        dayDataCurrent[d].sales = parseFloat(salesVal?.toString().replace(/[^0-9.-]+/g, '') || 0);
                        const orderRow = ordersData.find(o => new Date(o[2]).getTime() === fetchDate.getTime());
                        dayDataCurrent[d].orders = parseFloat(orderRow?.[storeColumns[store]] || 0);
                    }
                });
            }
            const dayData = dayDataCurrent;
            const elapsedStart = isCURRENT_YEAR ? 1 : elapsedStartLAST_YEAR;
            const elapsedEnd = isCURRENT_YEAR ? elapsedDayCURRENT_YEAR : Math.min(elapsedEndLAST_YEAR, totalDaysEffective);
            html += `
                <div style="min-width: 200px;">
                    <h4 style="text-align: center; color: #2c3e50; margin: 5px 0;">${year} ${month}</h4>
                    <table style="border-collapse: collapse; margin: 0 auto; font-size: 0.8em;">
                        <thead>
                            <tr style="background: #e0e0e0;">
                                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<th style="border: 1px solid #ddd; padding: 4px;">${day}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;
            let currentWeek = firstDay; // Reuse firstDay for padding count
            let day = 1;
            for (let w = 0; w < weeks; w++) {
                html += '<tr>';
                for (let wd = 0; wd < 7; wd++) { // 0=Sun, 6=Sat
                    if (currentWeek > 0) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f9f9f9;"></td>';
                        currentWeek--;
                    } else if (day > totalDaysEffective) {
                        html += '<td style="border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top; background: #f0f0f0;"></td>';
                    } else {
                        const inElapsed = day >= elapsedStart && day <= elapsedEnd;
                        let cellStyle = 'border: 1px solid #ddd; padding: 2px; height: 40px; vertical-align: top;';
                        if (inElapsed) {
                            cellStyle += ' background-color: #d4edda;'; // Light green
                        } else if (day > elapsedEnd) {
                            cellStyle += ' background-color: #f8f9fa;'; // Light gray
                        }
                        // Next Day (CURRENT_YEAR only, skip for past months) - outline here
                        if (isCURRENT_YEAR && !isPastMonth && day === nextDayCURRENT_YEAR.getDate() && !isMonthComplete) {
                            cellStyle += ' border: 2px solid #28a745 !important; background-color: #fff3cd !important;'; // Yellow bg + Green outline
                        }
                        let dayLabel = day.toString();
                        let titleDate = `${month} ${day}, ${year}`;
                        if (!isCURRENT_YEAR && isAdjusted && day > totalDays) {
                            const adjMonthShort = adjDate.toLocaleDateString('en-US', { month: 'short' });
                            dayLabel = `${adjMonthShort} 1`;
                            titleDate = `${adjMonthShort} 1, ${adjYear}`;
                        }
                        const salesK = (dayData[day].sales / 1000).toFixed(1);
                        const orders = dayData[day].orders;
                        const hasData = dayData[day].sales > 0 || orders > 0;
                        let content = `<div style="font-weight: ${hasData ? 'bold' : 'normal'};">${dayLabel}</div>`;
                        if (hasData) {
                            content += `<div style="font-size: 0.7em; line-height: 1.1;">
                                <small>$${salesK}K</small><br>
                                <small>${orders || ''}</small>
                            </div>`;
                        }
                        html += `<td style="${cellStyle}" title="${titleDate}: Sales $${dayData[day].sales.toLocaleString()} | Orders: ${orders}">${content}</td>`;
                        day++;
                    }
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        });
        html += '</div>';
        container.innerHTML = html;
        window.activeView = 'next-day';
        return;
    }
    if (rowKey === 'mtd-growth') {
        const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
        if (monthIndex === -1) {
            container.innerHTML = '<p style="text-align:center; color:#666;">Select a month for MTD Growth chart.</p>';
            window.activeView = 'mtd-growth';
            return;
        }
        container.innerHTML = ''; // Clear any old content
        const totalDays = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
        const shift = document.getElementById('adjusted-toggle')?.checked ? 1 : 0;
        const idx = storeColumns[store];

        // Collect and sort daily sales for LAST_YEAR and CURRENT_YEAR
        const salesLAST_YEAR = {};
        const salesCURRENT_YEAR = {};
        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (isNaN(d) || d.toLocaleString('en-US', { month: 'long' }) !== month) return;
            const day = d.getDate();
            const sales = parseFloat(row[idx]?.toString().replace(/[^0-9.-]+/g, '') || 0);
            if (sales === 0) return;
            const year = d.getFullYear();
            if (year === LAST_YEAR) {
                // Apply shift for LAST_YEAR
                const adjDay = day - shift;
                if (adjDay >= 1 && adjDay <= totalDays) {
                    salesLAST_YEAR[adjDay] = (salesLAST_YEAR[adjDay] || 0) + sales;
                }
            } else if (year === CURRENT_YEAR) {
                salesCURRENT_YEAR[day] = (salesCURRENT_YEAR[day] || 0) + sales; // CURRENT_YEAR no shift
            }
        });

        // Compute cumulatives
        const cumLAST_YEAR = [];
        const cumCURRENT_YEAR = [];
        let runningLAST_YEAR = 0;
        let runningCURRENT_YEAR = 0;
        for (let day = 1; day <= totalDays; day++) {
            runningLAST_YEAR += salesLAST_YEAR[day] || 0;
            runningCURRENT_YEAR += salesCURRENT_YEAR[day] || 0;
            cumLAST_YEAR.push(runningLAST_YEAR);
            cumCURRENT_YEAR.push(runningCURRENT_YEAR);
        }

// Calculate elapsed days for cutoff (use CURRENT_YEAR last data date or current if no data)
const lastDataDate = getLastDataDate(store, month);
const elapsedDays = lastDataDate ? lastDataDate.getDate() : new Date().getDate();
const cutoffDay = Math.min(elapsedDays, totalDays);

// Slice arrays to cutoff
const labels = Array.from({length: cutoffDay}, (_, i) => i + 1);
const slicedCumLAST_YEAR = cumLAST_YEAR.slice(0, cutoffDay);
const slicedCumCURRENT_YEAR = cumCURRENT_YEAR.slice(0, cutoffDay);



        // Create line chart
        let chartCanvas = document.getElementById('dynamic-chart');
        if (!chartCanvas) {
            chartCanvas = document.createElement('canvas');
            chartCanvas.id = 'dynamic-chart';
            chartCanvas.width = 400;
            chartCanvas.height = 300;
            container.appendChild(chartCanvas);
        }
        if (window.currentChart) window.currentChart.destroy();
        const ctx = chartCanvas.getContext('2d');
        window.currentChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Cumulative LAST_YEAR',
                        data: slicedCumLAST_YEAR,
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1,
                        fill: false
                    },
                    {
                        label: 'Cumulative CURRENT_YEAR',
                        data: slicedCumCURRENT_YEAR,
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `MTD Cumulative Sales: ${month} ${store}`
                    },
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    x: { title: { display: true, text: 'Day of Month' } },
                    y: { 
                        beginAtZero: true,
                        title: { display: true, text: 'Cumulative Net Sales ($)' }
                    }
                }
            }
        });

        chartCanvas.style.display = 'block';
        container.style.display = 'block';
        window.activeView = 'mtd-growth';
        return;
    }
if (rowKey === 'remaining-target') {
    container.innerHTML = ''; // Clear any old content
    const store = document.getElementById('store-filter').value || 'CAFE';
    const month = document.getElementById('month-filter').value || '';
    const data = calculateSalesData(store, month);
    const overallTarget = data.mtdTarget + data.romTarget;
    const remainingToTarget = overallTarget - data.mtdCurrentYear;
    const totalLAST_YEAR = data.mtdLastYear + data.romLastYear;
    const labels = ['LAST_YEAR Full Month', 'CURRENT_YEAR MTD', 'Remaining to Target', 'CURRENT_YEAR Target'];
    const remainingColor = remainingToTarget > 0 ? 'rgba(255, 206, 86, 0.8)' : (remainingToTarget < 0 ? 'rgba(255, 99, 132, 0.8)' : 'rgba(150, 150, 150, 0.8)');
    const datasets = [
        {
            label: 'LAST_YEAR Full Month',
            data: [totalLAST_YEAR, null, null, null],
            backgroundColor: 'rgba(54, 162, 235, 0.8)'
        },
        {
            label: 'CURRENT_YEAR MTD',
            data: [null, data.mtdCurrentYear, null, null],
            backgroundColor: 'rgba(75, 192, 192, 0.8)'
        },
        {
            label: 'Remaining to Target',
            data: [null, null, remainingToTarget !== 0 ? [data.mtdCurrentYear, overallTarget] : null, null],
            backgroundColor: remainingColor
        },
        {
            label: 'CURRENT_YEAR Target',
            data: [null, null, null, overallTarget],
            backgroundColor: 'rgba(153, 102, 255, 0.8)'
        }
    ];

    // Create bar chart with floating for Remaining
    let chartCanvas = document.getElementById('dynamic-chart');
    if (!chartCanvas) {
        chartCanvas = document.createElement('canvas');
        chartCanvas.id = 'dynamic-chart';
        chartCanvas.width = 400;
        chartCanvas.height = 300;
        container.appendChild(chartCanvas);
    }
    if (window.currentChart) window.currentChart.destroy();
    const ctx = chartCanvas.getContext('2d');
    window.currentChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Target Waterfall: ${month} ${store}`
                },
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
label: function(context) {
    let label = context.dataset.label || '';
    if (label) {
        label += ': ';
    }
    if (context.parsed.y !== null) {
        if (context.dataset.label === 'Remaining to Target') {
            label += formatNumber(remainingToTarget);  // Direct diff value
        } else {
            label += formatNumber(context.parsed.y);
        }
    }
    return label;
}                    }
                }
            },
            scales: {
                x: { stacked: false },
                y: { 
                    beginAtZero: true,
                    stacked: true,
                    title: { display: true, text: 'Net Sales ($)' }
                }
            }
        }
    });
    chartCanvas.style.display = 'block';
    container.style.display = 'block';
    window.activeView = 'remaining-target';
    return;
}
 


// For other rows, extend similarly (e.g., if (rowKey === 'mtd-growth') { ... })
}

// ====================== TODAY'S SCHEDULE – USING GAPI (WORKS EXACTLY LIKE THE REST OF YOUR DASHBOARD) ======================
const scheduleTabs = {
    CAFE: "Schedule-CAFE",
    FEELLOVE: "Schedule-FEELLOVE",
    SNOW: "Schedule-SNOW",
    ZION: "Schedule-ZION"
};

// Store-specific opening hours (24-hour format, strings are fine)
const storeHours = {
    CAFE:     { open: "07:00", close: "15:00" },   // 7am – 3pm daily
    FEELLOVE: { 
        weekday: { open: "06:00", close: "19:00" },  // Mon–Fri 6am – 7pm
        weekend: { open: "07:00", close: "16:00" }   // Sat–Sun 7am – 4pm
    },
    SNOW:     { open: "06:00", close: "17:00" },   // 6am – 5pm daily
    ZION:     { open: "06:00", close: "17:00" }    // 6am – 5pm daily
};

// Parse time from various formats (Google Sheets can return different formats)
// Google Sheets stores times in UTC, so we subtract 7 hours for Mountain Time
const MT_OFFSET = -7; // Mountain Time offset from UTC

function parseTimeStr(timeStr, applyTimezoneOffset = true) {
    if (!timeStr) return { h: 0, m: 0 };

    const str = String(timeStr).trim().toUpperCase();
    let h = 0, m = 0;

    // Handle decimal (Google Sheets serial time: 0.5 = 12:00 PM UTC)
    if (!isNaN(parseFloat(str)) && str.indexOf(':') === -1) {
        const decimal = parseFloat(str);
        if (decimal >= 0 && decimal < 1) {
            const totalMinutes = Math.round(decimal * 24 * 60);
            h = Math.floor(totalMinutes / 60);
            m = totalMinutes % 60;
        }
    }
    // Handle "HH:MM" or "H:MM"
    else if (str.indexOf(':') !== -1) {
        let [hPart, rest] = str.split(':');
        h = parseInt(hPart) || 0;
        m = parseInt(rest) || 0;

        // Handle AM/PM suffix
        if (rest && rest.includes('PM') && h < 12) h += 12;
        if (rest && rest.includes('AM') && h === 12) h = 0;
    }
    // Handle "1 PM" or "1PM" format
    else {
        const ampmMatch = str.match(/^(\d{1,2})\s*(AM|PM)$/);
        if (ampmMatch) {
            h = parseInt(ampmMatch[1]);
            if (ampmMatch[2] === 'PM' && h < 12) h += 12;
            if (ampmMatch[2] === 'AM' && h === 12) h = 0;
        } else {
            // Fallback: try to parse as number (hours)
            const num = parseInt(str);
            if (!isNaN(num)) h = num;
        }
    }

    // Apply Mountain Time offset (UTC to MT)
    if (applyTimezoneOffset) {
        h = (h + MT_OFFSET + 24) % 24;
    }

    return { h, m };
}

function formatMT(timeStr) {
    // Format time as 12-hour with am/pm (always show minutes)
    const { h, m } = parseTimeStr(timeStr);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m.toString().padStart(2,"0")}${ampm}`;
}

function getTimeAs24h(timeStr) {
    const { h, m } = parseTimeStr(timeStr);
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}

// Wrapper function for loading schedule with specific date
async function loadScheduleForDate(store, date) {
    return loadTodaySchedule(store, date);
}

async function loadTodaySchedule(store, overrideDate = null) {
    const storeKey = store || 'CAFE';

    // === Determine the date for the schedule ===
    let scheduleDate;
    if (overrideDate) {
        scheduleDate = new Date(overrideDate);
    } else {
        // Default: day after last sales
        const lastSalesDate = getLastDataDate(storeKey, '');
        scheduleDate = new Date();
        if (lastSalesDate) {
            scheduleDate = new Date(lastSalesDate);
            scheduleDate.setDate(scheduleDate.getDate() + 1);
        } else {
            scheduleDate.setDate(scheduleDate.getDate() + 1);
        }
    }

    // === today for weekend check (real today in MT) ===
    const today = new Date();   // ← this line was missing – fixes weekend detection

    const todayShort = scheduleDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver" });
    const scheduleDateEl = document.getElementById("schedule-date");
    if (scheduleDateEl) {
        scheduleDateEl.textContent = " – " + scheduleDate.toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: "America/Denver" });
    }

    const tab = scheduleTabs[storeKey] || "Schedule-SNOW";

    // === Store-specific open/close today ===
    let openHour, closeHour, hoursText;
    if (storeKey === "CAFE") {
        openHour = 7; closeHour = 15; hoursText = "Open 7am – 3pm";
    } else if (storeKey === "FEELLOVE") {
const isWeekend = scheduleDate.getDay() === 0 || scheduleDate.getDay() === 6;  // Sun=0, Sat=6
if (isWeekend) { openHour = 7; closeHour = 16; hoursText = "Open 7am – 4pm (Weekend)"; }
        else { openHour = 6; closeHour = 19; hoursText = "Open 6am – 7pm (Weekday)"; }
    } else { // SNOW & ZION
        openHour = 6; closeHour = 17; hoursText = "Open 6am – 5pm";
    }

    const visibleStart = openHour - 1;
    const visibleEnd = closeHour + 1;
    const visibleHours = visibleEnd - visibleStart;

    try {
        const resp = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${tab}!A:E`
        });
        const rows = resp.result.values || [];
        const shifts = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 5) continue;
            if (row[0] === todayShort && row[2]) {
                // Normalize times to 24-hour format
                const startTime = getTimeAs24h(row[3]);
                const endTime = getTimeAs24h(row[4]);
                shifts.push({
                    employee: (row[2] + "").replace(/ \(Shift a.*\)/, '').trim(),
                    start: startTime,
                    end: endTime
                });
            }
        }

        // === Header with dynamic columns ===
        let html = `<div class="gantt-header" style="grid-template-columns: 150px repeat(${visibleHours}, 1fr);">
            <div><small style="font-weight:normal;color:#ccc;">${hoursText}</small></div>`;
        for (let i = 0; i < visibleHours; i++) {
            const hour = (visibleStart + i + 24) % 24;
            const label = hour < 10 ? ` ${hour}:00` : `${hour}:00`;
            const isOpen  = hour === openHour;
            const isClose = hour === closeHour;
            html += `<div class="hour"${isOpen || isClose ? ' style="position:relative;"' : ''}>
                        <span>${label}</span>`;
            if (isOpen || isClose) html += `<div style="position:absolute;top:10px;left:0;right:0;border-right:4px solid #27ae60;"></div>`;
            html += `</div>`;
        }
        html += `</div>`;

        if (shifts.length === 0) {
            html += `<p style="padding:20px;text-align:center;color:#777;">No shifts scheduled today</p>`;
        } else {
            shifts.sort((a, b) => a.start.localeCompare(b.start));
            shifts.forEach(shift => {
                const [sh, sm] = shift.start.split(":").map(Number);
                const [eh, em] = shift.end.split(":").map(Number);
                // Times are already in Mountain Time, no offset needed
                const startDecimal = sh + sm/60;
                let endDecimal = eh + em/60;
                // Handle overnight shifts
                if (endDecimal < startDecimal) endDecimal += 24;

                let left = (startDecimal - visibleStart) / visibleHours * 100;
                let width = (endDecimal - startDecimal) / visibleHours * 100;

                // Clamp to visible range
                if (left < 0) { width += left; left = 0; }
                if (left + width > 100) { width = 100 - left; }

                html += `<div class="employee-row">
                    <div class="employee-name">${shift.employee}</div>
                    <div class="timeline">
                        <div class="shift-bar" style="left:${left}%; width:${width}%;">${formatMT(shift.start)} – ${formatMT(shift.end)}</div>
                    </div>
                </div>`;
            });
        }

        // === Calculate total staffing hours ===
        let totalHours = 0;
        shifts.forEach(shift => {
            const [startH, startM] = shift.start.split(":").map(Number);
            const [endH, endM] = shift.end.split(":").map(Number);
            let hours = endH - startH + (endM - startM) / 60;
            if (hours < 0) hours += 24; // handle overnight shifts
            totalHours += hours;
        });
        const totalHoursDisplay = totalHours.toFixed(1);
        totalStaffingHours = parseFloat(totalHoursDisplay);   // make it global

        // Add total hours below the schedule
        html += `<div style="margin-top:15px; padding:10px; background:#f0f8ff; border-radius:8px; font-weight:bold; font-size:1.1em;">
            Total Staffing Hours: ${totalHoursDisplay}h
        </div>`;



        // Legacy gantt kept hidden - using inline gantt bars in staff cards instead

        // Render new manager UI team cards
        await renderTeamCards(storeKey, scheduleDate, shifts);

    } catch (err) {
        console.error("Schedule error:", err);

        // Show error in team cards
        const teamList = document.getElementById('team-list');
        if (teamList) {
            teamList.innerHTML = '<div class="no-schedule"><p style="color: #e74c3c;">Error loading schedule</p></div>';
        }
    }
}

// Collapsible (only if element exists - legacy support)
const scheduleH2 = document.getElementById("schedule-h2");
if (scheduleH2) {
    scheduleH2.addEventListener("click", () => {
        const c = document.getElementById("schedule-container");
        if (c) c.style.display = c.style.display === "block" ? "none" : "block";
    });
}

// Reload schedule when store changes - uses selectedDate from index.html
const storeFilter = document.getElementById("store-filter");
if (storeFilter) {
    storeFilter.addEventListener("change", () => {
        const store = document.getElementById("store-filter").value;
        // Use selectedDate if available (from day navigation), otherwise use default
        if (typeof selectedDate !== 'undefined') {
            loadScheduleForDate(store, selectedDate);
            const dateKey = formatDateLocal(selectedDate);
            loadDayNote(store, dateKey);
        } else {
            loadTodaySchedule(store);
        }
    });
}

// Old printDashboard removed - using updated version below



const originalUpdateTables = updateTables;
updateTables = async function () {
    const store = document.getElementById("store-filter").value || 'CAFE';

    // Run schedule and wait for it to finish
    await loadTodaySchedule(store);

    // Now run everything else — totalStaffingHours is guaranteed to be set
    originalUpdateTables.apply(this, arguments);

    // Update new manager UI components
    updateProgressRing(store);
    updateQuickStats(store);
};


/* -------------------------------------------------------------
   MANAGER UI - Monthly Goal Management
   ------------------------------------------------------------- */
function getGoalSettingsKey(store, month) {
    return `feellove_goal_settings_${store}_${month}`;
}

function getGoalSettings(store, month) {
    const key = getGoalSettingsKey(store, month);
    const saved = localStorage.getItem(key);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return null;
        }
    }
    return null;
}

function saveGoalSettings(store, month, settings) {
    const key = getGoalSettingsKey(store, month);
    localStorage.setItem(key, JSON.stringify(settings));
}

function updateGoalFromSelector() {
    const store = document.getElementById('store-filter')?.value || 'CAFE';
    const month = document.getElementById('month-filter')?.value || '';
    const selector = document.getElementById('goal-selector');
    const customInput = document.getElementById('custom-goal-input');

    if (!selector) return;

    const value = selector.value;

    if (value === 'custom') {
        customInput.style.display = 'inline-block';
        customInput.focus();
    } else {
        customInput.style.display = 'none';
        saveGoalSettings(store, month, { type: value });
        updateProgressRing(store);
    }
}

function saveCustomGoal(value) {
    const store = document.getElementById('store-filter')?.value || 'CAFE';
    const month = document.getElementById('month-filter')?.value || '';

    if (value && parseFloat(value) > 0) {
        saveGoalSettings(store, month, { type: 'custom', value: parseFloat(value) });
    }

    updateProgressRing(store);
}

function calculateGoalTarget(store, month) {
    const data = calculateSalesData(store, month);
    const lastYearTotal = (data.mtdLastYear || 0) + (data.romLastYear || 0);

    // Get saved settings
    const settings = getGoalSettings(store, month);

    if (!settings) {
        // Default: +20%
        return Math.round(lastYearTotal * 1.20);
    }

    if (settings.type === 'custom' && settings.value) {
        return settings.value;
    }

    if (settings.type.startsWith('pct_')) {
        const pct = parseInt(settings.type.split('_')[1]) / 100;
        return Math.round(lastYearTotal * (1 + pct));
    }

    if (settings.type.startsWith('add_')) {
        const addAmount = parseInt(settings.type.split('_')[1]);
        return Math.round(lastYearTotal + addAmount);
    }

    // Fallback
    return Math.round(lastYearTotal * 1.20);
}

function loadGoalSelector(store, month) {
    const selector = document.getElementById('goal-selector');
    const customInput = document.getElementById('custom-goal-input');
    if (!selector) return;

    const settings = getGoalSettings(store, month);

    if (settings) {
        if (settings.type === 'custom') {
            selector.value = 'custom';
            customInput.style.display = 'inline-block';
            customInput.value = settings.value || '';
        } else {
            selector.value = settings.type;
            customInput.style.display = 'none';
        }
    } else {
        selector.value = 'pct_20'; // Default
        customInput.style.display = 'none';
    }
}

/* -------------------------------------------------------------
   MANAGER UI - Progress Ring & Bar
   ------------------------------------------------------------- */
function updateProgressRing(store) {
    // Use the selected date if available, otherwise use today
    const viewDate = (typeof selectedDate !== 'undefined' && selectedDate) ? selectedDate : new Date();

    // Delegate to the date-aware function for consistent calculations
    if (typeof updateProgressRingForDate === 'function') {
        updateProgressRingForDate(store, viewDate);
        return;
    }

    // Fallback to original logic if date function not available
    const month = document.getElementById('month-filter')?.value || '';
    const data = calculateSalesData(store, month);

    // Current MTD sales
    const current = data.mtdCurrentYear || 0;

    // Get target from goal selector
    const target = calculateGoalTarget(store, month) || 1;

    // Update goal selector display
    loadGoalSelector(store, month);

    // Calculate days in month and days elapsed
    const monthIndex = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(month);
    const totalDaysInMonth = new Date(CURRENT_YEAR, monthIndex + 1, 0).getDate();
    const today = new Date();
    const daysElapsed = data.daysElapsed || Math.min(today.getDate(), totalDaysInMonth);
    const daysRemaining = Math.max(0, totalDaysInMonth - daysElapsed);

    // Calculate pace
    const pacePercentage = (daysElapsed / totalDaysInMonth) * 100;
    const expectedAtPace = (target * daysElapsed) / totalDaysInMonth;
    const remaining = Math.max(0, target - current);
    const dailyTarget = daysRemaining > 0 ? remaining / daysRemaining : 0;
    const projectedTotal = daysElapsed > 0 ? (current / daysElapsed) * totalDaysInMonth : 0;

    // Pace status
    const aheadOfPace = current >= expectedAtPace;
    const paceGap = current - expectedAtPace;

    const percentage = Math.min(Math.round((current / target) * 100), 150);
    const displayPct = Math.min(percentage, 100);

    // Update main displays
    const pctEl = document.getElementById('progress-percentage');
    if (pctEl) {
        pctEl.textContent = `${percentage}%`;
        pctEl.style.color = percentage >= 100 ? '#c9a227' : (aheadOfPace ? '#27ae60' : '#e74c3c');
    }

    const currentEl = document.getElementById('progress-current');
    if (currentEl) {
        currentEl.textContent = `$${current.toLocaleString()}`;
        currentEl.style.color = aheadOfPace ? '#27ae60' : '#e74c3c';
    }

    const goalEl = document.getElementById('progress-goal');
    if (goalEl) goalEl.textContent = `$${target.toLocaleString()}`;

    // Update progress bar
    const barFill = document.getElementById('progress-bar-fill');
    const barTarget = document.getElementById('progress-bar-target');
    const paceMarker = document.getElementById('progress-pace-marker');
    const paceLabel = document.getElementById('progress-pace-label');

    if (barFill) {
        barFill.style.width = `${displayPct}%`;
        if (percentage >= 100) {
            barFill.style.background = 'linear-gradient(90deg, #c9a227, #e8d48a)';
        } else if (aheadOfPace) {
            barFill.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
        } else {
            barFill.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';
        }
    }
    if (barTarget) barTarget.textContent = `$${target.toLocaleString()}`;
    if (paceMarker) paceMarker.style.left = `${Math.min(pacePercentage, 100)}%`;
    if (paceLabel) paceLabel.textContent = `Projected: $${Math.round(projectedTotal).toLocaleString()}`;

    // Update target cards
    const remainingEl = document.getElementById('target-remaining');
    if (remainingEl) {
        if (remaining > 0) {
            remainingEl.textContent = `$${remaining.toLocaleString()}`;
            remainingEl.parentElement.style.borderColor = '#e74c3c';
        } else {
            remainingEl.textContent = `+$${Math.abs(target - current).toLocaleString()}`;
            remainingEl.parentElement.style.borderColor = '#27ae60';
            remainingEl.style.color = '#27ae60';
        }
    }

    const dailyEl = document.getElementById('target-daily');
    if (dailyEl) dailyEl.textContent = `$${Math.round(dailyTarget).toLocaleString()}`;

    const daysLeftEl = document.getElementById('target-days-left');
    if (daysLeftEl) daysLeftEl.textContent = daysRemaining;

    // Pace status card
    const paceStatusEl = document.getElementById('pace-status');
    const paceStatusDetailEl = document.getElementById('pace-status-detail');
    const paceStatusCard = document.getElementById('pace-status-card');

    if (paceStatusEl && paceStatusDetailEl && paceStatusCard) {
        if (percentage >= 100) {
            paceStatusEl.textContent = 'Goal Hit!';
            paceStatusEl.style.color = '#c9a227';
            paceStatusCard.style.borderColor = '#c9a227';
            paceStatusDetailEl.textContent = 'Congratulations!';
        } else if (aheadOfPace) {
            paceStatusEl.textContent = 'Ahead';
            paceStatusEl.style.color = '#27ae60';
            paceStatusCard.style.borderColor = '#27ae60';
            paceStatusDetailEl.textContent = `+$${Math.abs(Math.round(paceGap)).toLocaleString()} vs pace`;
        } else {
            paceStatusEl.textContent = 'Behind';
            paceStatusEl.style.color = '#e74c3c';
            paceStatusCard.style.borderColor = '#e74c3c';
            paceStatusDetailEl.textContent = `-$${Math.abs(Math.round(paceGap)).toLocaleString()} vs pace`;
        }
    }

    // Print version
    const amountPrintEl = document.getElementById('progress-amounts-print');
    if (amountPrintEl) amountPrintEl.textContent = `$${current.toLocaleString()} / $${target.toLocaleString()}`;

    // Motivational message - pass average daily for reality check
    const avgDaily = daysElapsed > 0 ? current / daysElapsed : 0;
    const msgEl = document.getElementById('motivational-message');
    if (msgEl) {
        const msg = getMotivationalMessage(percentage, remaining, dailyTarget, aheadOfPace, daysRemaining, avgDaily);
        if (msg) {
            msgEl.textContent = msg;
            msgEl.style.display = 'block';
            msgEl.style.borderColor = aheadOfPace ? '#27ae60' : '#e74c3c';
            msgEl.style.background = aheadOfPace ? '#f0fff4' : '#fff5f5';
        } else {
            msgEl.style.display = 'none';
        }
    }

    // Forecast section
    const forecastProjectedEl = document.getElementById('forecast-projected');
    const forecastVsGoalEl = document.getElementById('forecast-vs-goal');
    if (forecastProjectedEl) {
        forecastProjectedEl.textContent = `$${Math.round(projectedTotal).toLocaleString()}`;
    }
    if (forecastVsGoalEl) {
        const forecastGap = projectedTotal - target;
        if (forecastGap >= 0) {
            forecastVsGoalEl.textContent = `+$${Math.round(forecastGap).toLocaleString()} over goal`;
            forecastVsGoalEl.style.color = '#27ae60';
        } else {
            forecastVsGoalEl.textContent = `-$${Math.abs(Math.round(forecastGap)).toLocaleString()} under goal`;
            forecastVsGoalEl.style.color = '#e74c3c';
        }
    }

    // Last year comparison
    const lastYearTotal = (data.mtdLastYear || 0) + (data.romLastYear || 0);
    const lastYearMtdEl = document.getElementById('last-year-mtd');
    const yoyChangeEl = document.getElementById('yoy-change');
    if (lastYearMtdEl) {
        lastYearMtdEl.textContent = `$${Math.round(data.mtdLastYear || 0).toLocaleString()}`;
    }
    if (yoyChangeEl) {
        const yoyDiff = current - (data.mtdLastYear || 0);
        const yoyPct = data.mtdLastYear > 0 ? ((current / data.mtdLastYear) - 1) * 100 : 0;
        if (yoyDiff >= 0) {
            yoyChangeEl.textContent = `+${yoyPct.toFixed(1)}% YoY`;
            yoyChangeEl.style.color = '#27ae60';
        } else {
            yoyChangeEl.textContent = `${yoyPct.toFixed(1)}% YoY`;
            yoyChangeEl.style.color = '#e74c3c';
        }
    }

    // Calculate and display daily targets
    updateDailyTargets(store, month, dailyTarget, daysRemaining);

    // Update 7-day chart
    updateSevenDayChart(store);
}

let sevenDayChartInstance = null;

function updateSevenDayChart(store) {
    const col = storeColumns[store];
    const ctx = document.getElementById('seven-day-chart');
    if (!ctx || !netsalesData) return;

    // Get last 7 days of data - sales and orders
    const sortedData = [];

    // Collect all sales data for this store
    netsalesData.forEach(row => {
        const dt = new Date(row[2]);
        if (isNaN(dt)) return;
        const sales = parseFloat((row[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
        if (sales > 0) {
            sortedData.push({ date: dt, dateStr: dt.toLocaleDateString('en-US'), sales: sales, orders: 0 });
        }
    });

    // Add orders data
    if (ordersData) {
        ordersData.forEach(row => {
            const dt = new Date(row[2]);
            if (isNaN(dt)) return;
            const orders = parseInt(row[col]) || 0;
            const dateStr = dt.toLocaleDateString('en-US');
            const existing = sortedData.find(d => d.dateStr === dateStr);
            if (existing) {
                existing.orders = orders;
            }
        });
    }

    // Sort by date descending and take last 7
    sortedData.sort((a, b) => b.date - a.date);
    const recentDays = sortedData.slice(0, 7).reverse();

    const labels = recentDays.map(d => d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'America/Denver' }));
    const salesData = recentDays.map(d => d.sales);
    const ordersDataArr = recentDays.map(d => d.orders);

    // Calculate summary stats
    const total = salesData.reduce((a, b) => a + b, 0);
    const avg = salesData.length > 0 ? total / salesData.length : 0;
    const best = Math.max(...salesData, 0);

    // Find the last same day of week (e.g., if today is Tuesday, find last Tuesday)
    const today = new Date();
    const todayDayOfWeek = today.getDay();
    let sameDayIndex = -1;

    for (let i = recentDays.length - 1; i >= 0; i--) {
        if (recentDays[i].date.getDay() === todayDayOfWeek) {
            sameDayIndex = i;
            break;
        }
    }

    // Update summary
    const totalEl = document.getElementById('seven-day-total');
    const avgEl = document.getElementById('seven-day-avg');
    const bestEl = document.getElementById('seven-day-best');
    if (totalEl) totalEl.textContent = `$${Math.round(total).toLocaleString()}`;
    if (avgEl) avgEl.textContent = `$${Math.round(avg).toLocaleString()}`;
    if (bestEl) bestEl.textContent = `$${Math.round(best).toLocaleString()}`;

    // Destroy existing chart
    if (sevenDayChartInstance) {
        sevenDayChartInstance.destroy();
    }

    // Create chart with dual axes
    sevenDayChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Sales',
                    type: 'bar',
                    data: salesData,
                    backgroundColor: salesData.map((val, i) => {
                        if (i === sameDayIndex) return '#c9a227';
                        return '#3498db';
                    }),
                    borderRadius: 6,
                    borderSkipped: false,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Orders',
                    type: 'line',
                    data: ordersDataArr,
                    borderColor: '#e74c3c',
                    backgroundColor: '#e74c3c',
                    pointStyle: 'circle',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    showLine: false,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label === 'Sales') {
                                return 'Sales: $' + context.raw.toLocaleString();
                            }
                            return 'Orders: ' + context.raw;
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    ticks: {
                        stepSize: 2000,
                        maxTicksLimit: 5,
                        callback: function(value) {
                            return '$' + (value / 1000).toFixed(0) + 'K';
                        },
                        font: { size: 10 }
                    },
                    grid: {
                        color: '#e0e0e0'
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    ticks: {
                        stepSize: 50,
                        maxTicksLimit: 5,
                        callback: function(value) {
                            return value;
                        },
                        font: { size: 10 }
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    title: {
                        display: true,
                        text: 'Orders',
                        font: { size: 9 }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: { size: 9 }
                    }
                }
            }
        }
    });

    // Update print-friendly HTML chart
    updatePrintChart(recentDays, sameDayIndex);
}

function updatePrintChart(recentDays, sameDayIndex) {
    const container = document.getElementById('print-chart-bars');
    if (!container) return;

    const maxSales = Math.max(...recentDays.map(d => d.sales), 1);
    const maxOrders = Math.max(...recentDays.map(d => d.orders), 1);

    let html = '';
    recentDays.forEach((day, i) => {
        const barHeight = Math.max((day.sales / maxSales) * 90, 4);
        const isHighlight = i === sameDayIndex;
        const label = day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
        const salesStr = '$' + (day.sales / 1000).toFixed(1) + 'K';
        const ordersStr = day.orders;

        html += `
            <div class="print-chart-bar-wrapper">
                <div class="print-chart-order-label">${ordersStr}</div>
                <div class="print-chart-dot" title="${day.orders} orders"></div>
                <div class="print-chart-bar ${isHighlight ? 'highlight' : ''}" style="height: ${barHeight}px;">
                    <span class="print-chart-bar-value">${salesStr}</span>
                </div>
                <div class="print-chart-bar-label">${label}</div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateDailyTargets(store, month, dailySalesTarget, daysRemaining) {
    const col = storeColumns[store];

    // Calculate current MTD AOV
    let totalSales = 0;
    let totalOrders = 0;

    if (netsalesData && ordersData) {
        for (let i = 0; i < netsalesData.length && i < ordersData.length; i++) {
            const sRow = netsalesData[i];
            const oRow = ordersData[i];
            const dt = new Date(sRow[2]);
            if (isNaN(dt) || dt.getFullYear() !== CURRENT_YEAR) continue;
            if (dt.toLocaleString('en-US', { month: 'long' }) !== month) continue;

            const sales = parseFloat((sRow[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
            const orders = parseFloat(oRow[col]) || 0;
            if (sales > 0 && orders > 0) {
                totalSales += sales;
                totalOrders += orders;
            }
        }
    }

    const currentAOV = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Calculate last year's AOV
    let lastYearSales = 0;
    let lastYearOrders = 0;

    if (netsalesData && ordersData) {
        for (let i = 0; i < netsalesData.length && i < ordersData.length; i++) {
            const sRow = netsalesData[i];
            const oRow = ordersData[i];
            const dt = new Date(sRow[2]);
            if (isNaN(dt) || dt.getFullYear() !== LAST_YEAR) continue;
            if (dt.toLocaleString('en-US', { month: 'long' }) !== month) continue;

            const sales = parseFloat((sRow[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
            const orders = parseFloat(oRow[col]) || 0;
            if (sales > 0 && orders > 0) {
                lastYearSales += sales;
                lastYearOrders += orders;
            }
        }
    }

    const lastYearAOV = lastYearOrders > 0 ? lastYearSales / lastYearOrders : 0;

    // Daily AOV target: 5% above last year, or current + $1 if no last year data
    const aovTarget = lastYearAOV > 0 ? lastYearAOV * 1.05 : (currentAOV > 0 ? currentAOV + 1 : 25);

    // Daily orders target: sales target / AOV target
    const dailyOrdersTarget = aovTarget > 0 ? Math.ceil(dailySalesTarget / aovTarget) : 0;

    // Update the big daily targets display
    const dailySalesEl = document.getElementById('daily-sales-target');
    const dailyOrdersEl = document.getElementById('daily-orders-target');
    const dailyAovEl = document.getElementById('daily-aov-target');

    if (dailySalesEl) dailySalesEl.textContent = `$${Math.round(dailySalesTarget).toLocaleString()}`;
    if (dailyOrdersEl) dailyOrdersEl.textContent = dailyOrdersTarget.toLocaleString();
    if (dailyAovEl) dailyAovEl.textContent = `$${aovTarget.toFixed(2)}`;

    // Also update hidden elements for print compatibility
    const targetDailyEl = document.getElementById('target-daily');
    const aovTargetEl = document.getElementById('aov-target');
    if (targetDailyEl) targetDailyEl.textContent = `$${Math.round(dailySalesTarget).toLocaleString()}`;
    if (aovTargetEl) aovTargetEl.textContent = `$${aovTarget.toFixed(2)}`;
}

function getMotivationalMessage(percentage, remaining, dailyTarget, aheadOfPace, daysRemaining, avgDaily) {
    // Check if goal is realistically attainable
    const stretchFactor = avgDaily > 0 ? dailyTarget / avgDaily : 1;
    const isUnrealistic = stretchFactor > 2 && daysRemaining <= 10;
    const isVeryUnrealistic = stretchFactor > 3 || (stretchFactor > 2 && daysRemaining <= 5);

    // No message if goal is out of reach
    if (isVeryUnrealistic || isUnrealistic) {
        return '';
    }

    if (percentage >= 100) {
        return "Goal achieved! Outstanding work - keep the momentum going!";
    } else if (percentage >= 90) {
        return `Almost there! Just $${remaining.toLocaleString()} to go - you've got this!`;
    } else if (aheadOfPace && percentage >= 75) {
        return `Crushing it! Ahead of pace with ${daysRemaining} days left. Keep it up!`;
    } else if (aheadOfPace) {
        return `Great start! You're ahead of pace. Today's target: $${Math.round(dailyTarget).toLocaleString()}`;
    } else if (percentage >= 75) {
        return `Strong position! Hit today's $${Math.round(dailyTarget).toLocaleString()} target to stay on track.`;
    } else if (percentage >= 50) {
        return `Let's pick up the pace! Today's target: $${Math.round(dailyTarget).toLocaleString()}`;
    } else if (daysRemaining > 15) {
        return `Plenty of time! Today's goal: $${Math.round(dailyTarget).toLocaleString()}.`;
    } else {
        return `Push time! Today's target: $${Math.round(dailyTarget).toLocaleString()} - make every sale count!`;
    }
}

/* -------------------------------------------------------------
   HISTORICAL DATE VIEW - Calculate data as of a specific date
   ------------------------------------------------------------- */

// Calculate MTD sales as of a specific date (up to but not including that date)
function calculateMTDAsOf(store, asOfDate) {
    const col = storeColumns[store];
    const month = asOfDate.toLocaleString('en-US', { month: 'long' });
    const year = asOfDate.getFullYear();
    const asOfDay = asOfDate.getDate();

    if (!netsalesData) return { mtd: 0, daysElapsed: 0 };

    let mtd = 0;
    let daysElapsed = 0;

    // Get MTD up to (not including) asOfDate - compare by date parts, not Date objects
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;
        if (d.getFullYear() !== year) return;
        if (d.toLocaleString('en-US', { month: 'long' }) !== month) return;

        // Compare by day of month - only include days BEFORE asOfDate
        if (d.getDate() >= asOfDay) return;

        const v = row[col];
        if (!v || v.toString().trim() === '') return;

        mtd += parseFloat(v.toString().replace(/[^0-9.-]+/g, '')) || 0;
        daysElapsed++;
    });

    return { mtd, daysElapsed };
}

// Calculate smart daily target using day-of-week weighted averages
function calculateSmartDailyTarget(store, viewDate, remaining$) {
    const col = storeColumns[store];
    const month = viewDate.toLocaleString('en-US', { month: 'long' });
    const year = viewDate.getFullYear();
    const monthIndex = viewDate.getMonth();
    const totalDaysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const viewDay = viewDate.getDate();
    const viewWeekday = viewDate.toLocaleString('en-US', { weekday: 'long' });

    // Count remaining days of each weekday (including viewDate)
    const remainingCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    for (let d = viewDay; d <= totalDaysInMonth; d++) {
        const date = new Date(year, monthIndex, d);
        const dayName = date.toLocaleString('en-US', { weekday: 'long' });
        remainingCount[dayName]++;
    }

    // Determine which year to use for averages (current year if ≥7 days of data, else last year)
    let daysWithData = 0;
    if (netsalesData) {
        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() < viewDay) {
                const val = row[col];
                if (val != null && val.toString().trim() !== '') daysWithData++;
            }
        });
    }

    const useCurrentYear = daysWithData >= 7;
    const sourceYear = useCurrentYear ? year : year - 1;

    // Calculate average sales per weekday
    const dayAverages = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    const dayCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };

    if (netsalesData) {
        netsalesData.forEach(row => {
            const d = new Date(row[2]);
            if (d.getFullYear() !== sourceYear) return;
            if (d.getMonth() !== monthIndex) return;
            // For current year, only include days before viewDate
            if (useCurrentYear && d.getDate() >= viewDay) return;

            const dayName = d.toLocaleString('en-US', { weekday: 'long' });
            const cell = row[col];
            const sales = (cell != null && cell.toString().trim() !== '')
                ? parseFloat(cell.toString().replace(/[^0-9.-]+/g, '')) || 0
                : 0;

            if (sales > 0) {
                dayAverages[dayName] += sales;
                dayCount[dayName]++;
            }
        });
    }

    // Convert totals to averages
    Object.keys(dayAverages).forEach(day => {
        dayAverages[day] = dayCount[day] > 0 ? dayAverages[day] / dayCount[day] : 0;
    });

    // Calculate total expected remaining sales
    let totalRemainingExpected = 0;
    Object.keys(remainingCount).forEach(day => {
        totalRemainingExpected += dayAverages[day] * remainingCount[day];
    });

    // Calculate this day's share and target
    const viewDayAvg = dayAverages[viewWeekday] || 0;
    const share = totalRemainingExpected > 0 ? viewDayAvg / totalRemainingExpected : 0;
    const calculatedTarget = remaining$ * share;

    // Return MAX of calculated target or the day's average
    return Math.max(calculatedTarget, viewDayAvg);
}

// Update progress ring for a specific view date (shows data as if going into that day)
function updateProgressRingForDate(store, viewDate) {
    const month = viewDate.toLocaleString('en-US', { month: 'long' });
    const year = viewDate.getFullYear();
    const monthIndex = viewDate.getMonth();
    const totalDaysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    // Calculate MTD up to (not including) viewDate
    const { mtd: current, daysElapsed } = calculateMTDAsOf(store, viewDate);

    // Days remaining from viewDate onward
    const dayOfMonth = viewDate.getDate();
    const daysRemaining = Math.max(0, totalDaysInMonth - dayOfMonth + 1);

    // Get monthly target and update goal selector
    const target = calculateGoalTarget(store, month) || 1;
    if (typeof loadGoalSelector === 'function') {
        loadGoalSelector(store, month);
    }

    // Calculate remaining to goal
    const remaining = Math.max(0, target - current);

    // Calculate SMART daily target using day-of-week weighted logic
    const dailyTarget = calculateSmartDailyTarget(store, viewDate, remaining);

    // Calculate pace (using simple linear for comparison)
    const daysBeforeViewDate = dayOfMonth - 1;
    const expectedAtPace = (target * daysBeforeViewDate) / totalDaysInMonth;
    const projectedTotal = daysElapsed > 0 ? (current / daysElapsed) * totalDaysInMonth : 0;

    // Pace status
    const aheadOfPace = current >= expectedAtPace;
    const percentage = Math.min(Math.round((current / target) * 100), 150);
    const displayPct = Math.min(percentage, 100);

    // Update main displays
    const pctEl = document.getElementById('progress-percentage');
    if (pctEl) {
        pctEl.textContent = `${percentage}%`;
        pctEl.style.color = percentage >= 100 ? '#c9a227' : (aheadOfPace ? '#27ae60' : '#e74c3c');
    }

    // Update MTD Sales display (the big number)
    const currentEl = document.getElementById('progress-current');
    if (currentEl) {
        currentEl.textContent = `$${Math.round(current).toLocaleString()}`;
        currentEl.style.color = aheadOfPace ? '#27ae60' : '#e74c3c';
    }

    // Update Monthly Goal display
    const goalEl = document.getElementById('progress-goal');
    if (goalEl) {
        goalEl.textContent = `$${Math.round(target).toLocaleString()}`;
    }

    const amountsEl = document.getElementById('progress-amounts');
    if (amountsEl) {
        amountsEl.textContent = `$${Math.round(current).toLocaleString()} / $${Math.round(target).toLocaleString()}`;
    }

    // Update print version
    const amountsPrintEl = document.getElementById('progress-amounts-print');
    if (amountsPrintEl) {
        amountsPrintEl.textContent = `$${Math.round(current).toLocaleString()} / $${Math.round(target).toLocaleString()}`;
    }

    // Progress ring
    const fillEl = document.getElementById('progress-ring-fill');
    if (fillEl) {
        const circumference = 2 * Math.PI * 70;
        const offset = circumference - (displayPct / 100) * circumference;
        fillEl.style.strokeDashoffset = offset;
        fillEl.classList.remove('warning', 'gold');
        if (percentage >= 100) fillEl.classList.add('gold');
        else if (!aheadOfPace) fillEl.classList.add('warning');
    }

    // Progress bar
    const barFillEl = document.getElementById('progress-bar-fill');
    if (barFillEl) {
        barFillEl.style.width = `${displayPct}%`;
        barFillEl.classList.remove('warning', 'gold');
        if (percentage >= 100) barFillEl.classList.add('gold');
        else if (!aheadOfPace) barFillEl.classList.add('warning');
    }

    // Today's Targets - Daily Sales Goal (the big one in dark banner)
    const dailySalesEl = document.getElementById('daily-sales-target');
    if (dailySalesEl) dailySalesEl.textContent = `$${Math.round(dailyTarget).toLocaleString()}`;

    // Also update hidden element for compatibility
    const targetDailyEl = document.getElementById('target-daily');
    if (targetDailyEl) targetDailyEl.textContent = `$${Math.round(dailyTarget).toLocaleString()}`;

    // Days Left
    const daysLeftEl = document.getElementById('target-days-left');
    if (daysLeftEl) daysLeftEl.textContent = daysRemaining;

    // Remaining to target (Left This Month)
    const remainingEl = document.getElementById('target-remaining');
    if (remainingEl) remainingEl.textContent = `$${Math.round(remaining).toLocaleString()}`;

    // Pace Status card
    const paceStatusEl = document.getElementById('pace-status');
    const paceStatusCard = document.getElementById('pace-status-card');
    const paceDetailEl = document.getElementById('pace-status-detail');
    if (paceStatusEl) {
        if (aheadOfPace) {
            paceStatusEl.textContent = 'On Track';
            paceStatusEl.style.color = '#27ae60';
            if (paceStatusCard) paceStatusCard.style.borderColor = '#27ae60';
        } else {
            const behindBy = Math.round(expectedAtPace - current);
            paceStatusEl.textContent = 'Behind';
            paceStatusEl.style.color = '#e74c3c';
            if (paceStatusCard) paceStatusCard.style.borderColor = '#e74c3c';
        }
    }
    if (paceDetailEl) {
        const diff = Math.round(current - expectedAtPace);
        paceDetailEl.textContent = diff >= 0 ? `+$${diff.toLocaleString()} vs pace` : `-$${Math.abs(diff).toLocaleString()} vs pace`;
    }

    // Progress bar labels
    const progressBarTarget = document.getElementById('progress-bar-target');
    if (progressBarTarget) progressBarTarget.textContent = `$${Math.round(target).toLocaleString()}`;

    const progressPaceLabel = document.getElementById('progress-pace-label');
    if (progressPaceLabel) {
        progressPaceLabel.textContent = `On pace for $${Math.round(projectedTotal).toLocaleString()}`;
    }

    // Motivational message
    const avgDaily = daysElapsed > 0 ? current / daysElapsed : 0;
    const msgEl = document.getElementById('motivational-message');
    if (msgEl) {
        const msg = getMotivationalMessage(percentage, remaining, dailyTarget, aheadOfPace, daysRemaining, avgDaily);
        if (msg) {
            msgEl.textContent = msg;
            msgEl.style.display = 'block';
        } else {
            msgEl.style.display = 'none';
        }
    }

    // Daily targets section (orders, AOV)
    updateDailyTargetsForDate(store, month, dailyTarget, daysRemaining, viewDate);

    // Year over year comparison
    updateYoYForDate(store, viewDate, current);

    // Update 7-day chart
    updateSevenDayChartForDate(store, viewDate);
}

function updateDailyTargetsForDate(store, month, dailySalesTarget, daysRemaining, viewDate) {
    const col = storeColumns[store];
    const year = viewDate.getFullYear();
    const viewDay = viewDate.getDate();
    const viewMonth = viewDate.getMonth();

    // Calculate MTD AOV up to viewDate
    let totalSales = 0;
    let totalOrders = 0;

    if (netsalesData && ordersData) {
        for (let i = 0; i < netsalesData.length && i < ordersData.length; i++) {
            const sRow = netsalesData[i];
            const oRow = ordersData[i];
            const dt = new Date(sRow[2]);
            if (isNaN(dt) || dt.getFullYear() !== year) continue;
            if (dt.getMonth() !== viewMonth) continue;
            // Compare by day - only include days BEFORE viewDate
            if (dt.getDate() >= viewDay) continue;

            const sales = parseFloat((sRow[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
            const orders = parseFloat(oRow[col]) || 0;
            if (sales > 0 && orders > 0) {
                totalSales += sales;
                totalOrders += orders;
            }
        }
    }

    const currentAOV = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Calculate order target
    const orderTarget = currentAOV > 0 ? Math.ceil(dailySalesTarget / currentAOV) : 0;
    const aovTarget = currentAOV > 0 ? currentAOV * 1.05 : 0;

    // Update UI - Daily Orders Target (in dark banner)
    const dailyOrdersEl = document.getElementById('daily-orders-target');
    if (dailyOrdersEl) dailyOrdersEl.textContent = orderTarget || '--';

    // Also update hidden element for compatibility
    const orderTargetEl = document.getElementById('target-orders');
    if (orderTargetEl) orderTargetEl.textContent = orderTarget || '--';

    // Daily AOV Target (in dark banner)
    const dailyAovEl = document.getElementById('daily-aov-target');
    if (dailyAovEl) dailyAovEl.textContent = `$${aovTarget.toFixed(2)}`;

    // Also update hidden element for compatibility
    const aovTargetEl = document.getElementById('target-aov');
    if (aovTargetEl) aovTargetEl.textContent = `$${aovTarget.toFixed(2)}`;
}

// Calculate Year-over-Year comparison for a specific date
function updateYoYForDate(store, viewDate, currentMTD) {
    const col = storeColumns[store];
    const lastYear = viewDate.getFullYear() - 1;
    const viewMonth = viewDate.getMonth();
    const viewDay = viewDate.getDate();

    if (!netsalesData) return;

    // Calculate last year's MTD up to the same day
    let lastYearMTD = 0;
    netsalesData.forEach(row => {
        const d = new Date(row[2]);
        if (isNaN(d)) return;
        if (d.getFullYear() !== lastYear) return;
        if (d.getMonth() !== viewMonth) return;
        if (d.getDate() >= viewDay) return;

        const v = row[col];
        if (!v || v.toString().trim() === '') return;
        lastYearMTD += parseFloat(v.toString().replace(/[^0-9.-]+/g, '')) || 0;
    });

    // Calculate YoY change
    const yoyChange = lastYearMTD > 0 ? ((currentMTD - lastYearMTD) / lastYearMTD) * 100 : 0;

    // Update UI
    const yoyEl = document.getElementById('yoy-change');
    if (yoyEl) {
        const sign = yoyChange >= 0 ? '+' : '';
        yoyEl.textContent = `${sign}${yoyChange.toFixed(1)}%`;
        yoyEl.style.color = yoyChange >= 0 ? '#27ae60' : '#e74c3c';
    }

    // Update label to show comparison period
    const yoyLabelEl = document.getElementById('yoy-label');
    if (yoyLabelEl) {
        const monthName = viewDate.toLocaleString('en-US', { month: 'short' });
        const throughDay = viewDay - 1;
        yoyLabelEl.textContent = `vs. ${lastYear} ${monthName} thru ${throughDay}`;
    }

    // Update last year MTD hidden element
    const lastYearMtdEl = document.getElementById('last-year-mtd');
    if (lastYearMtdEl) lastYearMtdEl.textContent = `$${Math.round(lastYearMTD).toLocaleString()}`;
}

// Update 7-day chart ending at the day before viewDate
function updateSevenDayChartForDate(store, viewDate) {
    const col = storeColumns[store];
    const ctx = document.getElementById('seven-day-chart');
    if (!ctx || !netsalesData) return;

    // Get 7 days of data BEFORE viewDate - create cutoff date at start of viewDate
    const sortedData = [];
    const viewYear = viewDate.getFullYear();
    const viewMonth = viewDate.getMonth();
    const viewDay = viewDate.getDate();

    // Helper to check if date is before viewDate
    function isBeforeViewDate(dt) {
        if (dt.getFullYear() < viewYear) return true;
        if (dt.getFullYear() > viewYear) return false;
        if (dt.getMonth() < viewMonth) return true;
        if (dt.getMonth() > viewMonth) return false;
        return dt.getDate() < viewDay;
    }

    // Collect all sales data for this store up to (not including) viewDate
    netsalesData.forEach(row => {
        const dt = new Date(row[2]);
        if (isNaN(dt)) return;
        if (!isBeforeViewDate(dt)) return; // Only include days before viewDate
        const sales = parseFloat((row[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
        if (sales > 0) {
            sortedData.push({ date: dt, dateStr: dt.toLocaleDateString('en-US'), sales: sales, orders: 0 });
        }
    });

    // Add orders data
    if (ordersData) {
        ordersData.forEach(row => {
            const dt = new Date(row[2]);
            if (isNaN(dt)) return;
            if (!isBeforeViewDate(dt)) return;
            const orders = parseInt(row[col]) || 0;
            const dateStr = dt.toLocaleDateString('en-US');
            const existing = sortedData.find(d => d.dateStr === dateStr);
            if (existing) {
                existing.orders = orders;
            }
        });
    }

    // Sort by date descending and take last 7
    sortedData.sort((a, b) => b.date - a.date);
    const recentDays = sortedData.slice(0, 7).reverse();

    const labels = recentDays.map(d => d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'America/Denver' }));
    const salesData = recentDays.map(d => d.sales);
    const ordersDataArr = recentDays.map(d => d.orders);

    // Find the same day of week as viewDate
    const viewDayOfWeek = viewDate.getDay();
    let sameDayIndex = -1;

    for (let i = recentDays.length - 1; i >= 0; i--) {
        if (recentDays[i].date.getDay() === viewDayOfWeek) {
            sameDayIndex = i;
            break;
        }
    }

    // Update summary
    const total = salesData.reduce((a, b) => a + b, 0);
    const avg = salesData.length > 0 ? total / salesData.length : 0;
    const best = Math.max(...salesData, 0);

    const totalEl = document.getElementById('seven-day-total');
    const avgEl = document.getElementById('seven-day-avg');
    const bestEl = document.getElementById('seven-day-best');
    if (totalEl) totalEl.textContent = `$${Math.round(total).toLocaleString()}`;
    if (avgEl) avgEl.textContent = `$${Math.round(avg).toLocaleString()}`;
    if (bestEl) bestEl.textContent = `$${Math.round(best).toLocaleString()}`;

    // Destroy existing chart
    if (sevenDayChartInstance) {
        sevenDayChartInstance.destroy();
    }

    // Create chart with dual axes
    sevenDayChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Sales',
                    type: 'bar',
                    data: salesData,
                    backgroundColor: salesData.map((val, i) => {
                        if (i === sameDayIndex) return '#c9a227';
                        return '#3498db';
                    }),
                    borderRadius: 6,
                    borderSkipped: false,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Orders',
                    type: 'line',
                    data: ordersDataArr,
                    borderColor: '#e74c3c',
                    backgroundColor: '#e74c3c',
                    pointStyle: 'circle',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: false,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label === 'Sales') {
                                return `Sales: $${context.raw.toLocaleString()}`;
                            } else {
                                return `Orders: ${context.raw}`;
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    ticks: {
                        stepSize: 500,
                        callback: function(value) {
                            return '$' + (value / 1000).toFixed(1) + 'K';
                        }
                    },
                    grid: { display: true }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    ticks: {
                        stepSize: 20
                    },
                    grid: { display: false }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    // Update print-friendly chart
    updatePrintChart(recentDays, sameDayIndex);
}

// Make functions available globally
window.updateProgressRingForDate = updateProgressRingForDate;
window.updateSevenDayChartForDate = updateSevenDayChartForDate;

/* -------------------------------------------------------------
   MANAGER UI - Quick Stats
   ------------------------------------------------------------- */
function updateQuickStats(store) {
    const month = document.getElementById('month-filter')?.value || '';
    const data = calculateSalesData(store, month);

    // Get last day's data for orders/AOV
    const lastDate = getLastDataDate(store, month);
    let lastDayOrders = 0;
    let lastDaySales = 0;

    if (lastDate && ordersData && netsalesData) {
        const col = storeColumns[store];
        const dateStr = lastDate.toLocaleDateString('en-US');

        for (const row of ordersData) {
            if (row[2] && new Date(row[2]).toLocaleDateString('en-US') === dateStr) {
                lastDayOrders = parseInt(row[col]) || 0;
                break;
            }
        }

        for (const row of netsalesData) {
            if (row[2] && new Date(row[2]).toLocaleDateString('en-US') === dateStr) {
                lastDaySales = parseFloat((row[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
                break;
            }
        }
    }

    const aov = lastDayOrders > 0 ? lastDaySales / lastDayOrders : 0;

    // Update UI
    const ordersEl = document.getElementById('stat-orders');
    if (ordersEl) ordersEl.textContent = lastDayOrders.toLocaleString();

    const aovEl = document.getElementById('stat-aov');
    if (aovEl) aovEl.textContent = `$${aov.toFixed(2)}`;

    const hoursEl = document.getElementById('stat-staff-hours');
    if (hoursEl) hoursEl.textContent = `${totalStaffingHours || 0}h`;
}

/* -------------------------------------------------------------
   MANAGER UI - Team Cards with Notes
   ------------------------------------------------------------- */
let currentScheduleDate = null;
let currentShifts = [];

async function renderTeamCards(store, scheduleDate, shifts) {
    currentScheduleDate = scheduleDate;
    currentShifts = shifts;

    const container = document.getElementById('team-list');
    const dateDisplay = document.getElementById('schedule-date-display');
    const totalsEl = document.getElementById('staff-totals');

    if (!container) return;

    // Update date display (Mountain Time)
    if (dateDisplay) {
        dateDisplay.textContent = scheduleDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'America/Denver'
        });
    }

    if (shifts.length === 0) {
        container.innerHTML = `
            <div class="no-schedule">
                <div class="no-schedule-icon">📅</div>
                <p>No shifts scheduled for this day</p>
            </div>
        `;
        if (totalsEl) totalsEl.style.display = 'none';
        return;
    }

    // Load existing notes
    const dateKey = formatDateLocal(scheduleDate);
    const notes = await NotesManager.loadNotes(store, dateKey);

    // Sort shifts by start time
    shifts.sort((a, b) => a.start.localeCompare(b.start));

    // Determine store hours for Gantt bar positioning
    const isWeekend = scheduleDate.getDay() === 0 || scheduleDate.getDay() === 6;
    let openHour, closeHour;
    if (store === "CAFE") {
        openHour = 7; closeHour = 15;
    } else if (store === "FEELLOVE") {
        if (isWeekend) { openHour = 7; closeHour = 16; }
        else { openHour = 6; closeHour = 19; }
    } else {
        openHour = 6; closeHour = 17;
    }
    const visibleStart = openHour - 1;
    const visibleEnd = closeHour + 1;
    const visibleHours = visibleEnd - visibleStart;

    // Render cards
    let html = '';
    let totalHours = 0;

    shifts.forEach(shift => {
        const shiftHours = calculateShiftHours(shift.start, shift.end);
        totalHours += shiftHours;

        const existingNote = notes.staff[shift.employee]?.note || '';
        const shiftTime = formatShiftTime(shift.start, shift.end);

        // Calculate Gantt bar position
        const [sh, sm] = shift.start.split(':').map(Number);
        const [eh, em] = shift.end.split(':').map(Number);
        const startDecimal = sh + sm/60;
        let endDecimal = eh + em/60;
        if (endDecimal < startDecimal) endDecimal += 24;

        let barLeft = ((startDecimal - visibleStart) / visibleHours) * 100;
        let barWidth = ((endDecimal - startDecimal) / visibleHours) * 100;
        if (barLeft < 0) { barWidth += barLeft; barLeft = 0; }
        if (barLeft + barWidth > 100) { barWidth = 100 - barLeft; }

        html += `
            <div class="staff-card">
                <div class="staff-header">
                    <span class="staff-name">${shift.employee}</span>
                    <div class="shift-gantt-bar" style="flex: 1; min-width: 200px; height: 32px; background: #e8e8e8; border-radius: 6px; position: relative; margin-left: 12px;">
                        <div style="position: absolute; left: ${barLeft}%; width: ${barWidth}%; height: 100%; background: linear-gradient(90deg, #3498db, #2980b9); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 0.85rem; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
                            ${shiftTime}
                        </div>
                    </div>
                    <button id="copy-btn-${sanitizeId(shift.employee)}" class="no-print"
                            onclick="copyStaffNoteFromPrevious('${shift.employee.replace(/'/g, "\\'")}')"
                            style="padding: 4px 8px; font-size: 0.75rem; background: #f8f8f8; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; color: #666; margin-left: 8px;"
                            title="Copy from previous note">↩</button>
                </div>
                <textarea class="staff-note-input"
                          id="note-${sanitizeId(shift.employee)}"
                          data-employee="${shift.employee}"
                          data-store="${store}"
                          data-date="${dateKey}"
                          placeholder="Add note for ${shift.employee}..."
                          onblur="saveStaffNote(this)">${existingNote}</textarea>
                <div class="note-status" id="status-${sanitizeId(shift.employee)}"></div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Update totals
    if (totalsEl) {
        totalsEl.style.display = 'flex';
        document.getElementById('total-staff-hours').textContent = `${totalHours.toFixed(1)}h`;
    }

    // Load day note
    loadDayNote(store, dateKey);
}

function sanitizeId(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
}

function calculateShiftHours(start, end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let hours = eh - sh + (em - sm) / 60;
    if (hours < 0) hours += 24;
    return hours;
}

function formatShiftTime(start, end) {
    const format = (t) => {
        let [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
    };
    return `${format(start)} - ${format(end)}`;
}

async function saveStaffNote(textarea) {
    const employee = textarea.dataset.employee;
    const store = textarea.dataset.store;
    const date = textarea.dataset.date;
    const note = textarea.value;

    const statusEl = document.getElementById(`status-${sanitizeId(employee)}`);
    if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.className = 'note-status saving';
    }

    const success = await NotesManager.saveStaffNote(store, date, employee, note);

    if (statusEl) {
        statusEl.textContent = success ? 'Saved' : 'Error saving';
        statusEl.className = success ? 'note-status saved' : 'note-status';
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'note-status';
        }, 2000);
    }
}

async function loadDayNote(store, dateKey) {
    const textarea = document.getElementById('day-note-input');
    if (!textarea) return;

    const notes = await NotesManager.loadNotes(store, dateKey);
    textarea.value = notes.dayNote || '';

    // Store current context
    textarea.dataset.store = store;
    textarea.dataset.date = dateKey;
}

// Day note save handler
document.getElementById('day-note-input')?.addEventListener('blur', async function() {
    const store = this.dataset.store;
    const date = this.dataset.date;
    const note = this.value;

    if (!store || !date) return;

    const statusEl = document.getElementById('day-note-status');
    if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.className = 'note-status saving';
    }

    const success = await NotesManager.saveDayNote(store, date, note);

    if (statusEl) {
        statusEl.textContent = success ? 'Saved' : 'Error saving';
        statusEl.className = success ? 'note-status saved' : 'note-status';
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'note-status';
        }, 2000);
    }
});

function generatePrintableChart(store) {
    const col = storeColumns[store];
    if (!netsalesData) return '';

    // Get last 7 days of data
    const sortedData = [];
    netsalesData.forEach(row => {
        const dt = new Date(row[2]);
        if (isNaN(dt)) return;
        const sales = parseFloat((row[col] + '').replace(/[^0-9.-]+/g, '')) || 0;
        if (sales > 0) {
            sortedData.push({ date: dt, sales: sales });
        }
    });

    sortedData.sort((a, b) => b.date - a.date);
    const recentDays = sortedData.slice(0, 7).reverse();

    if (recentDays.length === 0) return '<p>No recent data</p>';

    const maxSales = Math.max(...recentDays.map(d => d.sales));
    const best = Math.max(...recentDays.map(d => d.sales));

    let html = '<div style="display: flex; align-items: flex-end; justify-content: space-around; height: 100px; gap: 8px; margin-bottom: 8px;">';

    recentDays.forEach(d => {
        const heightPct = (d.sales / maxSales) * 100;
        const isBest = d.sales === best;
        const dayLabel = d.date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Denver' });
        const color = isBest ? '#c9a227' : '#3498db';

        html += `
            <div style="flex: 1; text-align: center;">
                <div style="font-size: 8pt; margin-bottom: 2px;">$${Math.round(d.sales / 1000)}K</div>
                <div style="height: ${heightPct}px; background: ${color}; border-radius: 4px 4px 0 0; min-height: 10px;"></div>
                <div style="font-size: 8pt; margin-top: 4px;">${dayLabel}</div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/* -------------------------------------------------------------
   MANAGER UI - Print Dashboard (Updated)
   ------------------------------------------------------------- */
function printDashboard() {
    // Resize chart for print dimensions before printing
    if (sevenDayChartInstance) {
        sevenDayChartInstance.resize();
    }

    // Small delay to let chart redraw, then print
    setTimeout(() => {
        window.print();
    }, 100);
}

// Handle print events to resize chart properly
window.addEventListener('beforeprint', () => {
    if (sevenDayChartInstance) {
        sevenDayChartInstance.resize();
    }
});

window.addEventListener('afterprint', () => {
    if (sevenDayChartInstance) {
        sevenDayChartInstance.resize();
    }
});

function printDashboard_OLD() {
    const store = document.getElementById('store-filter').value;
    const storeName = document.getElementById('store-filter').options[document.getElementById('store-filter').selectedIndex].text;

    const scheduleDate = currentScheduleDate
        ? currentScheduleDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'Today';

    // Collect staff notes with Gantt bars
    let staffNotesHTML = '';
    if (currentShifts.length > 0) {
        // Determine store hours for Gantt positioning
        const isWeekend = currentScheduleDate ? (currentScheduleDate.getDay() === 0 || currentScheduleDate.getDay() === 6) : false;
        let openHour, closeHour;
        if (store === "CAFE") { openHour = 7; closeHour = 15; }
        else if (store === "FEELLOVE") { openHour = isWeekend ? 7 : 6; closeHour = isWeekend ? 16 : 19; }
        else { openHour = 6; closeHour = 17; }
        const visibleStart = openHour - 1;
        const visibleEnd = closeHour + 1;
        const visibleHours = visibleEnd - visibleStart;

        staffNotesHTML = '<table class="print-staff-table"><thead><tr><th style="width:20%;">Name</th><th style="width:35%;">Shift</th><th style="width:45%;">Notes</th></tr></thead><tbody>';
        currentShifts.forEach(shift => {
            const noteEl = document.getElementById(`note-${sanitizeId(shift.employee)}`);
            const note = noteEl ? noteEl.value : '';
            const shiftTime = formatShiftTime(shift.start, shift.end);
            const shiftHours = calculateShiftHours(shift.start, shift.end);

            // Calculate Gantt bar
            const [sh, sm] = shift.start.split(':').map(Number);
            const [eh, em] = shift.end.split(':').map(Number);
            const startDecimal = sh + sm/60;
            let endDecimal = eh + em/60;
            if (endDecimal < startDecimal) endDecimal += 24;
            let barLeft = ((startDecimal - visibleStart) / visibleHours) * 100;
            let barWidth = ((endDecimal - startDecimal) / visibleHours) * 100;
            if (barLeft < 0) { barWidth += barLeft; barLeft = 0; }
            if (barLeft + barWidth > 100) { barWidth = 100 - barLeft; }

            const ganttBar = `
                <div style="background: #e0e0e0; height: 24px; border-radius: 4px; position: relative; width: 100%;">
                    <div style="position: absolute; left: ${barLeft}%; width: ${barWidth}%; height: 100%; background: #3498db; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 9pt; font-weight: bold;">
                        ${shiftTime}
                    </div>
                </div>
            `;

            staffNotesHTML += `<tr><td><strong>${shift.employee}</strong></td><td>${ganttBar}</td><td>${note || '<em>(No notes)</em>'}</td></tr>`;
        });
        staffNotesHTML += '</tbody></table>';
    } else {
        staffNotesHTML = '<p style="text-align: center; color: #666;">No shifts scheduled</p>';
    }

    // Get day note
    const dayNote = document.getElementById('day-note-input')?.value || '';

    // Get progress info
    const progressPct = document.getElementById('progress-percentage')?.textContent || '--%';
    const progressAmounts = document.getElementById('progress-amounts')?.textContent || '';
    const motivationalMsg = document.getElementById('motivational-message')?.textContent || '';

    // Get 7-day summary
    const sevenDayTotal = document.getElementById('seven-day-total')?.textContent || '$0';
    const sevenDayAvg = document.getElementById('seven-day-avg')?.textContent || '$0';
    const sevenDayBest = document.getElementById('seven-day-best')?.textContent || '$0';
    const staffHours = totalStaffingHours ? `${totalStaffingHours}h` : '--';

    // Generate 7-day chart HTML for print
    const sevenDayChartHTML = generatePrintableChart(store);

    // Get target cards
    const targetRemaining = document.getElementById('target-remaining')?.textContent || '$0';
    const targetDaily = document.getElementById('target-daily')?.textContent || '$0';
    const targetDaysLeft = document.getElementById('target-days-left')?.textContent || '0';
    const paceStatus = document.getElementById('pace-status')?.textContent || '--';
    const paceStatusDetail = document.getElementById('pace-status-detail')?.textContent || '';

    // Get daily targets
    const dailySalesTarget = document.getElementById('daily-sales-target')?.textContent || '$0';
    const dailyOrdersTarget = document.getElementById('daily-orders-target')?.textContent || '0';
    const dailyAovTarget = document.getElementById('daily-aov-target')?.textContent || '$0';
    const yoyChange = document.getElementById('yoy-change')?.textContent || '--';

    // Get main progress
    const progressCurrent = document.getElementById('progress-current')?.textContent || '$0';
    const progressGoal = document.getElementById('progress-goal')?.textContent || '$0';

    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${storeName} - ${scheduleDate}</title>
            <style>
                @page { size: letter landscape; margin: 0.25in; }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html, body {
                    height: 100%;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                    background: white; color: #333;
                    -webkit-print-color-adjust: exact; print-color-adjust: exact;
                }
                body {
                    display: flex;
                    flex-direction: column;
                    height: 8in;
                }

                /* Header */
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 3px solid #333;
                    padding-bottom: 6px;
                    margin-bottom: 10px;
                }
                .header h1 { font-size: 20pt; }
                .header .date { font-size: 13pt; font-weight: 600; }

                /* Top row: Targets + Chart side by side */
                .top-row {
                    display: flex;
                    gap: 12px;
                    margin-bottom: 10px;
                }

                /* Targets section */
                .targets-section {
                    flex: 1;
                    background: linear-gradient(135deg, #2c3e50, #34495e);
                    border-radius: 10px;
                    padding: 16px;
                    color: white;
                }
                .targets-title { font-size: 11pt; opacity: 0.9; margin-bottom: 10px; text-align: center; }
                .targets-grid {
                    display: flex;
                    justify-content: space-around;
                    margin-bottom: 14px;
                }
                .target { text-align: center; }
                .target-value { font-size: 24pt; font-weight: 700; }
                .target-label { font-size: 9pt; opacity: 0.8; }
                .progress-row {
                    display: flex;
                    justify-content: space-around;
                    padding-top: 10px;
                    border-top: 1px solid rgba(255,255,255,0.2);
                }
                .progress-item { text-align: center; }
                .progress-value { font-size: 14pt; font-weight: 600; }
                .progress-label { font-size: 8pt; opacity: 0.7; }

                /* Chart section */
                .chart-section {
                    flex: 1.5;
                    border: 2px solid #333;
                    border-radius: 8px;
                    padding: 10px;
                }
                .chart-title { font-size: 11pt; font-weight: bold; margin-bottom: 6px; }
                .chart-container { height: 90px; }
                .chart-summary {
                    display: flex;
                    justify-content: space-around;
                    padding-top: 6px;
                    border-top: 1px solid #eee;
                    font-size: 9pt;
                }

                /* Bottom row: Team + Notes side by side */
                .bottom-row {
                    flex: 1;
                    display: flex;
                    gap: 12px;
                    min-height: 0;
                }

                /* Team section */
                .team-section {
                    flex: 2;
                    border: 2px solid #333;
                    border-radius: 8px;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                }
                .section-title {
                    font-size: 12pt;
                    font-weight: bold;
                    border-bottom: 2px solid #333;
                    padding-bottom: 5px;
                    margin-bottom: 8px;
                }
                .staff-grid {
                    flex: 1;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                    align-content: stretch;
                }
                .staff-card {
                    border: 1px solid #888;
                    border-left: 4px solid #333;
                    border-radius: 5px;
                    padding: 8px;
                    display: flex;
                    flex-direction: column;
                }
                .staff-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 5px;
                }
                .staff-name { font-weight: bold; font-size: 10pt; min-width: 85px; }
                .gantt-container {
                    flex: 1;
                    background: #e0e0e0;
                    height: 20px;
                    border-radius: 4px;
                    position: relative;
                }
                .gantt-bar {
                    position: absolute;
                    height: 100%;
                    background: linear-gradient(90deg, #3498db, #2980b9);
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 8pt;
                    font-weight: 600;
                }
                .staff-note {
                    flex: 1;
                    background: #f8f8f8;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    padding: 5px;
                    font-size: 9pt;
                    min-height: 20px;
                }
                .staff-note.empty { color: #999; font-style: italic; }
                .staff-totals {
                    margin-top: 6px;
                    padding: 6px 10px;
                    background: #e8e8e8;
                    border-radius: 4px;
                    font-weight: 600;
                    font-size: 10pt;
                    display: flex;
                    justify-content: space-between;
                }

                /* Notes section */
                .notes-section {
                    flex: 1;
                    border: 2px solid #333;
                    border-radius: 8px;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                }
                .day-notes {
                    flex: 1;
                    background: #f8f8f8;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                    padding: 10px;
                    font-size: 10pt;
                    line-height: 1.4;
                }
                .day-notes.empty { color: #999; font-style: italic; }

                /* Signature */
                .signature-row {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 10px;
                    padding-top: 8px;
                    border-top: 2px solid #333;
                }
                .signature-field { width: 35%; }
                .signature-field label { font-size: 9pt; color: #666; display: block; margin-bottom: 3px; }
                .signature-field .line { border-bottom: 2px solid #333; height: 20px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${storeName}</h1>
                <div class="date">${scheduleDate}</div>
            </div>

            <div class="top-row">
                <div class="targets-section">
                    <div class="targets-title">Today's Targets</div>
                    <div class="targets-grid">
                        <div class="target">
                            <div class="target-value">${dailySalesTarget}</div>
                            <div class="target-label">Sales Goal</div>
                        </div>
                        <div class="target">
                            <div class="target-value">${dailyOrdersTarget}</div>
                            <div class="target-label">Orders Goal</div>
                        </div>
                        <div class="target">
                            <div class="target-value">${dailyAovTarget}</div>
                            <div class="target-label">AOV Goal</div>
                        </div>
                    </div>
                    <div class="progress-row">
                        <div class="progress-item">
                            <div class="progress-value">${progressPct}</div>
                            <div class="progress-label">of goal</div>
                        </div>
                        <div class="progress-item">
                            <div class="progress-value">${progressCurrent}</div>
                            <div class="progress-label">MTD</div>
                        </div>
                        <div class="progress-item">
                            <div class="progress-value">${targetRemaining}</div>
                            <div class="progress-label">remaining</div>
                        </div>
                        <div class="progress-item">
                            <div class="progress-value">${targetDaysLeft}</div>
                            <div class="progress-label">days left</div>
                        </div>
                    </div>
                </div>

                <div class="chart-section">
                    <div class="chart-title">Last 7 Days</div>
                    <div class="chart-container">${sevenDayChartHTML}</div>
                    <div class="chart-summary">
                        <div><strong>${sevenDayTotal}</strong> Total</div>
                        <div><strong>${sevenDayAvg}</strong> Avg/Day</div>
                        <div><strong>${sevenDayBest}</strong> Best</div>
                        <div><strong>${staffHours}</strong> Staff Hrs</div>
                    </div>
                </div>
            </div>

            <div class="bottom-row">
                <div class="team-section">
                    <div class="section-title">Today's Team</div>
                    <div class="staff-grid">
                        ${currentShifts.map(shift => {
                            const noteEl = document.getElementById('note-' + sanitizeId(shift.employee));
                            const note = noteEl ? noteEl.value : '';
                            const shiftTime = formatShiftTime(shift.start, shift.end);

                            const isWeekend = currentScheduleDate ? (currentScheduleDate.getDay() === 0 || currentScheduleDate.getDay() === 6) : false;
                            let openHour, closeHour;
                            if (store === "CAFE") { openHour = 7; closeHour = 15; }
                            else if (store === "FEELLOVE") { openHour = isWeekend ? 7 : 6; closeHour = isWeekend ? 16 : 19; }
                            else { openHour = 6; closeHour = 17; }
                            const visibleStart = openHour - 1;
                            const visibleEnd = closeHour + 1;
                            const visibleHours = visibleEnd - visibleStart;

                            const [sh, sm] = shift.start.split(':').map(Number);
                            const [eh, em] = shift.end.split(':').map(Number);
                            const startDecimal = sh + sm/60;
                            let endDecimal = eh + em/60;
                            if (endDecimal < startDecimal) endDecimal += 24;
                            let barLeft = ((startDecimal - visibleStart) / visibleHours) * 100;
                            let barWidth = ((endDecimal - startDecimal) / visibleHours) * 100;
                            if (barLeft < 0) { barWidth += barLeft; barLeft = 0; }
                            if (barLeft + barWidth > 100) { barWidth = 100 - barLeft; }

                            return '<div class="staff-card">' +
                                '<div class="staff-header">' +
                                    '<span class="staff-name">' + shift.employee + '</span>' +
                                    '<div class="gantt-container">' +
                                        '<div class="gantt-bar" style="left:' + barLeft + '%;width:' + barWidth + '%;">' + shiftTime + '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="staff-note ' + (note ? '' : 'empty') + '">' + (note || 'Notes:') + '</div>' +
                            '</div>';
                        }).join('')}
                    </div>
                    <div class="staff-totals">
                        <span>Total Staff Hours</span>
                        <span>${staffHours}</span>
                    </div>
                </div>

                <div class="notes-section">
                    <div class="section-title">Daily Notes</div>
                    <div class="day-notes ${dayNote ? '' : 'empty'}">${dayNote || 'Notes, reminders, focus areas...'}</div>
                </div>
            </div>

            <div class="signature-row">
                <div class="signature-field">
                    <label>Manager Signature</label>
                    <div class="line"></div>
                </div>
                <div class="signature-field">
                    <label>Date</label>
                    <div class="line"></div>
                </div>
            </div>
        </body>
        </html>
    `;

    const printWin = window.open('', '_blank', 'width=800,height=1000');
    printWin.document.write(printHTML);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 400);
}