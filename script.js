// ឈ្មោះខែជាភាសាខ្មែរ
const KHMER_MONTHS = {
  '01': 'មករា', '02': 'កុម្ភៈ', '03': 'មីនា', '04': 'មេសា',
  '05': 'ឧសភា', '06': 'មិថុនា', '07': 'កក្កដា', '08': 'សីហា',
  '09': 'កញ្ញា', '10': 'តុលា', '11': 'វិច្ឆិកា', '12': 'ធ្នូ'
};

// បង្ហាញជាទម្រង់៖ ខែសីហា ឆ្នាំ2026
function formatKhmerMonthYear(monthStr) {
  if (!monthStr || !monthStr.includes('-')) return '';
  const [year, month] = monthStr.split('-');
  return `ខែ${KHMER_MONTHS[month] || month} ឆ្នាំ${year}`;
}

// TAB 1 Data
const initialLedgerData = [
  { id: 1, date: '2026-08-01', label: 'ថវិកានៅសល់', incUsd: '', incKhr: '20000000', expUsd: '', expKhr: '', isOpening: false }
];

// TAB 2 Data (លុប Vendor ចេញ)
const initialInvoiceData = [
  { id: 1, date: '2026-08-01', invNo: 'INV-001', label: 'ថ្លៃអាហារទទួលភ្ញៀវប្រតិភូ', amountUsd: '120', amountKhr: '', receiptUrl: '' }
];

let currentActiveTab = 'ledger';
let ledgerData = JSON.parse(localStorage.getItem('pac_ledger_data')) || initialLedgerData;
let invoiceData = JSON.parse(localStorage.getItem('pac_invoice_data')) || initialInvoiceData;

// User Roles, PINs & Authentication ('editor' | 'viewer')
let currentUserRole = localStorage.getItem('pac_user_role') || 'viewer';
let isAppLoggedIn = false;
let selectedPortalRole = 'viewer';
const DEFAULT_PINS = {
  viewer: '1111',
  editor: '123455'
};
let currentAuthUser = null;
let currentActiveReceiptInvoiceId = null;
let currentReceiptZoom = 1;

// Executive Financial Charts State
let monthlyTrendsChart = null;
let summaryDoughnutChart = null;
let currentChartCurrency = 'USD';

// Supabase Cloud State
let supabaseClient = null;
let isSupabaseConnected = false;
let realtimeSubscription = null;
const syncDebounceTimers = {};

function getSelectedMonthStr() {
  const mSelect = document.getElementById('month-select');
  const ySelect = document.getElementById('year-select');
  if (mSelect && ySelect) {
    return `${ySelect.value}-${mSelect.value}`;
  }
  return new Date().toISOString().slice(0, 7);
}

function setSelectedMonthStr(monthStr) {
  if (!monthStr) return;
  const [year, month] = monthStr.split('-');
  const mSelect = document.getElementById('month-select');
  const ySelect = document.getElementById('year-select');
  if (mSelect) mSelect.value = month;
  if (ySelect) ySelect.value = year;
}

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const currentMonth = today.toISOString().slice(0, 7);

  setSelectedMonthStr(currentMonth);

  ensureMonthlyOpeningBalance(currentMonth);
  renderTable();
  renderInvoiceTable();

  // ពេលផ្លាស់ប្តូរ ខែ ឬ ឆ្នាំ
  const mSelect = document.getElementById('month-select');
  const ySelect = document.getElementById('year-select');
  const onMonthOrYearChange = () => {
    const sel = getSelectedMonthStr();
    ensureMonthlyOpeningBalance(sel);
    renderTable();
    renderInvoiceTable();
    if (typeof updateFinancialCharts === 'function') updateFinancialCharts();
  };

  if (mSelect) mSelect.addEventListener('change', onMonthOrYearChange);
  if (ySelect) ySelect.addEventListener('change', onMonthOrYearChange);

  // Bind Events
  bindEvent('btn-manual-save', 'click', manualSave);
  bindEvent('btn-close-month', 'click', closeCurrentMonth);
  bindEvent('btn-add-table', 'click', addNewRow);
  bindEvent('btn-export-pdf', 'click', exportToPDF);
  bindEvent('table-search', 'keyup', filterTable);
  bindEvent('inv-table-search', 'keyup', filterInvoiceTable);

  // Shortcut Ctrl + S
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      manualSave();
    }
  });

  // Enter to Navigate Row Below
  document.addEventListener('keydown', handleTableEnterNavigation);

  // Initialize Supabase in background
  initSupabase();

  // Initialize Financial Charts
  initFinancialCharts();

  // Initialize Login Session & RBAC
  checkLoginSession();

  // Close modals on backdrop click
  ['supabase-modal', 'receipt-modal', 'auth-modal', 'close-month-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          if (id === 'supabase-modal') closeSupabaseModal();
          else if (id === 'receipt-modal') closeReceiptModal();
          else if (id === 'auth-modal') closeAuthModal();
          else if (id === 'close-month-modal') closeCloseMonthModal();
        }
      });
    }
  });
});

function bindEvent(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
}

async function manualSave() {
  localStorage.setItem('pac_ledger_data', JSON.stringify(ledgerData));
  localStorage.setItem('pac_invoice_data', JSON.stringify(invoiceData));

  if (isSupabaseConnected && supabaseClient) {
    try {
      const ledgerPayloads = ledgerData.map(mapLedgerToSupabase);
      const invoicePayloads = invoiceData.map(mapInvoiceToSupabase);
      if (ledgerPayloads.length > 0) {
        await supabaseClient.from('pac_ledger').upsert(ledgerPayloads, { onConflict: 'id' });
      }
      if (invoicePayloads.length > 0) {
        await supabaseClient.from('pac_invoices').upsert(invoicePayloads, { onConflict: 'id' });
      }
    } catch (err) {
      console.warn('Manual save to Supabase warning:', err);
    }
  }
  showSaveToast();
}

function showSaveToast(customMsg) {
  let toast = document.getElementById('save-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'save-toast';
    toast.className = 'fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-50 text-sm font-semibold transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-none';
    document.body.appendChild(toast);
  }
  const cloudBadge = isSupabaseConnected
    ? '<span class="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">Cloud</span>'
    : '<span class="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">Local</span>';
  toast.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400 text-lg"></i> <span>${customMsg || 'បានរក្សាទុកទិន្នន័យដោយជោគជ័យ!'}</span> ${cloudBadge}`;
  toast.classList.remove('translate-y-10', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
  }, 2200);
}

function handleTableEnterNavigation(e) {
  if (e.key !== 'Enter') return;
  const target = e.target;
  if (!target || !target.classList.contains('cell-input')) return;

  const currentTd = target.closest('td');
  const currentTr = target.closest('tr');
  if (!currentTd || !currentTr) return;

  const cellIndex = Array.from(currentTr.children).indexOf(currentTd);
  const nextTr = currentTr.nextElementSibling;

  if (nextTr) {
    const nextCell = nextTr.children[cellIndex];
    if (nextCell) {
      const nextInput = nextCell.querySelector('input');
      if (nextInput && !nextInput.disabled) {
        e.preventDefault();
        nextInput.focus();
        if (typeof nextInput.select === 'function') nextInput.select();
      }
    }
  } else {
    e.preventDefault();
    if (currentTr.closest('#ledger-body')) {
      addNewRow();
    } else if (currentTr.closest('#invoice-body')) {
      addInvoiceRow();
    }
    setTimeout(() => {
      const tbody = currentTr.closest('tbody');
      const newRows = tbody.querySelectorAll('tr');
      const lastRow = newRows[newRows.length - 1];
      if (lastRow && lastRow.children[cellIndex]) {
        const input = lastRow.children[cellIndex].querySelector('input');
        if (input) input.focus();
      }
    }, 50);
  }
}

function switchTab(tabName) {
  currentActiveTab = tabName;
  const ledgerContent = document.getElementById('tab-content-ledger');
  const invoiceContent = document.getElementById('tab-content-invoices');
  const stickyLedger = document.getElementById('sticky-header-ledger');
  const stickyInvoices = document.getElementById('sticky-header-invoices');

  const btnLedger = document.getElementById('tab-btn-ledger');
  const btnInvoices = document.getElementById('tab-btn-invoices');

  if (tabName === 'ledger') {
    if (ledgerContent) ledgerContent.classList.remove('hidden');
    if (invoiceContent) invoiceContent.classList.add('hidden');
    if (stickyLedger) stickyLedger.classList.remove('hidden');
    if (stickyInvoices) stickyInvoices.classList.add('hidden');
    if (btnLedger) btnLedger.className = "px-4 py-2 text-xs md:text-sm font-bold rounded-xl transition flex items-center gap-2 bg-blue-600 text-white shadow cursor-pointer";
    if (btnInvoices) btnInvoices.className = "px-4 py-2 text-xs md:text-sm font-bold text-slate-300 hover:text-white rounded-xl transition flex items-center gap-2 cursor-pointer";
  } else {
    if (ledgerContent) ledgerContent.classList.add('hidden');
    if (invoiceContent) invoiceContent.classList.remove('hidden');
    if (stickyLedger) stickyLedger.classList.add('hidden');
    if (stickyInvoices) stickyInvoices.classList.remove('hidden');
    if (btnInvoices) btnInvoices.className = "px-4 py-2 text-xs md:text-sm font-bold rounded-xl transition flex items-center gap-2 bg-amber-600 text-white shadow cursor-pointer";
    if (btnLedger) btnLedger.className = "px-4 py-2 text-xs md:text-sm font-bold text-slate-300 hover:text-white rounded-xl transition flex items-center gap-2 cursor-pointer";
  }
}

