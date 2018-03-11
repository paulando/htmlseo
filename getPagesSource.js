function getMetas(document) {

    const metas = [...document.querySelectorAll("meta")];

    let values = metas.map((el, i) => {

        let name = el.getAttribute("name");
        let property = el.getAttribute("property");
        let content = el.getAttribute("content");

        if (name == null && property == null) { return `<div>${el.outerHTML.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` }
        else { return `<div><span><b>${name != null ? name : property} - </b></span><span>${content != "" ? content : `<i style="color:red;">No content!</i>`}</span></div>` };

    }).join("");

    return `<h1>METAS</h1>${values}`;

}

function getHeadings(document) {

    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];

    let values = headings.map((el, i) => {
        return `<div class="scroll-to-element" data-offset-top="${el.offsetTop}"><span><b>${el.nodeName} - </b></span><span>${el.textContent}</span></div>`;
    }).join("");

    return `<h1>HEADINGS</h1>${values}`;

}

function getImages(document) {

    const images = [...document.getElementsByTagName("img")];

    let values = images.map((el, i) => {
        return `<div><span><b>${el.nodeName} - </b></span><span>${el.alt == "" ? `<i style="color:red;">No ALT!</i>` : el.alt} <span> => ${el.src}</span></span></div>`;
    }).join("");

    return `<h1>IMAGES</h1>${values}`;

}

function getLinks(document) {

    const links = [...document.getElementsByTagName("a")];

    let values = links.map((el, i) => {

        const { href, target, rel, dataset } = el;
        const { origin } = window.location;

        // console.log(href);
        // console.log("MAILTO",href.indexOf("mailto:"));
        // console.log("PHONE",href.indexOf("tel:"));

        switch (true) {
            case href.indexOf("mailto:") > -1:
                return `<div><span><b>Email - </b></span><span>${href}</span></div>`;
                break;
            case href.indexOf("tel:") > -1:
                return `<div><span><b>Phone - </b></span><span>${href}</span></div>`;
                break;
            case href.indexOf("fax:") > -1:
                return `<div><span><b>Fax - </b></span><span>${href}</span></div>`;
                break;
            case href == "#" || href == "":
                return `<div><span><b>No link - </b></span><span>${dataset.toggle != "" ? dataset.toggle : el.innerText}</span></div>`;
                break;
            case href.indexOf(origin) > -1:
                return `<div><span><b>Inner - </b></span><span>${href}</span></div>`;
                break;
            default:
                return `<div><span><b>Outer - </b></span><span>${href} </span><span style="color: #4eb6ad;">${target != "" ? target : `<i style="color: red;">No target!</i>`} </span><span style="color: #4eb6ad;">${rel != "" ? rel : `<i style="color: red;">No rel!</i>`}</span></div>`;
                break;
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

chrome.runtime.sendMessage({
    action: "getSource",
    source: getElements(document)
});