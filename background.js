/*
 * background.js — MV3 service worker. Only maintains the per-tab error badge.
 * content.js sends { type: "updateCount", count } after each page load.
 * (The popup also updates the badge directly after its own analysis.)
 */
chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'updateCount') return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    chrome.action.setBadgeText({ tabId, text: message.count > 0 ? String(message.count) : '' });
});