function formatDisplayAmount(val, currency) {
  if (val === '' || val === null || val === undefined) return '';
  const num = parseFloat(val);
  if (isNaN(num) || num === 0) return '';
  return currency === 'KHR' ? num.toLocaleString('en-US') + '៛' : '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* --- LOGIC TAB 1: បញ្ជីចំណូល-ចំណាយ --- */
function getPreviousMonthStr(currentMonthStr) {
  if (!currentMonthStr) return '';
  const [year, month] = currentMonthStr.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthEndingBalance(monthStr) {
  const monthData = ledgerData.filter(d => d.date && d.date.startsWith(monthStr));
  let runningUsd = 0, runningKhr = 0;
  monthData.forEach(r => {
    runningUsd += ((parseFloat(r.incUsd) || 0) - (parseFloat(r.expUsd) || 0));
    runningKhr += ((parseFloat(r.incKhr) || 0) - (parseFloat(r.expKhr) || 0));
  });
  return { usd: runningUsd, khr: runningKhr };
}

function ensureMonthlyOpeningBalance(currentMonthStr) {
  if (!currentMonthStr) return;
  const prevMonthStr = getPreviousMonthStr(currentMonthStr);
  const prevEnding = getMonthEndingBalance(prevMonthStr);
  if (prevEnding.usd === 0 && prevEnding.khr === 0) return;

  const existingIndex = ledgerData.findIndex(d => d.date && d.date.startsWith(currentMonthStr) && d.isOpening === true);
  const openingLabel = `ថវិកានៅសល់ពី${formatKhmerMonthYear(prevMonthStr)}`;

  if (existingIndex !== -1) {
    ledgerData[existingIndex].incUsd = prevEnding.usd > 0 ? String(prevEnding.usd) : '';
    ledgerData[existingIndex].incKhr = prevEnding.khr > 0 ? String(prevEnding.khr) : '';
  } else {
    const newId = ledgerData.length ? Math.max(...ledgerData.map(d => d.id)) + 1 : 1;
    ledgerData.unshift({
      id: newId, date: `${currentMonthStr}-01`, label: openingLabel,
      incUsd: prevEnding.usd > 0 ? String(prevEnding.usd) : '',
      incKhr: prevEnding.khr > 0 ? String(prevEnding.khr) : '',
      expUsd: '', expKhr: '', isOpening: true
    });
  }
}

function getSelectedMonthData() {
  const selectedMonth = getSelectedMonthStr();
  return selectedMonth ? ledgerData.filter(item => item.date && item.date.startsWith(selectedMonth)) : ledgerData;
}

function renderTable() {
  const tbody = document.getElementById('ledger-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const selectedMonth = getSelectedMonthStr();
  updateElementText('current-selected-month', selectedMonth ? `(${formatKhmerMonthYear(selectedMonth)})` : '');

  const filteredData = getSelectedMonthData();
  let expenseRowCounter = 0;

  filteredData.forEach((row) => {
    const tr = document.createElement('tr');

    const hasIncome = (parseFloat(row.incUsd) > 0 || parseFloat(row.incKhr) > 0);
    const isIncomeType = (row.label && row.label.includes('ចំណូល')) || hasIncome;
    const hasExpense = (parseFloat(row.expUsd) > 0 || parseFloat(row.expKhr) > 0);
    const isBlankRow = !row.label && !hasIncome && !hasExpense && !row.isOpening;

    let rowNumber = '';

    if (row.isOpening) {
      tr.className = "bg-amber-100/70 border-b border-amber-200 font-semibold";
    } else if (isIncomeType) {
      tr.className = "bg-emerald-100 hover:bg-emerald-200/70 border-b border-emerald-300 transition-colors font-medium";
    } else if (isBlankRow) {
      tr.className = "hover:bg-slate-50 border-b border-slate-200 transition-colors";
    } else {
      expenseRowCounter++;
      rowNumber = expenseRowCounter;
      tr.className = "hover:bg-slate-50 border-b border-slate-200 transition-colors";
    }

    tr.id = `row-${row.id}`;

    const incUsdHighlight = row.incUsd ? 'bg-emerald-200/80 text-emerald-900 font-bold rounded' : 'text-emerald-700 font-semibold';
    const incKhrHighlight = row.incKhr ? 'bg-emerald-200/80 text-emerald-900 font-bold rounded' : 'text-emerald-700 font-semibold';

    const isReadOnly = currentUserRole === 'viewer';
    const disabledAttr = (row.isOpening || isReadOnly) ? 'disabled' : '';

    tr.innerHTML = `
      <td class="text-center text-slate-500 text-[12px] border-r border-slate-200 row-index col-idx">${rowNumber}</td>
      <td class="border-r border-slate-200 col-date"><input type="date" value="${row.date || ''}" ${disabledAttr} onchange="updateRowData(${row.id}, 'date', this.value)" class="cell-input text-slate-700 text-[11.5px] bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-label"><input type="text" value="${escapeHtml(row.label)}" ${disabledAttr} onchange="updateRowData(${row.id}, 'label', this.value)" placeholder="${isReadOnly ? '' : 'បរិយាយ...'}" class="cell-input font-medium text-slate-800 text-[12px] bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-inc"><input type="text" value="${formatDisplayAmount(row.incUsd, 'USD')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.incUsd ?? ''}')" onblur="onAmountBlur(${row.id}, 'incUsd', this, 'USD')" oninput="handleAmountInput(${row.id}, 'incUsd', this)" placeholder="-" class="cell-input text-right text-[11.5px] ${incUsdHighlight} bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-inc"><input type="text" value="${formatDisplayAmount(row.incKhr, 'KHR')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.incKhr ?? ''}')" onblur="onAmountBlur(${row.id}, 'incKhr', this, 'KHR')" oninput="handleAmountInput(${row.id}, 'incKhr', this)" placeholder="-" class="cell-input text-right text-[11.5px] ${incKhrHighlight} bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-exp"><input type="text" value="${formatDisplayAmount(row.expUsd, 'USD')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.expUsd ?? ''}')" onblur="onAmountBlur(${row.id}, 'expUsd', this, 'USD')" oninput="handleAmountInput(${row.id}, 'expUsd', this)" placeholder="-" class="cell-input text-right text-[11.5px] text-rose-600 font-semibold bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-exp"><input type="text" value="${formatDisplayAmount(row.expKhr, 'KHR')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.expKhr ?? ''}')" onblur="onAmountBlur(${row.id}, 'expKhr', this, 'KHR')" oninput="handleAmountInput(${row.id}, 'expKhr', this)" placeholder="-" class="cell-input text-right text-[11.5px] text-rose-600 font-semibold bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 bg-slate-50/50 text-right text-[11.5px] text-slate-800 bal-usd font-semibold hide-pdf">$0.00</td>
      <td class="border-r border-slate-200 bg-slate-50/50 text-right text-[11.5px] text-slate-800 bal-khr font-semibold hide-pdf">0៛</td>
      <td class="text-center action-col">
        ${isReadOnly ? '<i class="fa-solid fa-eye text-slate-300 text-xs" title="សិទ្ធិមើល"></i>' : (row.isOpening ? '<i class="fa-solid fa-lock text-amber-500 text-xs"></i>' : `<button onclick="deleteRow(${row.id})" class="text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer" title="លុបជួរនេះ"><i class="fa-solid fa-trash-can text-sm"></i></button>`)}
      </td>
    `;
    tbody.appendChild(tr);
  });
  recalculateBalances();
}

function updateRowUI(id) {
  const row = ledgerData.find(d => d.id === id);
  const tr = document.getElementById(`row-${id}`);
  if (!row || !tr) return;

  const hasIncome = (parseFloat(row.incUsd) > 0 || parseFloat(row.incKhr) > 0);
  const isIncomeType = (row.label && row.label.includes('ចំណូល')) || hasIncome;
  const hasExpense = (parseFloat(row.expUsd) > 0 || parseFloat(row.expKhr) > 0);
  const isBlankRow = !row.label && !hasIncome && !hasExpense && !row.isOpening;

  if (row.isOpening) {
    tr.className = "bg-amber-100/70 border-b border-amber-200 font-semibold";
  } else if (isIncomeType) {
    tr.className = "bg-emerald-100 hover:bg-emerald-200/70 border-b border-emerald-300 transition-colors font-medium";
  } else {
    tr.className = "hover:bg-slate-50 border-b border-slate-200 transition-colors";
  }

  const filteredData = getSelectedMonthData();
  let expCount = 0;
  filteredData.forEach(r => {
    const el = document.getElementById(`row-${r.id}`);
    if (el) {
      const idxCell = el.querySelector('.row-index');
      const rHasInc = (parseFloat(r.incUsd) > 0 || parseFloat(r.incKhr) > 0);
      const rIsInc = (r.label && r.label.includes('ចំណូល')) || rHasInc;
      const rHasExp = (parseFloat(r.expUsd) > 0 || parseFloat(r.expKhr) > 0);

      if (r.isOpening || rIsInc || (!r.label && !rHasInc && !rHasExp)) {
        if (idxCell) idxCell.textContent = '';
      } else {
        expCount++;
        if (idxCell) idxCell.textContent = expCount;
      }
    }
  });
}

/* --- LOGIC TAB 2: វិក្កយបត្រចំណាយថ្នាក់ដឹកនាំ --- */
function getSelectedInvoiceData() {
  const selectedMonth = getSelectedMonthStr();
  return selectedMonth ? invoiceData.filter(item => item.date && item.date.startsWith(selectedMonth)) : invoiceData;
}

function recalculateInvoiceTotals() {
  const filteredInvoices = getSelectedInvoiceData();
  let totalUsd = 0, totalKhr = 0;

  filteredInvoices.forEach(row => {
    totalUsd += parseFloat(row.amountUsd) || 0;
    totalKhr += parseFloat(row.amountKhr) || 0;
  });

  updateElementText('inv-count-card', `${filteredInvoices.length} វិក្កយបត្រ`);
  updateElementText('inv-total-usd-card', '$' + totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('inv-total-khr-card', totalKhr.toLocaleString('en-US') + '៛');
  updateElementText('foot-inv-usd', '$' + totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('foot-inv-khr', totalKhr.toLocaleString('en-US') + '៛');
  updateElementText('inv-record-count', `${filteredInvoices.length} កំណត់ត្រា`);
}

function updateInvoiceData(id, field, value) {
  const item = invoiceData.find(d => d.id === id);
  if (item) {
    item[field] = value;
    recalculateInvoiceTotals();
    if (isSupabaseConnected && supabaseClient) {
      debounceSyncInvoice(id);
    }
  }
}

function renderInvoiceTable() {
  const tbody = document.getElementById('invoice-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const selectedMonth = getSelectedMonthStr();
  updateElementText('inv-selected-month-header', selectedMonth ? `(${formatKhmerMonthYear(selectedMonth)})` : '');

  const filteredInvoices = getSelectedInvoiceData();

  filteredInvoices.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 border-b border-slate-200 transition-colors";
    tr.id = `inv-row-${row.id}`;

    const isReadOnly = currentUserRole === 'viewer';
    const disabledAttr = isReadOnly ? 'disabled' : '';

    tr.innerHTML = `
      <td class="text-center text-slate-500 text-[12px] border-r border-slate-200 col-inv-idx">${index + 1}</td>
      <td class="border-r border-slate-200 col-inv-date"><input type="date" value="${row.date || ''}" ${disabledAttr} onchange="updateInvoiceData(${row.id}, 'date', this.value)" class="cell-input text-slate-700 text-[11.5px] bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-inv-no"><input type="text" value="${escapeHtml(row.invNo || '')}" ${disabledAttr} onchange="updateInvoiceData(${row.id}, 'invNo', this.value)" placeholder="${isReadOnly ? '' : 'លេខវិក្កយបត្រ...'}" class="cell-input font-bold text-amber-800 text-[12px] bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-inv-label"><input type="text" value="${escapeHtml(row.label || '')}" ${disabledAttr} onchange="updateInvoiceData(${row.id}, 'label', this.value)" placeholder="${isReadOnly ? '' : 'បរិយាយចំណាយ...'}" class="cell-input font-medium text-slate-800 text-[12px] bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="text-center border-r border-slate-200 col-inv-receipt">
        ${row.receiptUrl ? `
          <button onclick="openReceiptModalForInvoice(${row.id})" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition text-[11px] font-semibold cursor-pointer shadow-xs" title="ចុចមើលរូបភាពវិក្កយបត្រ">
            <i class="fa-solid fa-receipt text-blue-600"></i>
            <span class="text-[10px]">មើល</span>
          </button>
        ` : `
          <button onclick="openReceiptModalForInvoice(${row.id})" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition text-[11px] cursor-pointer" title="${isReadOnly ? 'គ្មានរូបភាព' : 'Upload រូបភាពវិក្កយបត្រ'}">
            <i class="fa-solid fa-camera"></i>
            <span class="text-[10px] hidden sm:inline">${isReadOnly ? 'គ្មាន' : 'Upload'}</span>
          </button>
        `}
      </td>
      <td class="border-r border-slate-200 col-inv-usd"><input type="text" value="${formatDisplayAmount(row.amountUsd, 'USD')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.amountUsd ?? ''}')" onblur="onInvoiceAmountBlur(${row.id}, 'amountUsd', this, 'USD')" oninput="handleInvoiceAmountInput(${row.id}, 'amountUsd', this)" placeholder="-" class="cell-input text-right text-[11.5px] text-rose-600 font-semibold bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="border-r border-slate-200 col-inv-khr"><input type="text" value="${formatDisplayAmount(row.amountKhr, 'KHR')}" ${disabledAttr} onfocus="onAmountFocus(this, '${row.amountKhr ?? ''}')" onblur="onInvoiceAmountBlur(${row.id}, 'amountKhr', this, 'KHR')" oninput="handleInvoiceAmountInput(${row.id}, 'amountKhr', this)" placeholder="-" class="cell-input text-right text-[11.5px] text-rose-600 font-semibold bg-transparent w-full outline-none ${isReadOnly ? 'cursor-default' : ''}" /></td>
      <td class="text-center action-col">
        ${isReadOnly ? '<i class="fa-solid fa-eye text-slate-300 text-xs" title="សិទ្ធិមើល"></i>' : `<button onclick="deleteInvoiceRow(${row.id})" class="text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer" title="លុប"><i class="fa-solid fa-trash-can text-sm"></i></button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });

  recalculateInvoiceTotals();
}

/* Helpers & Shared Handlers */
function onAmountFocus(inputEl, rawVal) { inputEl.value = rawVal; inputEl.select(); }

function onAmountBlur(id, field, inputEl, currency) {
  const cleanVal = inputEl.value.replace(/[^0-9.]/g, '');
  updateRowData(id, field, cleanVal);
  inputEl.value = formatDisplayAmount(cleanVal, currency);
  updateRowUI(id);
}

function onInvoiceAmountBlur(id, field, inputEl, currency) {
  const cleanVal = inputEl.value.replace(/[^0-9.]/g, '');
  updateInvoiceData(id, field, cleanVal);
  inputEl.value = formatDisplayAmount(cleanVal, currency);
}

function handleAmountInput(id, field, inputEl) {
  updateRowData(id, field, inputEl.value.replace(/[^0-9.]/g, ''));
}

function handleInvoiceAmountInput(id, field, inputEl) {
  updateInvoiceData(id, field, inputEl.value.replace(/[^0-9.]/g, ''));
}

function recalculateBalances() {
  const filteredData = getSelectedMonthData();
  let runningUsd = 0, runningKhr = 0;
  let totalIncUsd = 0, totalIncKhr = 0, totalExpUsd = 0, totalExpKhr = 0;

  filteredData.forEach((row) => {
    const incUsd = parseFloat(row.incUsd) || 0, incKhr = parseFloat(row.incKhr) || 0;
    const expUsd = parseFloat(row.expUsd) || 0, expKhr = parseFloat(row.expKhr) || 0;

    runningUsd += (incUsd - expUsd); runningKhr += (incKhr - expKhr);
    totalIncUsd += incUsd; totalIncKhr += incKhr; totalExpUsd += expUsd; totalExpKhr += expKhr;

    const tr = document.getElementById(`row-${row.id}`);
    if (tr) {
      const balUsdCell = tr.querySelector('.bal-usd');
      const balKhrCell = tr.querySelector('.bal-khr');
      if (balUsdCell) balUsdCell.textContent = runningUsd !== 0 ? '$' + runningUsd.toLocaleString('en-US', {minimumFractionDigits:2}) : '$0.00';
      if (balKhrCell) balKhrCell.textContent = runningKhr !== 0 ? runningKhr.toLocaleString('en-US') + '៛' : '0៛';
    }
  });

  updateElementText('total-inc-usd', '$' + totalIncUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('total-inc-khr', totalIncKhr.toLocaleString('en-US') + '៛');
  updateElementText('total-exp-usd', '$' + totalExpUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('total-exp-khr', totalExpKhr.toLocaleString('en-US') + '៛');
  updateElementText('net-balance-usd', '$' + runningUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('net-balance-khr', runningKhr.toLocaleString('en-US') + '៛');

  updateElementText('foot-inc-usd', '$' + totalIncUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('foot-inc-khr', totalIncKhr.toLocaleString('en-US') + '៛');
  updateElementText('foot-exp-usd', '$' + totalExpUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('foot-exp-khr', totalExpKhr.toLocaleString('en-US') + '៛');
  updateElementText('foot-net-usd', '$' + runningUsd.toLocaleString('en-US', {minimumFractionDigits: 2}));
  updateElementText('foot-net-khr', runningKhr.toLocaleString('en-US') + '៛');
  updateElementText('record-count', `${filteredData.length} កំណត់ត្រា`);
  if (typeof updateFinancialCharts === 'function') updateFinancialCharts();
}

function updateElementText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function updateRowData(id, field, value) {
  const item = ledgerData.find(d => d.id === id);
  if (item) {
    item[field] = value;
    recalculateBalances();
    if (field === 'label') updateRowUI(id);
    if (isSupabaseConnected && supabaseClient) {
      debounceSyncLedger(id);
    }
  }
}

function addNewRow() {
  if (currentUserRole === 'viewer') {
    alert('សិទ្ធិថ្នាក់ដឹកនាំ (Viewer) សម្រាប់តែពិនិត្យមើលរបាយការណ៍ មិនអាចបន្ថែមជួរបានឡើយ។');
    return;
  }
  const newId = Date.now() + Math.floor(Math.random() * 100);
  const selectedMonth = getSelectedMonthStr();
  const newRow = { id: newId, date: `${selectedMonth}-01`, label: '', incUsd: '', incKhr: '', expUsd: '', expKhr: '', isOpening: false };
  ledgerData.push(newRow);
  renderTable();
  if (isSupabaseConnected && supabaseClient) {
    syncLedgerRowToSupabase(newId);
  }
}

function addInvoiceRow() {
  if (currentUserRole === 'viewer') {
    alert('សិទ្ធិថ្នាក់ដឹកនាំ (Viewer) សម្រាប់តែពិនិត្យមើលរបាយការណ៍ មិនអាចបន្ថែមវិក្កយបត្របានឡើយ។');
    return;
  }
  const newId = Date.now() + Math.floor(Math.random() * 100);
  const selectedMonth = getSelectedMonthStr();
  const newRow = { id: newId, date: `${selectedMonth}-01`, invNo: '', label: '', amountUsd: '', amountKhr: '', receiptUrl: '' };
  invoiceData.push(newRow);
  renderInvoiceTable();
  if (isSupabaseConnected && supabaseClient) {
    syncInvoiceRowToSupabase(newId);
  }
}

function deleteRow(id) {
  if (currentUserRole === 'viewer') return;
  ledgerData = ledgerData.filter(d => d.id !== id);
  renderTable();
  if (isSupabaseConnected && supabaseClient) {
    deleteSupabaseRow('pac_ledger', id);
  }
}

function deleteInvoiceRow(id) {
  if (currentUserRole === 'viewer') return;
  invoiceData = invoiceData.filter(d => d.id !== id);
  renderInvoiceTable();
  if (isSupabaseConnected && supabaseClient) {
    deleteSupabaseRow('pac_invoices', id);
  }
}

function closeCurrentMonth() {
  if (currentUserRole === 'viewer') return;
  const currentMonth = getSelectedMonthStr();
  if (!currentMonth) return;
  const ending = getMonthEndingBalance(currentMonth);
  if (confirm(`បិទបញ្ជីហិរញ្ញវត្ថុ ${formatKhmerMonthYear(currentMonth)}?\n• សមតុល្យ $៖ $${ending.usd.toLocaleString()}\n• សមតុល្យ ៛៖ ${ending.khr.toLocaleString()}៛`)) {
    const [y, m] = currentMonth.split('-').map(Number);
    const nextDate = new Date(y, m - 1, 1); nextDate.setMonth(nextDate.getMonth() + 1);
    const nextMonthStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

    setSelectedMonthStr(nextMonthStr);
    ensureMonthlyOpeningBalance(nextMonthStr);
    manualSave();
    renderTable(); renderInvoiceTable();
  }
}

function filterTable() {
  const query = document.getElementById('table-search')?.value.toLowerCase() || '';
  document.querySelectorAll('#ledger-body tr').forEach(row => {
    row.style.display = row.innerText.toLowerCase().includes(query) || Array.from(row.querySelectorAll('input')).map(i => i.value.toLowerCase()).join(' ').includes(query) ? '' : 'none';
  });
}

function filterInvoiceTable() {
  const query = document.getElementById('inv-table-search')?.value.toLowerCase() || '';
  document.querySelectorAll('#invoice-body tr').forEach(row => {
    row.style.display = row.innerText.toLowerCase().includes(query) || Array.from(row.querySelectorAll('input')).map(i => i.value.toLowerCase()).join(' ').includes(query) ? '' : 'none';
  });
}

// មុខងារ Export PDF
function exportToPDF() {
  const isLedger = currentActiveTab === 'ledger';
  const element = document.getElementById(isLedger ? 'pdf-report-content' : 'pdf-invoice-report-content');
  const selectedMonth = getSelectedMonthStr();

  if (!element) return;

  if (isLedger) {
    const titleEl = document.getElementById('pdf-report-title');
    if (titleEl) titleEl.textContent = `របាយការណ៍បូកសរុបចំណូល-ចំណាយ ប្រចាំ${formatKhmerMonthYear(selectedMonth)}`;
  } else {
    const titleEl = document.querySelector('#pdf-invoice-report-content h2');
    if (titleEl) titleEl.textContent = `របាយការណ៍វិក្កយបត្រចំណាយថ្នាក់ដឹកនាំ ប្រចាំ${formatKhmerMonthYear(selectedMonth)}`;
  }

  const opt = {
    margin: [0.15, 0.15, 0.15, 0.15],
    filename: isLedger ? `PAC_Financial_Report_${selectedMonth}.pdf` : `Executive_Invoice_Report_${selectedMonth}.pdf`,
    image: { type: 'jpeg', quality: 1 },
    html2canvas: {
      scale: 3,
      useCORS: true,
      letterRendering: false,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        const pdfContent = clonedDoc.getElementById(isLedger ? 'pdf-report-content' : 'pdf-invoice-report-content');
        if (pdfContent) {
          pdfContent.style.width = '100%';
          pdfContent.style.margin = '0';
          pdfContent.style.padding = '0';
          pdfContent.style.border = 'none';
          pdfContent.style.boxShadow = 'none';
        }

        const clonedInputs = clonedDoc.querySelectorAll('table tbody input');
        clonedInputs.forEach(input => {
          const span = clonedDoc.createElement('span');
          span.textContent = input.value || '-';
          span.className = input.className;
          span.style.display = 'block';
          span.style.width = '100%';
          span.style.lineHeight = '22px';
          span.style.fontSize = '11px';
          span.style.letterSpacing = 'normal';
          span.style.overflow = 'hidden';
          span.style.whiteSpace = 'nowrap';
          span.style.textOverflow = 'ellipsis';
          span.style.fontFamily = "'Kantumruy Pro', sans-serif";
          if (input.parentNode) {
            input.parentNode.replaceChild(span, input);
          }
        });

        // Format receipt cells in PDF
        const clonedReceipts = clonedDoc.querySelectorAll('table tbody .col-inv-receipt');
        clonedReceipts.forEach(td => {
          const hasImg = td.querySelector('.fa-receipt') !== null;
          td.innerHTML = `<span style="display:block; text-align:center; font-size:10px; font-family:'Kantumruy Pro', sans-serif; color:${hasImg ? '#2563eb' : '#94a3b8'}; font-weight:${hasImg ? 'bold' : 'normal'};">${hasImg ? '✓ មានបង្កាន់ដៃ' : '-'}</span>`;
        });
      }
    },
    pagebreak: {
      mode: ['avoid-all', 'css', 'legacy'],
      avoid: ['tr', 'tfoot']
    },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };

  element.classList.add('pdf-rendering');

  html2pdf().set(opt).from(element).save().then(() => {
    element.classList.remove('pdf-rendering');
  });
}

/* ==========================================================================
   CONSOLIDATED COMBINED REPORT (SINGLE-FILE PDF EXPORT) & MONTH CLOSING
   ========================================================================== */

function exportCombinedReportPDF() {
  const selectedMonth = getSelectedMonthStr();
  const element = document.getElementById('pdf-combined-report-content');
  if (!element) return;

  const monthLabelKh = formatKhmerMonthYear(selectedMonth);

  // Subtitle with Khmer month and year
  const subtitleEl = document.getElementById('combined-pdf-subtitle');
  if (subtitleEl) subtitleEl.textContent = `ប្រចាំ${monthLabelKh}`;

  // Set signature date (current date in Khmer)
  const now = new Date();
  const sigDateEl = document.getElementById('combined-pdf-signature-date');
  if (sigDateEl) {
    sigDateEl.textContent = `រាជធានីភ្នំពេញ, ថ្ងៃទី ${String(now.getDate()).padStart(2, '0')} ${monthLabelKh}`;
  }

  // 1. Populate Section 1: General Ledger Breakdown
  const ledgerItems = getSelectedMonthData();
  const ledgerTbody = document.getElementById('combined-ledger-tbody');
  let totIncUsd = 0, totIncKhr = 0, totExpUsd = 0, totExpKhr = 0;

  if (ledgerTbody) {
    ledgerTbody.innerHTML = '';
    if (ledgerItems.length === 0) {
      ledgerTbody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-slate-400 text-xs">គ្មានកំណត់ត្រាចំណូល-ចំណាយសម្រាប់ខែនេះទេ</td></tr>';
    } else {
      ledgerItems.forEach((row, idx) => {
        const incU = parseFloat(row.incUsd) || 0;
        const incK = parseFloat(row.incKhr) || 0;
        const expU = parseFloat(row.expUsd) || 0;
        const expK = parseFloat(row.expKhr) || 0;
        totIncUsd += incU;
        totIncKhr += incK;
        totExpUsd += expU;
        totExpKhr += expK;

        const tr = document.createElement('tr');
        tr.className = row.isOpening ? 'bg-amber-50/70 font-semibold' : (incU > 0 || incK > 0 ? 'bg-emerald-50/40 font-medium' : '');
        tr.innerHTML = `
          <td class="py-1.5 px-1 text-center font-bold text-slate-700 border-r border-slate-200">${idx + 1}</td>
          <td class="py-1.5 px-1 text-center text-slate-700 border-r border-slate-200">${row.date || '-'}</td>
          <td class="py-1.5 px-2 text-slate-800 border-r border-slate-200 font-medium">${escapeHtml(row.label || '-')}</td>
          <td class="py-1.5 px-1 text-right text-emerald-700 font-semibold border-r border-slate-200">${formatDisplayAmount(row.incUsd, 'USD') || '-'}</td>
          <td class="py-1.5 px-1 text-right text-emerald-700 font-semibold border-r border-slate-200">${formatDisplayAmount(row.incKhr, 'KHR') || '-'}</td>
          <td class="py-1.5 px-1 text-right text-rose-600 font-semibold border-r border-slate-200">${formatDisplayAmount(row.expUsd, 'USD') || '-'}</td>
          <td class="py-1.5 px-1 text-right text-rose-600 font-semibold border-r border-slate-200">${formatDisplayAmount(row.expKhr, 'KHR') || '-'}</td>
        `;
        ledgerTbody.appendChild(tr);
      });
    }
    updateElementText('combined-ledger-count', `${ledgerItems.length} កំណត់ត្រា`);
    updateElementText('combined-foot-inc-usd', '$' + totIncUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
    updateElementText('combined-foot-inc-khr', totIncKhr.toLocaleString('en-US') + '៛');
    updateElementText('combined-foot-exp-usd', '$' + totExpUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
    updateElementText('combined-foot-exp-khr', totExpKhr.toLocaleString('en-US') + '៛');
  }

  // 2. Populate Section 2: Leadership Invoices Breakdown
  const invoiceItems = getSelectedInvoiceData();
  const invoiceTbody = document.getElementById('combined-invoice-tbody');
  let totInvUsd = 0, totInvKhr = 0;

  if (invoiceTbody) {
    invoiceTbody.innerHTML = '';
    if (invoiceItems.length === 0) {
      invoiceTbody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-slate-400 text-xs">គ្មានវិក្កយបត្រចំណាយសម្រាប់ខែនេះទេ</td></tr>';
    } else {
      invoiceItems.forEach((row, idx) => {
        const u = parseFloat(row.amountUsd) || 0;
        const k = parseFloat(row.amountKhr) || 0;
        totInvUsd += u;
        totInvKhr += k;

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition-colors';
        tr.innerHTML = `
          <td class="py-1.5 px-1 text-center font-bold text-slate-700 border-r border-slate-200">${idx + 1}</td>
          <td class="py-1.5 px-1 text-center text-slate-700 border-r border-slate-200">${row.date || '-'}</td>
          <td class="py-1 px-2 text-amber-900 font-bold border-r border-slate-200">${escapeHtml(row.invNo || '-')}</td>
          <td class="py-1 px-2 text-slate-800 border-r border-slate-200">${escapeHtml(row.label || '-')}</td>
          <td class="py-1 px-1 text-center border-r border-slate-200 font-semibold text-[10px] ${row.receiptUrl ? 'text-blue-600' : 'text-slate-400'}">${row.receiptUrl ? '✓ មានបង្កាន់ដៃ' : '-'}</td>
          <td class="py-1 px-1 text-right text-rose-600 font-semibold border-r border-slate-200">${formatDisplayAmount(row.amountUsd, 'USD') || '-'}</td>
          <td class="py-1 px-1 text-right text-rose-600 font-semibold border-r border-slate-200">${formatDisplayAmount(row.amountKhr, 'KHR') || '-'}</td>
        `;
        invoiceTbody.appendChild(tr);
      });
    }
    updateElementText('combined-invoice-count', `${invoiceItems.length} វិក្កយបត្រ`);
    updateElementText('combined-foot-inv-usd', '$' + totInvUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
    updateElementText('combined-foot-inv-khr', totInvKhr.toLocaleString('en-US') + '៛');
  }

  // 3. Populate Section 3: Final Consolidated Expenses Summary Table (Only 3 expense items)
  const grandCombinedExpUsd = totExpUsd + totInvUsd;
  const grandCombinedExpKhr = totExpKhr + totInvKhr;

  updateElementText('summary-final-exp-ledger-usd', '$' + totExpUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('summary-final-exp-ledger-khr', totExpKhr.toLocaleString('en-US') + '៛');

  updateElementText('summary-final-exp-inv-usd', '$' + totInvUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('summary-final-exp-inv-khr', totInvKhr.toLocaleString('en-US') + '៛');

  updateElementText('summary-final-grand-exp-usd', '$' + grandCombinedExpUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('summary-final-grand-exp-khr', grandCombinedExpKhr.toLocaleString('en-US') + '៛');

  // 4. Generate PDF using html2pdf
  const opt = {
    margin: [0.15, 0.15, 0.15, 0.15],
    filename: `PAC_Combined_Financial_Report_${selectedMonth}.pdf`,
    image: { type: 'jpeg', quality: 1 },
    html2canvas: {
      scale: 3,
      useCORS: true,
      letterRendering: false,
      scrollX: 0,
      scrollY: 0
    },
    pagebreak: {
      mode: ['avoid-all', 'css', 'legacy'],
      avoid: ['tr', 'tfoot']
    },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };

  element.classList.remove('hidden');
  element.classList.add('pdf-rendering');

  showSaveToast('📄 កំពុងរៀបចំទាញយករបាយការណ៍បូកសរុបរួម (PDF)...');

  html2pdf().set(opt).from(element).save().then(() => {
    element.classList.remove('pdf-rendering');
    element.classList.add('hidden');
    showSaveToast('✓ បានទាញយករបាយការណ៍បូកសរុបរួម (PDF) ដោយជោគជ័យ!');
  }).catch(err => {
    element.classList.remove('pdf-rendering');
    element.classList.add('hidden');
    console.error('Combined PDF export error:', err);
    showSaveToast('⚠️ មានបញ្ហាក្នុងការទាញយក PDF៖ ' + err.message);
  });
}

function openCloseMonthModal() {
  const modal = document.getElementById('close-month-modal');
  if (!modal) return;
  const selectedMonth = getSelectedMonthStr();
  const subtitleEl = document.getElementById('close-month-modal-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = 'បិទបញ្ជីហិរញ្ញវត្ថុ ប្រចាំ' + formatKhmerMonthYear(selectedMonth);
  }
  updateCloseMonthModalBalances();
  modal.classList.remove('hidden');
}

function closeCloseMonthModal() {
  const modal = document.getElementById('close-month-modal');
  if (modal) modal.classList.add('hidden');
}

function updateCloseMonthModalBalances() {
  const ledgerItems = getSelectedMonthData();
  const invoiceItems = getSelectedInvoiceData();

  let incUsd = 0, incKhr = 0, expLedgerUsd = 0, expLedgerKhr = 0;
  ledgerItems.forEach(r => {
    incUsd += parseFloat(r.incUsd) || 0;
    incKhr += parseFloat(r.incKhr) || 0;
    expLedgerUsd += parseFloat(r.expUsd) || 0;
    expLedgerKhr += parseFloat(r.expKhr) || 0;
  });

  let expInvUsd = 0, expInvKhr = 0;
  invoiceItems.forEach(r => {
    expInvUsd += parseFloat(r.amountUsd) || 0;
    expInvKhr += parseFloat(r.amountKhr) || 0;
  });

  const grandExpUsd = expLedgerUsd + expInvUsd;
  const grandExpKhr = expLedgerKhr + expInvKhr;

  const deductInv = document.getElementById('close-deduct-invoice-checkbox')?.checked ?? true;
  const netUsd = deductInv ? (incUsd - grandExpUsd) : (incUsd - expLedgerUsd);
  const netKhr = deductInv ? (incKhr - grandExpKhr) : (incKhr - expLedgerKhr);

  updateElementText('close-inc-usd', '$' + incUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('close-inc-khr', incKhr.toLocaleString('en-US') + '៛');

  updateElementText('close-ledger-rec-count', `${ledgerItems.length} ជួរ`);
  updateElementText('close-exp-ledger-usd', '$' + expLedgerUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('close-exp-ledger-khr', expLedgerKhr.toLocaleString('en-US') + '៛');

  updateElementText('close-inv-rec-count', `${invoiceItems.length} វិក្កយបត្រ`);
  updateElementText('close-exp-inv-usd', '$' + expInvUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('close-exp-inv-khr', expInvKhr.toLocaleString('en-US') + '៛');

  updateElementText('close-grand-exp-usd', '$' + grandExpUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('close-grand-exp-khr', grandExpKhr.toLocaleString('en-US') + '៛');

  updateElementText('close-net-usd', '$' + netUsd.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  updateElementText('close-net-khr', netKhr.toLocaleString('en-US') + '៛');
}

async function confirmExecuteCloseMonth() {
  const selectedMonth = getSelectedMonthStr();
  const nextMonthStr = getNextMonthStr(selectedMonth);
  const monthLabelKh = formatKhmerMonthYear(selectedMonth);
  const nextMonthLabelKh = formatKhmerMonthYear(nextMonthStr);

  const confirmMsg = `តើអ្នកពិតជាចង់បិទបញ្ជីសម្រាប់ ${monthLabelKh} និងផ្ទេរសមតុល្យសាច់ប្រាក់ដែលនៅសល់ទៅ ${nextMonthLabelKh} មែនទេ?`;
  if (!confirm(confirmMsg)) return;

  const ledgerItems = getSelectedMonthData();
  const invoiceItems = getSelectedInvoiceData();

  let incUsd = 0, incKhr = 0, expLedgerUsd = 0, expLedgerKhr = 0;
  ledgerItems.forEach(r => {
    incUsd += parseFloat(r.incUsd) || 0;
    incKhr += parseFloat(r.incKhr) || 0;
    expLedgerUsd += parseFloat(r.expUsd) || 0;
    expLedgerKhr += parseFloat(r.expKhr) || 0;
  });

  let expInvUsd = 0, expInvKhr = 0;
  invoiceItems.forEach(r => {
    expInvUsd += parseFloat(r.amountUsd) || 0;
    expInvKhr += parseFloat(r.amountKhr) || 0;
  });

  const deductInv = document.getElementById('close-deduct-invoice-checkbox')?.checked ?? true;
  const netUsd = deductInv ? (incUsd - (expLedgerUsd + expInvUsd)) : (incUsd - expLedgerUsd);
  const netKhr = deductInv ? (incKhr - (expLedgerKhr + expInvKhr)) : (incKhr - expLedgerKhr);

  const openingLabel = `ថវិកានៅសល់ពី${monthLabelKh}`;
  const existingIdx = ledgerData.findIndex(d => d.date && d.date.startsWith(nextMonthStr) && d.isOpening === true);

  let targetRow;
  if (existingIdx !== -1) {
    ledgerData[existingIdx].label = openingLabel;
    ledgerData[existingIdx].incUsd = netUsd > 0 ? String(netUsd) : '';
    ledgerData[existingIdx].incKhr = netKhr > 0 ? String(netKhr) : '';
    targetRow = ledgerData[existingIdx];
  } else {
    const newId = ledgerData.length ? Math.max(...ledgerData.map(d => d.id)) + 1 : 1;
    targetRow = {
      id: newId,
      date: `${nextMonthStr}-01`,
      label: openingLabel,
      incUsd: netUsd > 0 ? String(netUsd) : '',
      incKhr: netKhr > 0 ? String(netKhr) : '',
      expUsd: '',
      expKhr: '',
      isOpening: true
    };
    ledgerData.unshift(targetRow);
  }

  // Save local
  localStorage.setItem('pac_ledger_data', JSON.stringify(ledgerData));

  // Sync to Supabase if connected
  if (isSupabaseConnected && supabaseClient && targetRow) {
    try {
      await supabaseClient.from('pac_ledger').upsert([mapLedgerToSupabase(targetRow)]);
    } catch (err) {
      console.warn('Sync close month error:', err);
    }
  }

  closeCloseMonthModal();

  // Switch to the next month in the dropdown
  const [nextYear, nextMonth] = nextMonthStr.split('-');
  const mSelect = document.getElementById('month-select');
  const ySelect = document.getElementById('year-select');
  if (mSelect) mSelect.value = nextMonth;
  if (ySelect) ySelect.value = nextYear;

  renderTable();
  renderInvoiceTable();
  recalculateBalances();
  recalculateInvoiceTotals();

  showSaveToast(`✓ បានបិទបញ្ជី ${monthLabelKh} និងផ្ទេរសមតុល្យសាច់ប្រាក់ទៅ ${nextMonthLabelKh} ដោយជោគជ័យ!`);
}

function getNextMonthStr(currentMonthStr) {
  if (!currentMonthStr) return '';
  const [year, month] = currentMonthStr.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(str) { return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

/* ==========================================================================
   SUPABASE CLOUD DATABASE INTEGRATION & REALTIME SYNC
   ========================================================================== */

// Mappers between Local Object Model & Supabase PostgreSQL Tables
function mapLedgerToSupabase(row) {
  return {
    id: row.id,
    date: row.date || new Date().toISOString().slice(0, 10),
    label: row.label || '',
    inc_usd: parseFloat(row.incUsd) || 0,
    inc_khr: parseFloat(row.incKhr) || 0,
    exp_usd: parseFloat(row.expUsd) || 0,
    exp_khr: parseFloat(row.expKhr) || 0,
    is_opening: Boolean(row.isOpening),
    receipt_url: row.receiptUrl || '',
    updated_at: new Date().toISOString()
  };
}

function mapSupabaseToLedger(row) {
  return {
    id: Number(row.id),
    date: row.date || '',
    label: row.label || '',
    incUsd: row.inc_usd && Number(row.inc_usd) !== 0 ? String(row.inc_usd) : '',
    incKhr: row.inc_khr && Number(row.inc_khr) !== 0 ? String(row.inc_khr) : '',
    expUsd: row.exp_usd && Number(row.exp_usd) !== 0 ? String(row.exp_usd) : '',
    expKhr: row.exp_khr && Number(row.exp_khr) !== 0 ? String(row.exp_khr) : '',
    isOpening: Boolean(row.is_opening),
    receiptUrl: row.receipt_url || ''
  };
}

function mapInvoiceToSupabase(row) {
  return {
    id: row.id,
    date: row.date || new Date().toISOString().slice(0, 10),
    inv_no: row.invNo || '',
    label: row.label || '',
    amount_usd: parseFloat(row.amountUsd) || 0,
    amount_khr: parseFloat(row.amountKhr) || 0,
    receipt_url: row.receiptUrl || '',
    updated_at: new Date().toISOString()
  };
}

function mapSupabaseToInvoice(row) {
  return {
    id: Number(row.id),
    date: row.date || '',
    invNo: row.inv_no || '',
    label: row.label || '',
    amountUsd: row.amount_usd && Number(row.amount_usd) !== 0 ? String(row.amount_usd) : '',
    amountKhr: row.amount_khr && Number(row.amount_khr) !== 0 ? String(row.amount_khr) : '',
    receiptUrl: row.receipt_url || ''
  };
}

// Debounce Mutations for smoother network efficiency
function debounceSyncLedger(id) {
  const key = `ledger_${id}`;
  clearTimeout(syncDebounceTimers[key]);
  syncDebounceTimers[key] = setTimeout(() => {
    syncLedgerRowToSupabase(id);
  }, 400);
}

function debounceSyncInvoice(id) {
  const key = `invoice_${id}`;
  clearTimeout(syncDebounceTimers[key]);
  syncDebounceTimers[key] = setTimeout(() => {
    syncInvoiceRowToSupabase(id);
  }, 400);
}

// Direct Sync functions to Supabase
async function syncLedgerRowToSupabase(id) {
  if (!isSupabaseConnected || !supabaseClient) return;
  const row = ledgerData.find(d => d.id === id);
  if (!row) return;
  try {
    const payload = mapLedgerToSupabase(row);
    const { error } = await supabaseClient.from('pac_ledger').upsert(payload, { onConflict: 'id' });
    if (error) console.warn('Supabase upsert ledger error:', error.message);
  } catch (err) {
    console.error('syncLedgerRowToSupabase error:', err);
  }
}

async function syncInvoiceRowToSupabase(id) {
  if (!isSupabaseConnected || !supabaseClient) return;
  const row = invoiceData.find(d => d.id === id);
  if (!row) return;
  try {
    const payload = mapInvoiceToSupabase(row);
    const { error } = await supabaseClient.from('pac_invoices').upsert(payload, { onConflict: 'id' });
    if (error) console.warn('Supabase upsert invoice error:', error.message);
  } catch (err) {
    console.error('syncInvoiceRowToSupabase error:', err);
  }
}

async function deleteSupabaseRow(table, id) {
  if (!isSupabaseConnected || !supabaseClient) return;
  try {
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) console.warn(`Supabase delete from ${table} error:`, error.message);
  } catch (err) {
    console.error('deleteSupabaseRow error:', err);
  }
}

// Load Data from Supabase Cloud
async function fetchSupabaseData() {
  if (!supabaseClient) return;
  try {
    const [ledgerRes, invoiceRes] = await Promise.all([
      supabaseClient.from('pac_ledger').select('*').order('date', { ascending: true }).order('id', { ascending: true }),
      supabaseClient.from('pac_invoices').select('*').order('date', { ascending: true }).order('id', { ascending: true })
    ]);

    let hasRemoteData = false;

    if (!ledgerRes.error && ledgerRes.data && ledgerRes.data.length > 0) {
      ledgerData = ledgerRes.data.map(mapSupabaseToLedger);
      localStorage.setItem('pac_ledger_data', JSON.stringify(ledgerData));
      hasRemoteData = true;
    }

    if (!invoiceRes.error && invoiceRes.data && invoiceRes.data.length > 0) {
      invoiceData = invoiceRes.data.map(mapSupabaseToInvoice);
      localStorage.setItem('pac_invoice_data', JSON.stringify(invoiceData));
      hasRemoteData = true;
    }

    if (hasRemoteData) {
      const currentMonth = getSelectedMonthStr();
      ensureMonthlyOpeningBalance(currentMonth);
      renderTable();
      renderInvoiceTable();
      if (typeof updateFinancialCharts === 'function') updateFinancialCharts();
    }
  } catch (err) {
    console.error('Error fetching Supabase data:', err);
  }
}

// Realtime Subscriptions (Multiple screens & devices sync automatically)
function subscribeToRealtime() {
  if (!supabaseClient) return;
  if (realtimeSubscription) {
    supabaseClient.removeChannel(realtimeSubscription);
  }

  realtimeSubscription = supabaseClient.channel('pac-finance-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pac_ledger' }, (payload) => {
      handleRealtimeLedgerChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pac_invoices' }, (payload) => {
      handleRealtimeInvoiceChange(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pac_settings' }, (payload) => {
      handleRealtimeSettingsChange(payload);
    })
    .subscribe();
}

// ទាញយកការកំណត់លេខកូដសម្ងាត់ PIN ពី Supabase Cloud Database មក Sync លើគ្រប់ឧបករណ៍
async function fetchRemotePinSettings() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('pac_settings')
      .select('key, value')
      .in('key', ['pin_viewer', 'pin_editor']);

    if (!error && data && data.length > 0) {
      data.forEach(item => {
        if (item.key === 'pin_viewer' && item.value) {
          localStorage.setItem('pac_pin_viewer', item.value);
        }
        if (item.key === 'pin_editor' && item.value) {
          localStorage.setItem('pac_pin_editor', item.value);
        }
      });

      // Update Auth Modal inputs ប្រសិនបើបើក
      const pinViewerInput = document.getElementById('setting-pin-viewer');
      const pinEditorInput = document.getElementById('setting-pin-editor');
      if (pinViewerInput) pinViewerInput.value = getRolePin('viewer');
      if (pinEditorInput) pinEditorInput.value = getRolePin('editor');

      // ប្រសិនបើកំពុងស្ថិតលើផ្ទាំង Login ធ្វើបច្ចុប្បន្នភាពភ្លាមៗ
      if (!isAppLoggedIn) {
        selectLoginRole(selectedPortalRole);
      }
    }
  } catch (err) {
    console.warn('Could not fetch PIN settings from Supabase:', err);
  }
}

// ទទួលការផ្លាស់ប្តូរលេខកូដ PIN តាម Realtime ពេលមានឧបករណ៍ណាមួយប្តូរលេខកូដ
function handleRealtimeSettingsChange(payload) {
  const { new: newRow } = payload;
  if (!newRow || !newRow.key) return;

  if (newRow.key === 'pin_viewer' && newRow.value) {
    localStorage.setItem('pac_pin_viewer', newRow.value);
  } else if (newRow.key === 'pin_editor' && newRow.value) {
    localStorage.setItem('pac_pin_editor', newRow.value);
  }

  const pinViewerInput = document.getElementById('setting-pin-viewer');
  const pinEditorInput = document.getElementById('setting-pin-editor');
  if (pinViewerInput && newRow.key === 'pin_viewer') pinViewerInput.value = newRow.value;
  if (pinEditorInput && newRow.key === 'pin_editor') pinEditorInput.value = newRow.value;

  if (!isAppLoggedIn) {
    selectLoginRole(selectedPortalRole);
  }
}

function handleRealtimeLedgerChange(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  const activeEl = document.activeElement;
  const isEditing = activeEl && activeEl.closest('#ledger-body');

  if (eventType === 'INSERT') {
    const mapped = mapSupabaseToLedger(newRow);
    if (!ledgerData.some(d => d.id === mapped.id)) {
      ledgerData.push(mapped);
      if (!isEditing) renderTable();
    }
  } else if (eventType === 'UPDATE') {
    const mapped = mapSupabaseToLedger(newRow);
    const idx = ledgerData.findIndex(d => d.id === mapped.id);
    if (idx !== -1) {
      ledgerData[idx] = mapped;
      if (!isEditing) renderTable();
      else recalculateBalances();
    }
  } else if (eventType === 'DELETE') {
    ledgerData = ledgerData.filter(d => d.id !== Number(oldRow.id));
    if (!isEditing) renderTable();
    else recalculateBalances();
  }
  localStorage.setItem('pac_ledger_data', JSON.stringify(ledgerData));
  if (typeof updateFinancialCharts === 'function') updateFinancialCharts();
}

function handleRealtimeInvoiceChange(payload) {
  const { eventType, new: newRow, old: oldRow } = payload;
  const activeEl = document.activeElement;
  const isEditing = activeEl && activeEl.closest('#invoice-body');

  if (eventType === 'INSERT') {
    const mapped = mapSupabaseToInvoice(newRow);
    if (!invoiceData.some(d => d.id === mapped.id)) {
      invoiceData.push(mapped);
      if (!isEditing) renderInvoiceTable();
    }
  } else if (eventType === 'UPDATE') {
    const mapped = mapSupabaseToInvoice(newRow);
    const idx = invoiceData.findIndex(d => d.id === mapped.id);
    if (idx !== -1) {
      invoiceData[idx] = mapped;
      if (!isEditing) renderInvoiceTable();
      else recalculateInvoiceTotals();
    }
  } else if (eventType === 'DELETE') {
    invoiceData = invoiceData.filter(d => d.id !== Number(oldRow.id));
    if (!isEditing) renderInvoiceTable();
    else recalculateInvoiceTotals();
  }
  localStorage.setItem('pac_invoice_data', JSON.stringify(invoiceData));
}

// UI Status Badge Updater
function updateSupabaseUIStatus(status, detail) {
  const dot = document.getElementById('supabase-status-dot');
  const label = document.getElementById('supabase-status-label');
  const modalDot = document.getElementById('modal-status-dot');
  const modalTitle = document.getElementById('modal-status-title');
  const modalSubtitle = document.getElementById('modal-status-subtitle');
  const modalPill = document.getElementById('modal-status-pill');

  if (status === 'connected') {
    isSupabaseConnected = true;
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]';
    if (label) label.textContent = 'Supabase Cloud';

    if (modalDot) modalDot.className = 'w-3 h-3 rounded-full bg-emerald-500';
    if (modalTitle) modalTitle.textContent = 'ស្ថានភាព៖ បានភ្ជាប់ទៅ Supabase Cloud រួចរាល់';
    if (modalSubtitle) modalSubtitle.textContent = detail || 'ទិន្នន័យត្រូវបានរក្សាទុកលើ Cloud និងធ្វើសមកាលកម្ម Realtime';
    if (modalPill) {
      modalPill.className = 'text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800';
      modalPill.textContent = 'Online';
    }
  } else if (status === 'connecting') {
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping';
    if (label) label.textContent = 'Supabase...';
  } else {
    isSupabaseConnected = false;
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
    if (label) label.textContent = 'Supabase';

    if (modalDot) modalDot.className = 'w-3 h-3 rounded-full bg-slate-400';
    if (modalTitle) modalTitle.textContent = 'ស្ថានភាព៖ មិនទាន់ភ្ជាប់ (ប្រើប្រាស់ LocalStorage)';
    if (modalSubtitle) modalSubtitle.textContent = detail || 'ទិន្នន័យរក្សាទុកលើ Browser ម៉ាស៊ីននេះប៉ុណ្ណោះ';
    if (modalPill) {
      modalPill.className = 'text-[11px] px-2 py-0.5 rounded-full font-medium bg-slate-200 text-slate-700';
      modalPill.textContent = 'Offline';
    }
  }
}

function sanitizeSupabaseUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

// Initialize Supabase Client
async function initSupabase() {
  const defaultUrl = window.SUPABASE_DEFAULT_CONFIG ? window.SUPABASE_DEFAULT_CONFIG.url : '';
  const defaultKey = window.SUPABASE_DEFAULT_CONFIG ? window.SUPABASE_DEFAULT_CONFIG.anonKey : '';

  const rawUrl = localStorage.getItem('pac_supabase_url') || defaultUrl;
  const savedUrl = sanitizeSupabaseUrl(rawUrl);
  const savedKey = (localStorage.getItem('pac_supabase_key') || defaultKey || '').trim();

  if (!savedUrl || !savedKey || !window.supabase) {
    updateSupabaseUIStatus('disconnected');
    return;
  }

  updateSupabaseUIStatus('connecting');

  try {
    supabaseClient = window.supabase.createClient(savedUrl, savedKey);
    // Ping by checking pac_ledger
    const { data, error } = await supabaseClient.from('pac_ledger').select('id').limit(1);
    if (error) {
      console.warn('Supabase ping warning:', error.message);
      updateSupabaseUIStatus('disconnected', `ការតភ្ជាប់មានបញ្ហា៖ ${error.message}`);
      return;
    }

    updateSupabaseUIStatus('connected', `ភ្ជាប់ទៅ៖ ${savedUrl}`);
    await fetchSupabaseData();
    await fetchRemotePinSettings();
    subscribeToRealtime();
  } catch (err) {
    console.error('Supabase init failed:', err);
    updateSupabaseUIStatus('disconnected', 'មិនអាចតភ្ជាប់បាន៖ សូមពិនិត្យ Internet ឬ Config');
  }
}

// Modal Handlers
function openSupabaseModal() {
  const modal = document.getElementById('supabase-modal');
  if (!modal) return;

  const defaultUrl = window.SUPABASE_DEFAULT_CONFIG ? window.SUPABASE_DEFAULT_CONFIG.url : '';
  const defaultKey = window.SUPABASE_DEFAULT_CONFIG ? window.SUPABASE_DEFAULT_CONFIG.anonKey : '';

  const urlInput = document.getElementById('cfg-supabase-url');
  const keyInput = document.getElementById('cfg-supabase-key');
  if (urlInput) urlInput.value = localStorage.getItem('pac_supabase_url') || defaultUrl || '';
  if (keyInput) keyInput.value = localStorage.getItem('pac_supabase_key') || defaultKey || '';

  const testResult = document.getElementById('test-conn-result');
  if (testResult) testResult.classList.add('hidden');
  const syncResult = document.getElementById('sync-result');
  if (syncResult) syncResult.classList.add('hidden');

  modal.classList.remove('hidden');
}

function closeSupabaseModal() {
  const modal = document.getElementById('supabase-modal');
  if (modal) modal.classList.add('hidden');
}

function toggleKeyVisibility() {
  const keyInput = document.getElementById('cfg-supabase-key');
  const icon = document.getElementById('eye-icon');
  if (!keyInput || !icon) return;
  if (keyInput.type === 'password') {
    keyInput.type = 'text';
    icon.className = 'fa-solid fa-eye';
  } else {
    keyInput.type = 'password';
    icon.className = 'fa-solid fa-eye-slash';
  }
}

async function testSupabaseConnection() {
  const rawUrl = document.getElementById('cfg-supabase-url')?.value.trim();
  const url = sanitizeSupabaseUrl(rawUrl);
  const key = document.getElementById('cfg-supabase-key')?.value.trim();
  const resBox = document.getElementById('test-conn-result');

  if (!url || !key) {
    if (resBox) {
      resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-amber-50 text-amber-800 border border-amber-200';
      resBox.textContent = 'សូមបំពេញ Supabase URL និង Anon Key ជាមុនសិន!';
      resBox.classList.remove('hidden');
    }
    return;
  }

  if (!window.supabase) {
    if (resBox) {
      resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-rose-50 text-rose-800 border border-rose-200';
      resBox.textContent = 'រកមិនឃើញ Supabase JS Library! សូមពិនិត្យការតភ្ជាប់ Internet។';
      resBox.classList.remove('hidden');
    }
    return;
  }

  if (resBox) {
    resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-slate-100 text-slate-700';
    resBox.textContent = 'កំពុងតេស្តការតភ្ជាប់...';
    resBox.classList.remove('hidden');
  }

  try {
    const testClient = window.supabase.createClient(url, key);
    const { data, error } = await testClient.from('pac_ledger').select('id').limit(1);
    if (error) {
      if (resBox) {
        resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-rose-50 text-rose-700 border border-rose-200';
        resBox.textContent = `បរាជ័យ៖ ${error.message} (សូមប្រាកដថាបាន Run supabase_schema.sql រួច)`;
      }
    } else {
      if (resBox) {
        resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
        resBox.textContent = '✓ ការតភ្ជាប់ជោគជ័យ! Database ដំណើរការយ៉ាងរលូន។';
      }
    }
  } catch (err) {
    if (resBox) {
      resBox.className = 'text-xs p-2.5 rounded-xl font-medium bg-rose-50 text-rose-700 border border-rose-200';
      resBox.textContent = `កំហុស៖ ${err.message}`;
    }
  }
}

async function saveSupabaseConfig() {
  const rawUrl = document.getElementById('cfg-supabase-url')?.value.trim();
  const url = sanitizeSupabaseUrl(rawUrl);
  const key = document.getElementById('cfg-supabase-key')?.value.trim();

  if (!url || !key) {
    alert('សូមបំពេញ URL និង Anon Key');
    return;
  }

  localStorage.setItem('pac_supabase_url', url);
  localStorage.setItem('pac_supabase_key', key);

  await initSupabase();
  closeSupabaseModal();
  showSaveToast('បានរក្សាទុកការកំណត់ Supabase និងភ្ជាប់រួចរាល់!');
}

function disconnectSupabase() {
  if (confirm('តើអ្នកពិតជាចង់ផ្តាច់ការតភ្ជាប់ពី Supabase ហើយប្តូរមកប្រើ LocalStorage វិញមែនទេ?')) {
    localStorage.removeItem('pac_supabase_url');
    localStorage.removeItem('pac_supabase_key');
    if (realtimeSubscription && supabaseClient) {
      supabaseClient.removeChannel(realtimeSubscription);
    }
    supabaseClient = null;
    updateSupabaseUIStatus('disconnected');
    closeSupabaseModal();
    showSaveToast('បានផ្តាច់ពី Supabase (ប្តូរមក LocalStorage)');
  }
}

// Push LocalStorage data to Supabase (Migration)
async function pushLocalDataToSupabase() {
  if (!isSupabaseConnected || !supabaseClient) {
    alert('សូមភ្ជាប់ Supabase ជាមុនសិន!');
    return;
  }
  const btn = document.getElementById('btn-push-data');
  const syncResult = document.getElementById('sync-result');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>កំពុងផ្ទេរ...</span>';
  }
  if (syncResult) {
    syncResult.classList.remove('hidden', 'bg-rose-50', 'text-rose-700', 'bg-emerald-50', 'text-emerald-700');
    syncResult.classList.add('bg-blue-50', 'text-blue-700');
    syncResult.textContent = 'កំពុងបញ្ជូនទិន្នន័យទៅកាន់ Supabase Cloud...';
  }

  try {
    const ledgerPayloads = ledgerData.map(mapLedgerToSupabase);
    const invoicePayloads = invoiceData.map(mapInvoiceToSupabase);

    if (ledgerPayloads.length > 0) {
      const { error: lErr } = await supabaseClient.from('pac_ledger').upsert(ledgerPayloads, { onConflict: 'id' });
      if (lErr) throw lErr;
    }

    if (invoicePayloads.length > 0) {
      const { error: iErr } = await supabaseClient.from('pac_invoices').upsert(invoicePayloads, { onConflict: 'id' });
      if (iErr) throw iErr;
    }

    // Sync PIN settings to Supabase pac_settings
    const vPin = localStorage.getItem('pac_pin_viewer') || DEFAULT_PINS.viewer;
    const ePin = localStorage.getItem('pac_pin_editor') || DEFAULT_PINS.editor;
    const pinPayloads = [
      { key: 'pin_viewer', value: vPin, updated_at: new Date().toISOString() },
      { key: 'pin_editor', value: ePin, updated_at: new Date().toISOString() }
    ];
    await supabaseClient.from('pac_settings').upsert(pinPayloads, { onConflict: 'key' }).catch(() => {});

    if (syncResult) {
      syncResult.className = 'text-xs p-2 rounded-xl font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
      syncResult.textContent = `✓ ផ្ទេរទិន្នន័យជោគជ័យ! (${ledgerPayloads.length} ចំណូល-ចំណាយ, ${invoicePayloads.length} វិក្កយបត្រ, PIN Settings)`;
    }
    showSaveToast('បានផ្ទេរទិន្នន័យទៅ Supabase ជោគជ័យ!');
  } catch (err) {
    console.error('Push error:', err);
    if (syncResult) {
      syncResult.className = 'text-xs p-2 rounded-xl font-medium bg-rose-50 text-rose-700 border border-rose-200';
      syncResult.textContent = 'បរាជ័យក្នុងការផ្ទេរ៖ ' + (err.message || 'សូមពិនិត្យមើល RLS Policies ឬ Table Schema');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-xs"></i> <span>ផ្ទេរទៅ Supabase</span>';
    }
  }
}

/* ==========================================================================
   RECEIPT IMAGE MANAGEMENT & MODAL VIEWER
   ========================================================================== */

function openReceiptModalForInvoice(invoiceId) {
  currentActiveReceiptInvoiceId = invoiceId;
  const item = invoiceData.find(d => d.id === invoiceId);
  const modal = document.getElementById('receipt-modal');
  const imgEl = document.getElementById('receipt-modal-img');
  const emptyEl = document.getElementById('receipt-empty-state');
  const titleEl = document.getElementById('receipt-modal-title');
  const subtitleEl = document.getElementById('receipt-modal-subtitle');
  const downloadBtn = document.getElementById('btn-download-receipt');

  if (!modal) return;

  const invNo = item?.invNo ? `(${item.invNo})` : '';
  const label = item?.label ? item.label : 'វិក្កយបត្រ';
  if (titleEl) titleEl.textContent = `បង្កាន់ដៃ៖ ${label} ${invNo}`;
  if (subtitleEl) subtitleEl.textContent = item?.date ? `កាលបរិច្ឆេទ៖ ${item.date}` : 'ពិនិត្យផ្ទៀងផ្ទាត់ភស្តុតាងចំណាយ';

  currentReceiptZoom = 1;
  if (imgEl) imgEl.style.transform = 'scale(1)';

  if (item && item.receiptUrl) {
    if (imgEl) {
      imgEl.src = item.receiptUrl;
      imgEl.classList.remove('hidden');
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (downloadBtn) {
      downloadBtn.href = item.receiptUrl;
      downloadBtn.classList.remove('hidden');
    }
  } else {
    if (imgEl) {
      imgEl.src = '';
      imgEl.classList.add('hidden');
    }
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (downloadBtn) downloadBtn.classList.add('hidden');
  }

  // Adjust editor controls in modal based on role
  const isViewer = currentUserRole === 'viewer';
  document.querySelectorAll('#receipt-modal .editor-only').forEach(el => {
    el.style.display = isViewer ? 'none' : '';
  });

  modal.classList.remove('hidden');
}

function closeReceiptModal() {
  const modal = document.getElementById('receipt-modal');
  if (modal) modal.classList.add('hidden');
  currentActiveReceiptInvoiceId = null;
}

function zoomReceiptImage(delta) {
  const imgEl = document.getElementById('receipt-modal-img');
  if (!imgEl) return;
  currentReceiptZoom = Math.max(0.4, Math.min(3.0, currentReceiptZoom + delta));
  imgEl.style.transform = `scale(${currentReceiptZoom})`;
}

function resetReceiptZoom() {
  const imgEl = document.getElementById('receipt-modal-img');
  if (!imgEl) return;
  currentReceiptZoom = 1;
  imgEl.style.transform = 'scale(1)';
}

function triggerReceiptUpload() {
  if (currentUserRole === 'viewer') {
    alert('សិទ្ធិថ្នាក់ដឹកនាំ (Viewer) មិនអាច Upload ឬកែប្រែរូបភាពបានឡើយ។');
    return;
  }
  const fileInput = document.getElementById('receipt-file-input');
  if (fileInput) fileInput.click();
}

async function handleReceiptFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !currentActiveReceiptInvoiceId) return;

  if (file.size > 5 * 1024 * 1024) {
    alert('ទំហំរូបភាពមិនអាចលើសពី 5MB បានទេ!');
    return;
  }

  showSaveToast('កំពុង Upload រូបភាពវិក្កយបត្រ...');

  const invoiceId = currentActiveReceiptInvoiceId;
  const item = invoiceData.find(d => d.id === invoiceId);

  // If Supabase is connected, upload to storage bucket pac_receipts
  if (isSupabaseConnected && supabaseClient) {
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `receipt_${invoiceId}_${Date.now()}.${fileExt}`;
      const filePath = `invoices/${fileName}`;

      const { error: uploadErr } = await supabaseClient.storage
        .from('pac_receipts')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: pubData } = supabaseClient.storage
        .from('pac_receipts')
        .getPublicUrl(filePath);

      const publicUrl = pubData.publicUrl;
      if (item) item.receiptUrl = publicUrl;
      updateInvoiceData(invoiceId, 'receiptUrl', publicUrl);
      manualSave();
      renderInvoiceTable();
      openReceiptModalForInvoice(invoiceId);
      showSaveToast('✓ Upload រូបភាពវិក្កយបត្រជោគជ័យ!');
    } catch (err) {
      console.warn('Storage bucket upload fallback to base64:', err);
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        const base64Url = loadEvt.target.result;
        if (item) item.receiptUrl = base64Url;
        updateInvoiceData(invoiceId, 'receiptUrl', base64Url);
        manualSave();
        renderInvoiceTable();
        openReceiptModalForInvoice(invoiceId);
        showSaveToast('រក្សាទុករូបភាព (Local) ជោគជ័យ!');
      };
      reader.readAsDataURL(file);
    }
  } else {
    // Offline / Local fallback with base64
    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      const base64Url = loadEvt.target.result;
      if (item) item.receiptUrl = base64Url;
      updateInvoiceData(invoiceId, 'receiptUrl', base64Url);
      manualSave();
      renderInvoiceTable();
      openReceiptModalForInvoice(invoiceId);
      showSaveToast('រក្សាទុករូបភាព (Local) ជោគជ័យ!');
    };
    reader.readAsDataURL(file);
  }

  e.target.value = '';
}

function deleteCurrentReceipt() {
  if (currentUserRole === 'viewer') {
    alert('សិទ្ធិថ្នាក់ដឹកនាំ (Viewer) មិនអាចលុបរូបភាពបានឡើយ។');
    return;
  }
  if (!currentActiveReceiptInvoiceId) return;
  if (confirm('តើអ្នកពិតជាចង់លុបរូបភាពវិក្កយបត្រនេះមែនទេ?')) {
    const invoiceId = currentActiveReceiptInvoiceId;
    const item = invoiceData.find(d => d.id === invoiceId);
    if (item) item.receiptUrl = '';
    updateInvoiceData(invoiceId, 'receiptUrl', '');
    manualSave();
    renderInvoiceTable();
    openReceiptModalForInvoice(invoiceId);
    showSaveToast('បានលុបរូបភាពវិក្កយបត្រ!');
  }
}

/* ==========================================================================
   ROLE-BASED ACCESS CONTROL (RBAC), LOGIN PORTAL & SUPABASE AUTH
   ========================================================================== */

function getRolePin(role) {
  if (role === 'viewer') {
    return localStorage.getItem('pac_pin_viewer') || DEFAULT_PINS.viewer;
  } else {
    return localStorage.getItem('pac_pin_editor') || DEFAULT_PINS.editor;
  }
}

function checkLoginSession() {
  const sessionStr = localStorage.getItem('pac_auth_session') || sessionStorage.getItem('pac_auth_session');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      if (session && session.isLoggedIn) {
        isAppLoggedIn = true;
        currentUserRole = session.role || 'viewer';
        localStorage.setItem('pac_user_role', currentUserRole);
        showMainApp();
        applyRolePermissions();
        return;
      }
    } catch (e) {
      console.warn('Session parse error:', e);
    }
  }

  // Not logged in: Show login portal
  showLoginPortal();
}

function showLoginPortal() {
  isAppLoggedIn = false;
  const portal = document.getElementById('login-portal');
  const app = document.getElementById('app-container');
  if (portal) portal.classList.remove('hidden');
  if (app) app.classList.add('hidden');
  selectLoginRole(selectedPortalRole || 'viewer');
}

function showMainApp() {
  isAppLoggedIn = true;
  const portal = document.getElementById('login-portal');
  const app = document.getElementById('app-container');
  if (portal) portal.classList.add('hidden');
  if (app) app.classList.remove('hidden');

  // កំណត់ទម្រង់បង្ហាញខុសពី Computer លើទូរសព្ទដៃ (Mobile Phone layout & scrolling)
  if (window.innerWidth <= 768) {
    document.body.classList.add('is-mobile-screen');
    // បង្រួម Graph Charts ជាមុនលើទូរសព្ទដៃ ដើម្បីបង្ហាញទិន្នន័យតារាងភ្លាមៗ មិនបាំងកម្ពស់
    const chartContainer = document.getElementById('chart-canvas-container');
    const chartIcon = document.getElementById('chart-toggle-icon');
    if (chartContainer && !chartContainer.classList.contains('hidden')) {
      chartContainer.classList.add('hidden');
      if (chartIcon) chartIcon.className = 'fa-solid fa-chevron-down text-xs';
    }
    // រុញ Scroll មកលើគេបង្អស់ពេលទើប Login
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    document.body.classList.remove('is-mobile-screen');
  }
}

function selectLoginRole(role) {
  selectedPortalRole = role;
  
  const tabViewer = document.getElementById('login-tab-viewer');
  const tabEditor = document.getElementById('login-tab-editor');
  const roleTitle = document.getElementById('login-role-title');
  const roleDesc = document.getElementById('login-role-desc');
  const roleBadge = document.getElementById('login-role-badge');
  const roleIcon = document.getElementById('login-role-icon');
  const pinHint = document.getElementById('login-pin-hint');
  const pinInput = document.getElementById('login-pin-input');
  const errorMsg = document.getElementById('login-error-msg');

  if (errorMsg) errorMsg.classList.add('hidden');
  if (pinInput) {
    pinInput.value = '';
    pinInput.type = 'password';
    const eyeIcon = document.getElementById('login-eye-icon');
    if (eyeIcon) eyeIcon.className = 'fa-regular fa-eye-slash text-sm';
    if (window.innerWidth > 640) {
      pinInput.focus();
    }
  }

  const isViewer = role === 'viewer';
  const currentPin = getRolePin(role);

  if (tabViewer) {
    tabViewer.className = isViewer
      ? 'py-2.5 px-2 rounded-xl transition flex flex-col items-center gap-1 cursor-pointer role-tab-active'
      : 'py-2.5 px-2 rounded-xl transition flex flex-col items-center gap-1 cursor-pointer role-tab-inactive';
  }
  if (tabEditor) {
    tabEditor.className = !isViewer
      ? 'py-2.5 px-2 rounded-xl transition flex flex-col items-center gap-1 cursor-pointer role-tab-active'
      : 'py-2.5 px-2 rounded-xl transition flex flex-col items-center gap-1 cursor-pointer role-tab-inactive';
  }

  if (roleTitle) {
    roleTitle.textContent = isViewer ? 'ចូលជា ថ្នាក់ដឹកនាំ (Viewer)' : 'ចូលជា អ្នកកត់ត្រាហិរញ្ញវត្ថុ (Editor)';
  }
  if (roleDesc) {
    roleDesc.textContent = isViewer 
      ? 'ពិនិត្យរបាយការណ៍ វិភាគក្រាហ្វិក ពិនិត្យវិក្កយបត្រ Export PDF'
      : 'បញ្ចូល កែសម្រួល លុប និង Upload រូបភាពវិក្កយបត្រ (ពេញសិទ្ធិ)';
  }
  if (roleBadge) {
    roleBadge.className = isViewer
      ? 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 shrink-0'
      : 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shrink-0';
    roleBadge.textContent = isViewer ? 'Read-Only' : 'Full Access';
  }
  if (roleIcon) {
    roleIcon.className = isViewer
      ? 'w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm shrink-0'
      : 'w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm shrink-0';
    roleIcon.innerHTML = isViewer ? '<i class="fa-solid fa-crown"></i>' : '<i class="fa-solid fa-user-pen"></i>';
  }
}

function fillDefaultPin() {
  const pinInput = document.getElementById('login-pin-input');
  if (pinInput) {
    pinInput.value = getRolePin(selectedPortalRole);
    pinInput.focus();
  }
}

function toggleLoginPasswordVisibility() {
  const input = document.getElementById('login-pin-input');
  const icon = document.getElementById('login-eye-icon');
  if (!input || !icon) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fa-regular fa-eye text-sm';
  } else {
    input.type = 'password';
    icon.className = 'fa-regular fa-eye-slash text-sm';
  }
}

function toggleKeypad() {
  const keypad = document.getElementById('login-keypad');
  const label = document.getElementById('keypad-toggle-label');
  if (!keypad) return;
  if (keypad.classList.contains('hidden')) {
    keypad.classList.remove('hidden');
    keypad.classList.add('grid');
    if (label) label.textContent = 'បិទលេខចុច';
  } else {
    keypad.classList.add('hidden');
    keypad.classList.remove('grid');
    if (label) label.textContent = 'លេខចុចអេក្រង់';
  }
}

function appendPinDigit(digit) {
  const input = document.getElementById('login-pin-input');
  if (input) {
    input.value += digit;
  }
}

function clearPin() {
  const input = document.getElementById('login-pin-input');
  if (input) {
    input.value = '';
  }
}

function backspacePin() {
  const input = document.getElementById('login-pin-input');
  if (input && input.value.length > 0) {
    input.value = input.value.slice(0, -1);
  }
}

function handlePinLoginSubmit(e) {
  if (e) e.preventDefault();
  
  const pinInput = document.getElementById('login-pin-input');
  const errorBox = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');
  const rememberMe = document.getElementById('login-remember-me')?.checked ?? true;
  
  const enteredPin = pinInput?.value?.trim();
  const correctPin = getRolePin(selectedPortalRole);

  if (!enteredPin) {
    if (errorBox && errorText) {
      errorText.textContent = 'សូមបញ្ចូលលេខកូដសម្ងាត់ PIN!';
      errorBox.classList.remove('hidden');
    }
    if (pinInput) pinInput.focus();
    return;
  }

  if (enteredPin !== correctPin) {
    if (errorBox && errorText) {
      errorText.textContent = 'លេខកូដសម្ងាត់មិនត្រឹមត្រូវទេ! សូមព្យាយាមម្តងទៀត។';
      errorBox.classList.remove('hidden');
    }
    if (pinInput) {
      pinInput.classList.add('border-rose-500');
      setTimeout(() => pinInput.classList.remove('border-rose-500'), 1500);
      pinInput.focus();
      pinInput.select();
    }
    return;
  }

  // PIN is correct!
  if (errorBox) errorBox.classList.add('hidden');

  currentUserRole = selectedPortalRole;
  localStorage.setItem('pac_user_role', currentUserRole);

  const sessionData = {
    isLoggedIn: true,
    role: currentUserRole,
    roleName: currentUserRole === 'viewer' ? 'ថ្នាក់ដឹកនាំ (Viewer)' : 'អ្នកកត់ត្រា (Editor)',
    rememberMe: rememberMe,
    loginAt: new Date().toISOString()
  };

  if (rememberMe) {
    localStorage.setItem('pac_auth_session', JSON.stringify(sessionData));
    sessionStorage.removeItem('pac_auth_session');
  } else {
    sessionStorage.setItem('pac_auth_session', JSON.stringify(sessionData));
    localStorage.removeItem('pac_auth_session');
  }

  showMainApp();
  applyRolePermissions();

  const roleKhmer = currentUserRole === 'viewer' ? 'ថ្នាក់ដឹកនាំ (Viewer)' : 'អ្នកកត់ត្រា (Editor)';
  showSaveToast(`ចូលប្រព័ន្ធជោគជ័យ៖ ${roleKhmer}`);

  setTimeout(() => {
    if (typeof updateFinancialCharts === 'function') {
      updateFinancialCharts();
    }
  }, 100);
}

function handleAppLogout() {
  if (confirm('តើអ្នកពិតជាចង់ចាកចេញពីប្រព័ន្ធមែនទេ?')) {
    localStorage.removeItem('pac_auth_session');
    sessionStorage.removeItem('pac_auth_session');
    isAppLoggedIn = false;
    
    closeAuthModal();
    showLoginPortal();
    showSaveToast('បានចាកចេញពីប្រព័ន្ធដោយជោគជ័យ');
  }
}

function toggleSupabasePortalForm() {
  const form = document.getElementById('portal-supabase-form');
  const toggleText = document.getElementById('supabase-toggle-text');
  if (!form) return;
  if (form.classList.contains('hidden')) {
    form.classList.remove('hidden');
    if (toggleText) toggleText.textContent = 'បិទផ្ទាំង Supabase Cloud';
  } else {
    form.classList.add('hidden');
    if (toggleText) toggleText.textContent = 'ចូលដោយគណនី Supabase Cloud (Email)';
  }
}

async function handlePortalSupabaseSignIn() {
  const email = document.getElementById('portal-supabase-email')?.value.trim();
  const password = document.getElementById('portal-supabase-password')?.value;
  const errorBox = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');

  if (!email || !password) {
    if (errorBox && errorText) {
      errorText.textContent = 'សូមបញ្ចូល Email និង Password របស់ Supabase!';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  if (!supabaseClient) {
    if (errorBox && errorText) {
      errorText.textContent = 'សូមភ្ជាប់ Supabase ជាមុនសិន!';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    currentAuthUser = data.user;
    if (data.user?.user_metadata?.role) {
      currentUserRole = data.user.user_metadata.role;
    } else {
      currentUserRole = selectedPortalRole || 'editor';
    }
    localStorage.setItem('pac_user_role', currentUserRole);

    const sessionData = {
      isLoggedIn: true,
      role: currentUserRole,
      email: data.user.email,
      loginAt: new Date().toISOString()
    };
    localStorage.setItem('pac_auth_session', JSON.stringify(sessionData));

    showMainApp();
    applyRolePermissions();
    showSaveToast(`ចូលគណនី Supabase ជោគជ័យ៖ ${data.user.email}`);
  } catch (err) {
    if (errorBox && errorText) {
      errorText.textContent = `ចូល Supabase បរាជ័យ៖ ${err.message}`;
      errorBox.classList.remove('hidden');
    }
  }
}

async function savePinSettings() {
  const pinViewerInput = document.getElementById('setting-pin-viewer');
  const pinEditorInput = document.getElementById('setting-pin-editor');

  const vPin = pinViewerInput?.value?.trim();
  const ePin = pinEditorInput?.value?.trim();

  if (vPin) {
    localStorage.setItem('pac_pin_viewer', vPin);
  }
  if (ePin) {
    localStorage.setItem('pac_pin_editor', ePin);
  }

  showSaveToast('បានរក្សាទុកលេខកូដសម្ងាត់ PIN ថ្មី!');
  selectLoginRole(selectedPortalRole);

  // Sync ទៅកាន់ Supabase Cloud Database ប្រសិនបើបានភ្ជាប់
  if (supabaseClient) {
    try {
      const updates = [];
      if (vPin) updates.push({ key: 'pin_viewer', value: vPin, updated_at: new Date().toISOString() });
      if (ePin) updates.push({ key: 'pin_editor', value: ePin, updated_at: new Date().toISOString() });

      const { error } = await supabaseClient
        .from('pac_settings')
        .upsert(updates, { onConflict: 'key' });

      if (error) {
        console.warn('Supabase PIN sync warning:', error.message);
        if (error.code === 'PGRST205' || error.message?.includes('pac_settings')) {
          showSaveToast('⚠️ សូម Run SQL បង្កើត Table pac_settings ក្នុង Supabase ដើម្បី Sync PIN ឆ្លងឧបករណ៍');
        }
      } else {
        showSaveToast('✓ បាន Sync លេខកូដ PIN ទៅ Supabase រួចរាល់!');
      }
    } catch (err) {
      console.warn('Sync PIN error:', err);
    }
  }
}

function openAuthModal() {
  if (currentUserRole !== 'editor') {
    showSaveToast('🔒 ផ្ទាំងកំណត់សិទ្ធិនេះសម្រាប់តែ អ្នកកត់ត្រា (Admin) ប៉ុណ្ណោះ!');
    return;
  }
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  updateAuthModalUI();
  modal.classList.remove('hidden');
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

function switchRole(role) {
  currentUserRole = role;
  localStorage.setItem('pac_user_role', role);

  const sessionStr = localStorage.getItem('pac_auth_session') || sessionStorage.getItem('pac_auth_session');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      session.role = role;
      session.roleName = role === 'viewer' ? 'ថ្នាក់ដឹកនាំ (Viewer)' : 'អ្នកកត់ត្រា (Editor)';
      if (session.rememberMe !== false) {
        localStorage.setItem('pac_auth_session', JSON.stringify(session));
      } else {
        sessionStorage.setItem('pac_auth_session', JSON.stringify(session));
      }
    } catch (e) {}
  }

  applyRolePermissions();
  if (role === 'viewer') {
    closeAuthModal();
  } else {
    updateAuthModalUI();
  }
  showSaveToast(`បានប្តូរសិទ្ធិទៅជា៖ ${role === 'viewer' ? 'ថ្នាក់ដឹកនាំ (Viewer)' : 'អ្នកកត់ត្រា (Editor)'}`);
}

function updateAuthModalUI() {
  const roleTitle = document.getElementById('modal-current-role-title');
  const rolePill = document.getElementById('modal-role-pill');
  const roleIcon = document.getElementById('modal-role-badge-icon');
  const btnViewer = document.getElementById('btn-role-viewer');
  const btnEditor = document.getElementById('btn-role-editor');

  const isViewer = currentUserRole === 'viewer';

  if (roleTitle) roleTitle.textContent = isViewer ? 'ថ្នាក់ដឹកនាំ (Viewer)' : 'អ្នកកត់ត្រាហិរញ្ញវត្ថុ (Editor)';
  if (rolePill) {
    rolePill.className = isViewer ? 'text-xs px-2.5 py-1 rounded-full font-bold bg-blue-100 text-blue-800' : 'text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800';
    rolePill.textContent = isViewer ? 'Read-Only' : 'Full Access';
  }
  if (roleIcon) {
    roleIcon.className = isViewer ? 'w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-lg' : 'w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg';
    roleIcon.innerHTML = isViewer ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-user-pen"></i>';
  }

  if (btnViewer) {
    btnViewer.className = isViewer ? 'p-3 rounded-xl border-2 border-blue-500 bg-blue-50/60 transition text-left space-y-1 cursor-pointer shadow-sm' : 'p-3 rounded-xl border border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 transition text-left space-y-1 cursor-pointer';
  }
  if (btnEditor) {
    btnEditor.className = !isViewer ? 'p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/60 transition text-left space-y-1 cursor-pointer shadow-sm' : 'p-3 rounded-xl border border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/50 transition text-left space-y-1 cursor-pointer';
  }

  // Populate PIN settings fields
  const pinViewerInput = document.getElementById('setting-pin-viewer');
  const pinEditorInput = document.getElementById('setting-pin-editor');
  if (pinViewerInput) pinViewerInput.value = getRolePin('viewer');
  if (pinEditorInput) pinEditorInput.value = getRolePin('editor');

  // Update Supabase Auth UI state
  const loggedEmail = document.getElementById('auth-logged-in-email');
  const loginFields = document.getElementById('auth-login-fields');
  const logoutWrapper = document.getElementById('auth-logout-wrapper');
  if (currentAuthUser) {
    if (loggedEmail) {
      loggedEmail.textContent = `Logged in: ${currentAuthUser.email}`;
      loggedEmail.classList.remove('hidden');
    }
    if (loginFields) loginFields.classList.add('hidden');
    if (logoutWrapper) logoutWrapper.classList.remove('hidden');
  } else {
    if (loggedEmail) loggedEmail.classList.add('hidden');
    if (loginFields) loginFields.classList.remove('hidden');
    if (logoutWrapper) logoutWrapper.classList.add('hidden');
  }
}

function applyRolePermissions() {
  const isViewer = currentUserRole === 'viewer';

  // Toggle body class for clean viewer styling
  document.body.classList.toggle('role-viewer', isViewer);

  // Executive Leadership Banner
  const execBanner = document.getElementById('executive-banner');
  if (execBanner) {
    if (isViewer) execBanner.classList.remove('hidden');
    else execBanner.classList.add('hidden');
  }

  // Ensure auth-modal is closed if viewer
  if (isViewer) {
    closeAuthModal();
  }

  // Header Role Button Update
  const roleLabel = document.getElementById('user-role-label');
  const roleIcon = document.getElementById('user-role-icon');
  const authBtn = document.getElementById('btn-user-auth');
  const viewerBadge = document.getElementById('viewer-role-badge');

  if (roleLabel) roleLabel.textContent = 'អ្នកកត់ត្រា (Admin)';
  if (roleIcon) roleIcon.innerHTML = '<i class="fa-solid fa-user-pen text-amber-400"></i>';
  if (authBtn) {
    authBtn.style.display = isViewer ? 'none' : '';
  }
  if (viewerBadge) {
    if (isViewer) {
      viewerBadge.classList.remove('hidden');
    } else {
      viewerBadge.classList.add('hidden');
    }
  }

  // Hide or Show Action controls
  const btnCloseMonth = document.getElementById('btn-close-month');
  const btnAddTable = document.getElementById('btn-add-table');
  const btnManualSave = document.getElementById('btn-manual-save');
  const btnManualSaveInv = document.getElementById('btn-manual-save-inv');
  const btnAddInv = document.getElementById('btn-add-inv-row');

  if (btnCloseMonth) btnCloseMonth.style.display = isViewer ? 'none' : '';
  if (btnAddTable) btnAddTable.style.display = isViewer ? 'none' : '';
  if (btnManualSave) btnManualSave.style.display = isViewer ? 'none' : '';
  if (btnManualSaveInv) btnManualSaveInv.style.display = isViewer ? 'none' : '';
  if (btnAddInv) btnAddInv.style.display = isViewer ? 'none' : '';

  // Hide or show editor-only elements
  document.querySelectorAll('.editor-only').forEach(el => {
    el.style.display = isViewer ? 'none' : '';
  });

  // Re-render tables to enforce disabled inputs / clean display
  renderTable();
  renderInvoiceTable();

  // Update executive dashboard charts
  if (typeof updateFinancialCharts === 'function') {
    updateFinancialCharts();
  }
}

/* ==========================================================================
   EXECUTIVE DASHBOARD & FINANCIAL CHARTS (CHART.JS)
   ========================================================================== */

function parseAmountValue(val) {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function getChartMonthlyAggregates(year, currency) {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthLabels = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];

  const incomeData = [];
  const expenseData = [];
  const netData = [];

  let totalIncome = 0;
  let totalExpense = 0;

  months.forEach(m => {
    const prefix = `${year}-${m}`;
    const rows = ledgerData.filter(item => item.date && item.date.startsWith(prefix));

    let mInc = 0;
    let mExp = 0;

    rows.forEach(r => {
      // Exclude opening balance to avoid double-counting prior months
      if (!r.isOpening) {
        const incVal = currency === 'KHR' ? parseAmountValue(r.incKhr) : parseAmountValue(r.incUsd);
        if (incVal > 0) mInc += incVal;
      }
      const expVal = currency === 'KHR' ? parseAmountValue(r.expKhr) : parseAmountValue(r.expUsd);
      if (expVal > 0) mExp += expVal;
    });

    incomeData.push(mInc);
    expenseData.push(mExp);
    netData.push(mInc - mExp);

    totalIncome += mInc;
    totalExpense += mExp;
  });

  const totalNet = totalIncome - totalExpense;
  const expRatio = totalIncome > 0 ? Math.min(100, Math.round((totalExpense / totalIncome) * 100)) : (totalExpense > 0 ? 100 : 0);
  const saveRatio = totalIncome > 0 ? Math.max(0, Math.round(((totalIncome - totalExpense) / totalIncome) * 100)) : 0;

  return {
    labels: monthLabels,
    incomeData,
    expenseData,
    netData,
    totalIncome,
    totalExpense,
    totalNet,
    expRatio,
    saveRatio
  };
}

function initFinancialCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js library is not loaded');
    return;
  }

  // Configure Chart.js default font to Kantumruy Pro
  Chart.defaults.font.family = "'Kantumruy Pro', sans-serif";

  const trendsCanvas = document.getElementById('monthly-trends-chart');
  const doughnutCanvas = document.getElementById('summary-doughnut-chart');

  if (trendsCanvas && !monthlyTrendsChart) {
    const ctx = trendsCanvas.getContext('2d');
    monthlyTrendsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            type: 'bar',
            label: 'ចំណូល',
            data: [],
            backgroundColor: 'rgba(16, 185, 129, 0.85)',
            hoverBackgroundColor: 'rgba(5, 150, 105, 1)',
            borderColor: 'rgba(16, 185, 129, 1)',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 28,
            order: 2
          },
          {
            type: 'bar',
            label: 'ចំណាយ',
            data: [],
            backgroundColor: 'rgba(244, 63, 94, 0.85)',
            hoverBackgroundColor: 'rgba(225, 29, 72, 1)',
            borderColor: 'rgba(244, 63, 94, 1)',
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 28,
            order: 3
          },
          {
            type: 'line',
            label: 'សមតុល្យប្រចាំខែ',
            data: [],
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 2.5,
            pointBackgroundColor: '#4f46e5',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: false,
            tension: 0.35,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              font: { family: 'Kantumruy Pro', size: 12 },
              boxWidth: 14,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            padding: 10,
            cornerRadius: 10,
            titleFont: { family: 'Kantumruy Pro', size: 12, weight: 'bold' },
            bodyFont: { family: 'Kantumruy Pro', size: 11 },
            callbacks: {
              label: function(context) {
                const val = context.raw || 0;
                const formatted = currentChartCurrency === 'KHR'
                  ? val.toLocaleString('en-US') + '៛'
                  : '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return ` ${context.dataset.label}: ${formatted}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'Kantumruy Pro', size: 11 },
              color: '#64748b'
            }
          },
          y: {
            grid: { color: 'rgba(226, 232, 240, 0.7)' },
            ticks: {
              font: { family: 'Kantumruy Pro', size: 11 },
              color: '#64748b',
              callback: function(value) {
                if (currentChartCurrency === 'KHR') {
                  if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M៛';
                  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(0) + 'k៛';
                  return value.toLocaleString('en-US') + '៛';
                } else {
                  if (Math.abs(value) >= 1000) return '$' + (value / 1000).toFixed(1) + 'k';
                  return '$' + value.toLocaleString('en-US');
                }
              }
            }
          }
        }
      }
    });
  }

  if (doughnutCanvas && !summaryDoughnutChart) {
    const ctx = doughnutCanvas.getContext('2d');
    summaryDoughnutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['ចំណូលសរុប', 'ចំណាយសរុប'],
        datasets: [{
          data: [0, 0],
          backgroundColor: ['#10b981', '#f43f5e'],
          hoverBackgroundColor: ['#059669', '#e11d48'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Kantumruy Pro', size: 11 },
              boxWidth: 12,
              padding: 12
            }
          },
          tooltip: {
            padding: 8,
            cornerRadius: 8,
            bodyFont: { family: 'Kantumruy Pro', size: 11 },
            callbacks: {
              label: function(context) {
                const val = context.raw || 0;
                const formatted = currentChartCurrency === 'KHR'
                  ? val.toLocaleString('en-US') + '៛'
                  : '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return ` ${context.label}: ${formatted}`;
              }
            }
          }
        }
      }
    });
  }

  updateFinancialCharts();
}

function updateFinancialCharts() {
  if (!monthlyTrendsChart || !summaryDoughnutChart) return;

  const ySelect = document.getElementById('year-select');
  const year = ySelect ? ySelect.value : new Date().getFullYear().toString();

  const labelEl = document.getElementById('chart-year-label');
  if (labelEl) labelEl.textContent = `(ឆ្នាំ ${year})`;

  const aggregates = getChartMonthlyAggregates(year, currentChartCurrency);

  // Update Combo Chart
  monthlyTrendsChart.data.labels = aggregates.labels;
  monthlyTrendsChart.data.datasets[0].data = aggregates.incomeData;
  monthlyTrendsChart.data.datasets[1].data = aggregates.expenseData;
  monthlyTrendsChart.data.datasets[2].data = aggregates.netData;
  monthlyTrendsChart.update();

  // Update Doughnut Chart
  const hasData = aggregates.totalIncome > 0 || aggregates.totalExpense > 0;
  if (hasData) {
    summaryDoughnutChart.data.labels = ['ចំណូលសរុប', 'ចំណាយសរុប'];
    summaryDoughnutChart.data.datasets[0].data = [aggregates.totalIncome, aggregates.totalExpense];
    summaryDoughnutChart.data.datasets[0].backgroundColor = ['#10b981', '#f43f5e'];
  } else {
    summaryDoughnutChart.data.labels = ['គ្មានទិន្នន័យ'];
    summaryDoughnutChart.data.datasets[0].data = [1];
    summaryDoughnutChart.data.datasets[0].backgroundColor = ['#e2e8f0'];
  }
  summaryDoughnutChart.update();

  // Update Ratio Badges
  const expRatioEl = document.getElementById('chart-exp-ratio');
  const saveRatioEl = document.getElementById('chart-save-ratio');
  if (expRatioEl) expRatioEl.textContent = `${aggregates.expRatio}%`;
  if (saveRatioEl) saveRatioEl.textContent = `${aggregates.saveRatio}%`;
}

function switchChartCurrency(currency) {
  currentChartCurrency = currency;
  const btnUsd = document.getElementById('btn-chart-usd');
  const btnKhr = document.getElementById('btn-chart-khr');

  if (currency === 'USD') {
    if (btnUsd) btnUsd.className = 'px-2.5 py-1 rounded-lg font-bold text-xs bg-white text-blue-700 shadow-sm transition cursor-pointer';
    if (btnKhr) btnKhr.className = 'px-2.5 py-1 rounded-lg font-bold text-xs text-slate-600 hover:text-slate-900 transition cursor-pointer';
  } else {
    if (btnKhr) btnKhr.className = 'px-2.5 py-1 rounded-lg font-bold text-xs bg-white text-blue-700 shadow-sm transition cursor-pointer';
    if (btnUsd) btnUsd.className = 'px-2.5 py-1 rounded-lg font-bold text-xs text-slate-600 hover:text-slate-900 transition cursor-pointer';
  }

  updateFinancialCharts();
}

function toggleChartsVisibility() {
  const container = document.getElementById('chart-canvas-container');
  const icon = document.getElementById('chart-toggle-icon');
  if (!container) return;

  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    if (icon) icon.className = 'fa-solid fa-chevron-up text-xs';
  } else {
    container.classList.add('hidden');
    if (icon) icon.className = 'fa-solid fa-chevron-down text-xs';
  }
}

