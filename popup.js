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
            
            [...document.querySelectorAll('[data-src]')].forEach(button => {
				button.addEventListener("mouseenter", (event) => {
                    const image = document.getElementById("image");
                    const x = event.clientX;
                    const y = event.clientY;

                    image.src = button.getAttribute("data-src");
                    image.style = `position: fixed; top: ${y}px; left: ${x+20}px; z-index: 10000; width: 200px; height: auto;`;
				});

                button.addEventListener("mouseleave", () => {
                    image.src = "";
                    image.style = "";
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
        element.style.outline = "2px solid red";
        setTimeout(() => {
            element.style.outline = "";
        }, 2000);
    }
}