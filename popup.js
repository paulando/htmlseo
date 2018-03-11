chrome.runtime.onMessage.addListener(function (request, sender) {

	if (request.action == "getSource") {

		message.innerHTML = request.source;

	}

});


// function scrollToElement(window) {

// 	const scrollElements = [...document.querySelectorAll(".scroll-to-element")];

// 	scrollElements.map(el => {

// 		el.addEventListener("click", function() {

// 			let offset_top = this.dataset.offsetTop;
// 			console.log(window)
// 			window.scrollTo(0, parseInt(offset_top, 10));

// 		});

// 	});

// }

function onWindowLoad() {

	var message = document.querySelector('#message');

	chrome.tabs.executeScript(null, {
		file: "getPagesSource.js"
	}, function () {
		// If you try and inject into an extensions page or the webstore/NTP you'll get an error
		if (chrome.runtime.lastError) {
			message.innerText = 'There was an error injecting script : \n' + chrome.runtime.lastError.message;
		}
	});

}

window.onload = onWindowLoad;