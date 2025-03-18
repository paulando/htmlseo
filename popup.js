document.addEventListener("DOMContentLoaded", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"]
        });
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.elements) {
			document.getElementById("elements").innerHTML = message.elements;

			[...document.querySelectorAll('.btn-scrollintoview')].forEach(button => {
				button.addEventListener("click", () => {
					// showElementByText(button.getAttribute("data-tag"),button.getAttribute("data-text"))
					chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
						chrome.scripting.executeScript({
							target: { tabId: tabs[0].id },
							function: showElementByText,
							args: [button.getAttribute("data-tag"), button.getAttribute("data-text")]
						});
					});
				});
			});
		}
    });
});

function findElementByText(tag, text) {
    const elements = document.querySelectorAll(tag);
    return Array.from(elements).find(el => el.textContent.trim() === text);
}

function showElementByText(tag, text) {
	const element = findElementByText(tag, text);
    scrollToElementWithOffset(element);
}

function scrollToElementWithOffset(element, offset = 150) {
    if (element) {
        const elementPosition = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
            top: elementPosition - offset,
            behavior: "smooth"
        });
    }
}