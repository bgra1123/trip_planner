importScripts('lib/capture.js');

var MENU_ID = 'trip-planner-capture';

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Add “%s” to Trip Planner',
    contexts: ['selection'],
  });
});

function refreshBadge(captures) {
  var n = (captures || []).length;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#0f172a' });
}

function addCapture(entry) {
  chrome.storage.local.get('captures').then(function (result) {
    var captures = result.captures || [];
    captures.push(entry);
    chrome.storage.local.set({ captures: captures }).then(function () {
      refreshBadge(captures);
    });
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  var text = TripCapture.cleanText(info.selectionText);
  var category = TripCapture.guessCategory(text, tab && tab.title, tab && tab.url);
  addCapture({
    id: 'c' + Date.now() + Math.floor(Math.random() * 1000),
    text: text,
    category: category,
    sourceTitle: tab ? tab.title : '',
    sourceUrl: tab ? tab.url : '',
    createdAt: new Date().toISOString(),
  });
});

chrome.storage.local.get('captures').then(function (result) {
  refreshBadge(result.captures);
});
