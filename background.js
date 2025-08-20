// Set a default badge color
chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
chrome.action.setBadgeTextColor({ color: "#FFFFFF" });

// Store per-tab counts
const tabCounts = {};

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "updateCount" && sender.tab?.id) {
    const tabId = sender.tab.id;
    tabCounts[tabId] = message.count;

    // Update badge only for that tab
    chrome.action.setBadgeText({
      text: String(message.count),
      tabId: tabId
    });
  }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCounts[tabId];
});