// Supabase Auth Integration
async function handleSupabaseSignIn() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const msgBox = document.getElementById('auth-message');

  if (!email || !password) {
    if (msgBox) {
      msgBox.className = 'text-xs p-2 rounded-xl font-medium bg-amber-50 text-amber-800 border border-amber-200';
      msgBox.textContent = 'សូមបញ្ចូល Email និង Password';
      msgBox.classList.remove('hidden');
    }
    return;
  }

  if (!supabaseClient) {
    alert('សូមភ្ជាប់ Supabase ជាមុនសិន!');
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentAuthUser = data.user;
    if (data.user?.user_metadata?.role) {
      currentUserRole = data.user.user_metadata.role;
      localStorage.setItem('pac_user_role', currentUserRole);
    }
    applyRolePermissions();
    updateAuthModalUI();
    showSaveToast(`ចូលគណនីជោគជ័យ៖ ${data.user.email}`);
  } catch (err) {
    if (msgBox) {
      msgBox.className = 'text-xs p-2 rounded-xl font-medium bg-rose-50 text-rose-700 border border-rose-200';
      msgBox.textContent = `បរាជ័យ៖ ${err.message}`;
      msgBox.classList.remove('hidden');
    }
  }
}

async function handleSupabaseSignUp() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const msgBox = document.getElementById('auth-message');

  if (!email || !password) {
    if (msgBox) {
      msgBox.className = 'text-xs p-2 rounded-xl font-medium bg-amber-50 text-amber-800 border border-amber-200';
      msgBox.textContent = 'សូមបញ្ចូល Email និង Password';
      msgBox.classList.remove('hidden');
    }
    return;
  }

  if (!supabaseClient) {
    alert('សូមភ្ជាប់ Supabase ជាមុនសិន!');
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { role: currentUserRole } }
    });
    if (error) throw error;
    if (msgBox) {
      msgBox.className = 'text-xs p-2 rounded-xl font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
      msgBox.textContent = 'ចុះឈ្មោះជោគជ័យ! សូមពិនិត្យមើលអ៊ីមែលបញ្ជាក់ ឬ Sign In។';
      msgBox.classList.remove('hidden');
    }
  } catch (err) {
    if (msgBox) {
      msgBox.className = 'text-xs p-2 rounded-xl font-medium bg-rose-50 text-rose-700 border border-rose-200';
      msgBox.textContent = `កំហុស៖ ${err.message}`;
      msgBox.classList.remove('hidden');
    }
  }
}

async function handleSupabaseSignOut() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  currentAuthUser = null;
  updateAuthModalUI();
  showSaveToast('បានចាកចេញពីគណនី');
}

/* ==================== SCROLL-TO-TOP & MOBILE SCREEN HANDLER ==================== */
window.addEventListener('scroll', () => {
  const btnScrollTop = document.getElementById('btn-scroll-top');
  if (btnScrollTop) {
    if (window.scrollY > 220) {
      btnScrollTop.classList.remove('opacity-0', 'pointer-events-none');
      btnScrollTop.classList.add('opacity-100');
    } else {
      btnScrollTop.classList.remove('opacity-100');
      btnScrollTop.classList.add('opacity-0', 'pointer-events-none');
    }
  }
}, { passive: true });

window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    document.body.classList.add('is-mobile-screen');
  } else {
    document.body.classList.remove('is-mobile-screen');
  }
});