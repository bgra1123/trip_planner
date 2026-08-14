(function () {
  'use strict';

  var listEl = document.getElementById('capture-list');
  var emptyEl = document.getElementById('empty-state');
  var statusEl = document.getElementById('status');
  var copyBtn = document.getElementById('copy-btn');
  var clearBtn = document.getElementById('clear-btn');

  var captures = [];

  function save() {
    chrome.storage.local.set({ captures: captures });
    chrome.action.setBadgeText({ text: captures.length ? String(captures.length) : '' });
  }

  function render() {
    listEl.innerHTML = '';
    emptyEl.hidden = captures.length > 0;
    captures.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'capture-item';

      var row = document.createElement('div');
      row.className = 'capture-row';

      var select = document.createElement('select');
      Object.keys(TripCapture.CATEGORY_TAG).forEach(function (cat) {
        var opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = TripCapture.CATEGORY_TAG[cat];
        if (cat === item.category) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () {
        item.category = select.value;
        save();
      });

      var textarea = document.createElement('textarea');
      textarea.value = item.text;
      textarea.rows = 2;
      function refreshPriceFlag() {
        textarea.classList.toggle('no-price', !TripCapture.hasPrice(textarea.value));
        noPriceFlag.hidden = TripCapture.hasPrice(textarea.value);
      }
      textarea.addEventListener('input', function () {
        item.text = textarea.value;
        refreshPriceFlag();
        save();
      });

      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', function () {
        captures = captures.filter(function (c) { return c.id !== item.id; });
        save();
        render();
      });

      row.appendChild(select);
      row.appendChild(textarea);
      row.appendChild(removeBtn);
      li.appendChild(row);

      var meta = document.createElement('p');
      meta.className = 'meta';
      var host = TripCapture.hostnameOf(item.sourceUrl);
      var noPriceFlag = document.createElement('span');
      noPriceFlag.className = 'no-price-flag';
      noPriceFlag.textContent = 'no price detected — edit before copying';
      noPriceFlag.hidden = TripCapture.hasPrice(item.text);
      meta.textContent = host ? ('from ' + host + '  ·  ') : '';
      meta.appendChild(noPriceFlag);
      li.appendChild(meta);

      refreshPriceFlag();
      listEl.appendChild(li);
    });
  }

  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.hidden = false;
    setTimeout(function () { statusEl.hidden = true; }, 3000);
  }

  copyBtn.addEventListener('click', function () {
    if (!captures.length) { showStatus('Nothing to copy yet.'); return; }
    var lines = captures.map(function (c) { return TripCapture.formatLine(c.category, c.text); }).join('\n');
    navigator.clipboard.writeText(lines).then(function () {
      showStatus('Copied ' + captures.length + ' line(s) — paste into your trip notes.');
    }, function () {
      showStatus('Copy failed — select and copy manually.');
    });
  });

  clearBtn.addEventListener('click', function () {
    captures = [];
    save();
    render();
  });

  chrome.storage.local.get('captures').then(function (result) {
    captures = result.captures || [];
    render();
  });
})();
