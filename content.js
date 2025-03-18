(() => {
    chrome.runtime.sendMessage({ 
        elements: getElements(document)
    });
})();

function getRow(title = '', content = '') {
    return `<div class="row"><b class="title">${title}</b> ${content}</div>`;
}

function capitalizeWords(str) {
    return str.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getMetas(document) {
    const pageUrl = window.location.href;
    const encodedUrl = encodeURIComponent(pageUrl);

    return `<h1>Quick Links</h1>
        <div class="row">
            <a href="https://search.google.com/test/rich-results?url=${encodedUrl}" target="_blank">Rich Results Test</a>
            <span style="display:inline-block;margin:0 8px">|</span>
            <a href="https://validator.schema.org/#url=${encodedUrl}" target="_blank">Schema.org</a>
        </div>
    <h1>METAS</h1>
        ${getRow("Title", document.title)}
        ${getRow("Description", getDescription())}
        ${getRow("Canonical", getCanonicalUrl())}
        <h2 style="margin-top:30px">Open Graph</h2>
        ${getOGTags()}
    `;

}

function getDescription() {
    return `${document.querySelector('meta[name="description"]')?.content || '<i class="error">No description found!</i>'}`;
}

function getCanonicalUrl() {
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    return canonicalLink ? `${canonicalLink.href} ${canonicalLink.href !== window.location.href ? ' <i class="error" style="margin-left:5px">Not matching</i>' : ''}` : ' <i class="warning"> No canonical link found</i>';
}

function getOGTags() {
    let html = '';
    const metaTags = document.querySelectorAll('meta[property^="og:"]');

    metaTags.forEach(tag => {
        const property = tag.getAttribute('property').replace('og:', '');
        const content = tag.getAttribute('content');
        html += getRow(capitalizeWords(property).replace('_', ' '), content);
    });

    return html;
}

function getHeadings(document) {

    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];

    let values = headings.map((el, i) => {
        const isHidden = isElementHiddenFast(el) ? `<i class="error"> Hidden!</i>` : "";
        return `<div class="row btn-scrollintoview" data-tag="${el.nodeName}" data-text="${el.textContent.trim()}" style="margin-bottom:5px"><b class="tag"><span>${el.nodeName}<span></b><span>${el.textContent}${isHidden}</span></div>`;
    }).join("");

    return `<h1>HEADINGS</h1>${values}`;

}

function getImages(document) {

    const images = [...document.getElementsByTagName("img")];

    let values = images.map((el, i) => {
        return `<div class="row">
            <div data-src="${el.src}"><b><a href="${el.src}" target="_blank">URL</a> - </b> ${el.src} <br><b>ALT - </b> ${el.alt == "" ? `<i style="color:red;">No ALT!</i>` : el.alt}</div>
        </div>`;
    }).join("");

    return `<h1>IMAGES</h1>${values}`;

}

function getLinks(document) {

    const links = [...document.getElementsByTagName("a")];

    let values = links.map((el, i) => {

        const { href, target, rel, dataset } = el;
        const { origin } = window.location;

        if (typeof href === "string") {

            switch (true) {
                case href.indexOf("mailto:") > -1:
                    return `<div style="margin-bottom:5px"><span><b>Email - </b></span><span>${href}</span></div>`;
                    break;
                case href.indexOf("tel:") > -1:
                    return `<div style="margin-bottom:5px"><span><b>Phone - </b></span><span>${href}</span></div>`;
                    break;
                case href.indexOf("fax:") > -1:
                    return `<div style="margin-bottom:5px"><span><b>Fax - </b></span><span>${href}</span></div>`;
                    break;
                case href == "#" || href == "":
                    return `<div style="margin-bottom:5px"><span><b>No link - </b></span><span>${dataset.toggle != "" ? dataset.toggle : el.innerText}</span></div>`;
                    break;
                case href.indexOf(origin) > -1:
                    return `<div style="margin-bottom:5px"><span><b>Inner - </b></span><span>${href}</span></div>`;
                    break;
                default:
                    return `<div style="margin-bottom:5px"><span><b>Outer - </b></span><span>${href} </span><span style="color: #4eb6ad;">${target != "" ? target : `<i style="color: red;">No target!</i>`} </span><span style="color: #4eb6ad;">${rel != "" ? rel : `<i style="color: red;">No rel!</i>`}</span></div>`;
                    break;
            }
            
        }

    }).join("");

    return `<h1>LINKS</h1>${values}`;

}

function getElements(document) {

    let elements = [
        getMetas(document),
        getHeadings(document),
        getImages(document),
        getLinks(document)
    ].join("");

    return elements;

}

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

function isElementHiddenFast(element) {
    return !element || element.offsetParent === null;
}
